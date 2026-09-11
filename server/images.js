'use strict';

const crypto = require('crypto');

const store = require('./store');

// The ceiling depends on where the bytes end up: a filesystem takes 10 MB
// comfortably, a key-value store carries them base64-encoded inside a request.
const MAX_BYTES = store.maxBlobBytes;

/* CHANGED: a backdrop is allowed to be much larger than anything else, because
   it is the one image chosen straight out of a camera roll. The console shrinks
   one that big to the size a screen can actually show before sending it, so
   what arrives here is small whatever the organiser picked. This ceiling is
   the safety net behind that, for anything posted another way. */
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

function maxBytesFor(kind) {
  return kind === 'background' ? Math.max(MAX_BYTES, MAX_UPLOAD_BYTES) : MAX_BYTES;
}
const MIN_DIMENSION = 16;
const MAX_DIMENSION = 8000;

const EXTENSIONS = Object.freeze({ png: '.png', jpeg: '.jpg', gif: '.gif', webp: '.webp', svg: '.svg' });

/**
 * Reads width/height straight from the file header.
 *
 * Deliberately dependency-free: the project ships with no image library, and
 * the alternative is trusting a client-declared size.
 */
function probeImage(buffer) {
  if (buffer.length < 16) return null;

  // PNG: 8-byte signature, then an IHDR chunk carrying the dimensions.
  if (buffer.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return { format: 'png', width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
  }

  // GIF87a / GIF89a: little-endian dimensions at byte 6.
  if (buffer.slice(0, 3).toString('ascii') === 'GIF') {
    return { format: 'gif', width: buffer.readUInt16LE(6), height: buffer.readUInt16LE(8) };
  }

  // RIFF....WEBP — three sub-formats, each storing size differently.
  if (buffer.slice(0, 4).toString('ascii') === 'RIFF' && buffer.slice(8, 12).toString('ascii') === 'WEBP') {
    const chunk = buffer.slice(12, 16).toString('ascii');
    if (chunk === 'VP8X') {
      return {
        format: 'webp',
        width: 1 + buffer.readUIntLE(24, 3),
        height: 1 + buffer.readUIntLE(27, 3),
      };
    }
    if (chunk === 'VP8L') {
      const bits = buffer.readUInt32LE(21);
      return { format: 'webp', width: 1 + (bits & 0x3fff), height: 1 + ((bits >> 14) & 0x3fff) };
    }
    if (chunk === 'VP8 ') {
      return { format: 'webp', width: buffer.readUInt16LE(26) & 0x3fff, height: buffer.readUInt16LE(28) & 0x3fff };
    }
    return null;
  }

  // JPEG: walk the marker segments to the start-of-frame that holds the size.
  if (buffer[0] === 0xff && buffer[1] === 0xd8) {
    let offset = 2;
    while (offset + 9 < buffer.length) {
      if (buffer[offset] !== 0xff) {
        offset += 1;
        continue;
      }
      const marker = buffer[offset + 1];
      const isStartOfFrame = marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker);
      if (isStartOfFrame) {
        return { format: 'jpeg', height: buffer.readUInt16BE(offset + 5), width: buffer.readUInt16BE(offset + 7) };
      }
      offset += 2 + buffer.readUInt16BE(offset + 2);
    }
    return null;
  }

  // SVG has no pixel dimensions; it scales, so it is accepted without them.
  const head = buffer.slice(0, 1024).toString('utf8');
  if (/<svg[\s>]/i.test(head)) return { format: 'svg', width: null, height: null };

  return null;
}

function decodeDataUrl(content) {
  const match = /^data:([^;,]+);base64,(.+)$/s.exec(String(content || ''));
  if (!match) throw new Error('The image could not be read.');
  return Buffer.from(match[2], 'base64');
}

/**
 * Validates and stores an uploaded image, returning the public path plus the
 * dimensions actually found in the file.
 */
async function saveImageAsset(kind, content, originalName) {
  const buffer = decodeDataUrl(content);

  if (buffer.length > maxBytesFor(kind)) {
    throw new Error(
      `That image is ${(buffer.length / 1048576).toFixed(1)} MB — the limit is ` +
        `${(maxBytesFor(kind) / 1048576).toFixed(0)} MB on this deployment.`
    );
  }

  const info = probeImage(buffer);
  if (!info) {
    throw new Error('That file is not a PNG, JPEG, GIF, WebP or SVG image.');
  }

  if (info.width !== null) {
    if (info.width < MIN_DIMENSION || info.height < MIN_DIMENSION) {
      throw new Error(`That image is only ${info.width}×${info.height}px — too small to display.`);
    }
    if (info.width > MAX_DIMENSION || info.height > MAX_DIMENSION) {
      throw new Error(`That image is ${info.width}×${info.height}px — the limit is ${MAX_DIMENSION}px on a side.`);
    }
  }

  const digest = crypto.createHash('sha1').update(buffer).digest('hex').slice(0, 10);
  const fileName = `${kind}-${digest}${EXTENSIONS[info.format]}`;
  await store.saveBlob(fileName, buffer);

  return {
    src: `assets/${fileName}`,
    format: info.format,
    width: info.width,
    height: info.height,
    bytes: buffer.length,
    originalName: String(originalName || '').slice(0, 120),
  };
}

/** Removes a previously uploaded asset, ignoring anything outside assets/. */
async function removeImageAsset(src) {
  if (typeof src !== 'string' || !src.startsWith('assets/') || src.includes('..')) return;
  await store.deleteBlob(src.slice('assets/'.length));
}

module.exports = {
  MAX_BYTES,
  MAX_UPLOAD_BYTES,
  maxBytesFor,
  MIN_DIMENSION,
  MAX_DIMENSION,
  probeImage,
  saveImageAsset,
  removeImageAsset,
};

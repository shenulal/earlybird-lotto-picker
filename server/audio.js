'use strict';

const crypto = require('crypto');

const store = require('./store');

/* Audio is stored exactly as images are: through the store, named by a hash
   of its content, so the same file uploaded twice is one file and a name can
   be checked against what it holds. */

const EXTENSIONS = Object.freeze({
  mp3: '.mp3',
  ogg: '.ogg',
  wav: '.wav',
  m4a: '.m4a',
  aac: '.aac',
  flac: '.flac',
  webm: '.webm',
});

const MIN_BYTES = 256;

/**
 * Recognises an audio file from its first bytes.
 *
 * Deliberately dependency-free, like the image probe: the file's own header is
 * trusted, never the name or the type the browser declared.
 */
function probeAudio(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12) return null;

  const ascii = (start, end) => buffer.slice(start, end).toString('latin1');

  if (ascii(0, 3) === 'ID3') return 'mp3';
  // MPEG audio frame: eleven sync bits, then a layer that is not "reserved".
  if (buffer[0] === 0xff && (buffer[1] & 0xe0) === 0xe0 && (buffer[1] & 0x06) !== 0) return 'mp3';
  // ADTS (raw AAC) shares the sync word, with its layer bits always zero.
  if (buffer[0] === 0xff && (buffer[1] & 0xf6) === 0xf0) return 'aac';
  if (ascii(0, 4) === 'OggS') return 'ogg';
  if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WAVE') return 'wav';
  if (ascii(0, 4) === 'fLaC') return 'flac';
  if (ascii(4, 8) === 'ftyp') return 'm4a';
  if (buffer.readUInt32BE(0) === 0x1a45dfa3) return 'webm';
  return null;
}

function decodeDataUrl(content) {
  const match = /^data:([^;,]*)(;[^,]*)?;base64,(.+)$/s.exec(String(content || ''));
  if (!match) throw new Error('The audio file could not be read.');
  return Buffer.from(match[3], 'base64');
}

function describeBytes(bytes) {
  return `${(bytes / 1048576).toFixed(1)} MB`;
}

/**
 * Validates and stores an uploaded audio file.
 *
 * The ceiling is the deployment's: a filesystem takes far more than a
 * key-value store, which carries the bytes base64-encoded inside a request.
 */
async function saveAudioAsset(content, originalName) {
  const buffer = decodeDataUrl(content);

  if (buffer.length > store.maxBlobBytes) {
    throw new Error(
      `That file is ${describeBytes(buffer.length)} — the limit is ${describeBytes(store.maxBlobBytes)} on this deployment.`
    );
  }
  if (buffer.length < MIN_BYTES) throw new Error('That file is too small to be audio.');

  const format = probeAudio(buffer);
  if (!format) throw new Error('That file is not an MP3, M4A, AAC, OGG, WAV, FLAC or WebM audio file.');

  const fileName = audioFileName(buffer, format);
  await store.saveBlob(fileName, buffer);

  return {
    src: `assets/${fileName}`,
    format,
    bytes: buffer.length,
    originalName: String(originalName || '').slice(0, 120),
  };
}

/** The name an audio file is stored under: its kind, its hash, its format. */
function audioFileName(buffer, format) {
  const digest = crypto.createHash('sha1').update(buffer).digest('hex').slice(0, 10);
  return `audio-${digest}${EXTENSIONS[format]}`;
}

module.exports = { EXTENSIONS, probeAudio, saveAudioAsset, audioFileName };

'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { useTemporaryDataDir } = require('./helpers');

useTemporaryDataDir();

const audio = require('../server/audio');
const store = require('../server/store');

function padded(header) {
  return Buffer.concat([Buffer.from(header), Buffer.alloc(600, 1)]);
}

test('recognises audio formats from their first bytes', () => {
  assert.equal(audio.probeAudio(padded('ID3\u0004')), 'mp3');
  assert.equal(audio.probeAudio(padded([0xff, 0xfb, 0x90, 0x00])), 'mp3');
  assert.equal(audio.probeAudio(padded([0xff, 0xf1, 0x50, 0x80])), 'aac');
  assert.equal(audio.probeAudio(padded('OggS')), 'ogg');
  assert.equal(audio.probeAudio(Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WAVE'), Buffer.alloc(600)])), 'wav');
  assert.equal(audio.probeAudio(padded('fLaC')), 'flac');
  assert.equal(audio.probeAudio(Buffer.concat([Buffer.alloc(4), Buffer.from('ftypM4A '), Buffer.alloc(600)])), 'm4a');
  assert.equal(audio.probeAudio(padded([0x1a, 0x45, 0xdf, 0xa3])), 'webm');
});

test('refuses files that are not audio', () => {
  assert.equal(audio.probeAudio(padded('\u0089PNG\r\n')), null);
  assert.equal(audio.probeAudio(padded('<html>')), null);
  assert.equal(audio.probeAudio(Buffer.from('ID3')), null);
});

test('stores an upload under a name derived from its content', async () => {
  await store.hydrate();
  const bytes = padded('ID3\u0004');
  const content = `data:audio/mpeg;base64,${bytes.toString('base64')}`;
  const saved = await audio.saveAudioAsset(content, 'Walk in.mp3');
  assert.match(saved.src, /^assets\/audio-[a-f0-9]{10}\.mp3$/);
  assert.equal(saved.src, `assets/${audio.audioFileName(bytes, 'mp3')}`);
  assert.deepEqual(await store.readBlob(saved.src.slice('assets/'.length)), bytes);
});

test('rejects an upload that is not audio, with a reason', async () => {
  const content = `data:audio/mpeg;base64,${padded('GIF89a').toString('base64')}`;
  await assert.rejects(audio.saveAudioAsset(content, 'x.mp3'), /not an MP3/);
});

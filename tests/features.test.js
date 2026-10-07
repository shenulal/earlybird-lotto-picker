'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const features = require('../server/features');
const { TICKET_DATA } = require('./helpers');

test('sound is off by default, with every cue present', () => {
  const sound = features.normalizeSound(undefined);
  assert.equal(sound.enabled, false);
  assert.deepEqual(Object.keys(sound.cues), features.SOUND_CUES);
  assert.equal(sound.cues.ambient.enabled, false);
  assert.equal(sound.cues.spin.preset, 'drumroll');
});

test('cue values are clamped and unknown presets fall back', () => {
  const sound = features.normalizeSound({
    volume: 400,
    cues: { reveal: { volume: -5, preset: 'nope', durationMs: 9e9, fadeInMs: 'x' } },
  });
  assert.equal(sound.volume, 100);
  assert.equal(sound.cues.reveal.volume, 0);
  assert.equal(sound.cues.reveal.preset, 'fanfare');
  assert.equal(sound.cues.reveal.durationMs, 600000);
  assert.equal(sound.cues.reveal.fadeInMs, 0);
});

test('a cue only uses a track that is in the library', () => {
  const library = [{ id: 'track-a', name: 'Walk-in', src: 'assets/audio-0123456789.mp3' }];
  const sound = features.normalizeSound({
    library,
    cues: {
      ambient: { source: 'track', track: 'track-a' },
      reveal: { source: 'track', track: 'track-gone' },
    },
  });
  assert.equal(sound.cues.ambient.source, 'track');
  assert.equal(sound.cues.reveal.source, 'preset');
  assert.equal(sound.cues.reveal.track, '');
});

test('library entries must point at an uploaded audio file', () => {
  const sound = features.normalizeSound({
    library: [
      { id: 'track-ok', src: 'assets/audio-abcdef0123.ogg' },
      { id: 'track-path', src: '../../etc/passwd' },
      { id: 'track-image', src: 'assets/logo-abcdef0123.png' },
    ],
  });
  assert.deepEqual(sound.library.map((track) => track.id), ['track-ok']);
});

test('the countdown accepts only instants that carry an offset', () => {
  assert.equal(features.normalizeCountdown({ targetAt: '2026-12-31T20:00:00Z' }).targetAt, '2026-12-31T20:00:00Z');
  assert.equal(features.normalizeCountdown({ targetAt: '2026-12-31T20:00:00+04:00' }).targetAt, '2026-12-31T20:00:00+04:00');
  assert.equal(features.normalizeCountdown({ targetAt: '2026-12-31T20:00' }).targetAt, '');
  assert.equal(features.normalizeCountdown({ targetAt: 'tomorrow' }).targetAt, '');
});

test('the countdown locks draws only while it is running', () => {
  const countdown = features.normalizeCountdown({ enabled: true, targetAt: '2026-01-01T00:00:00Z' });
  const before = Date.parse('2025-12-31T23:59:00Z');
  const after = Date.parse('2026-01-01T00:00:01Z');
  assert.equal(features.countdownLocksDraw(countdown, before), true);
  assert.equal(features.countdownLocksDraw(countdown, after), false);
  assert.equal(features.countdownLocksDraw({ ...countdown, lockDraw: false }, before), false);
  assert.equal(features.countdownLocksDraw({ ...countdown, enabled: false }, before), false);
});

test('the redraw is off by default and signed-in only once on', () => {
  const redraw = features.normalizeRedraw(undefined);
  assert.equal(redraw.enabled, false);
  assert.equal(redraw.requireSignIn, true);
  assert.equal(redraw.returnToPool, false);
  assert.equal(features.normalizeRedraw({ maxPerPrize: 999 }).maxPerPrize, 50);
});

test('certificate columns are limited to fields the event has', () => {
  const certificate = features.normalizeCertificate({ fields: ['name', 'ghost', 'name'] }, TICKET_DATA);
  assert.deepEqual(certificate.fields, ['name']);
  assert.deepEqual(features.normalizeCertificate({}, TICKET_DATA).fields, ['ticket', 'name']);
});

test('certificate signatories drop empty rows and keep at most six', () => {
  const rows = Array.from({ length: 9 }, (_unused, index) => ({ name: `Person ${index}`, role: 'Witness' }));
  const certificate = features.normalizeCertificate({ signatories: [{ name: '', role: '' }, ...rows] }, TICKET_DATA);
  assert.equal(certificate.signatories.length, 6);
  assert.equal(certificate.signatories[0].name, 'Person 0');
});

test('the reference prefix keeps only safe characters', () => {
  assert.equal(features.normalizeCertificate({ referencePrefix: 'GALA/26<x>' }, TICKET_DATA).referencePrefix, 'GALA26x');
});

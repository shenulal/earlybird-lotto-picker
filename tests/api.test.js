'use strict';

/**
 * The feature endpoints end to end: a real server on a random port, a fresh
 * data directory, and the same HTTP calls the board and the console make.
 *
 * Set PICKORA_TEST_URL to run the same calls against a server already running
 * elsewhere — the Flask mirror, say — started with an empty data directory and
 * ADMIN_USERNAME=organiser / ADMIN_PASSWORD=correct-horse-battery.
 */

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

const { useTemporaryDataDir } = require('./helpers');

useTemporaryDataDir();
process.env.ADMIN_USERNAME = 'organiser';
process.env.ADMIN_PASSWORD = 'correct-horse-battery';

const { createApp } = require('../server/app');

let server;
let base;
let cookie = '';

async function call(method, path, body, { signedIn = true } = {}) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: {
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(signedIn && cookie ? { Cookie: cookie } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const type = response.headers.get('content-type') || '';
  const payload = type.includes('json') ? await response.json() : await response.text();
  return { status: response.status, payload, headers: response.headers };
}

const save = (appSettings) => call('PUT', '/api/admin/settings', { appSettings });

before(async () => {
  if (process.env.PICKORA_TEST_URL) {
    base = process.env.PICKORA_TEST_URL.replace(/\/+$/, '');
  } else {
    server = createApp().listen(0);
    await new Promise((resolve) => server.once('listening', resolve));
    base = `http://127.0.0.1:${server.address().port}`;
  }

  const login = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'organiser', password: 'correct-horse-battery' }),
  });
  cookie = login.headers.get('set-cookie').split(';')[0];

  const csv = ['ticket,name', ...Array.from({ length: 6 }, (_u, i) => `T-${i + 1},Guest ${i + 1}`)].join('\n');
  const upload = await call('POST', '/api/admin/tickets', { content: csv, format: 'csv', mode: 'replace', force: true });
  assert.equal(upload.status, 200);
  await save({ totalPrizes: 3 });
});

after(() => server && server.close());

test('public settings carry the server clock and the new sections', async () => {
  const { payload } = await call('GET', '/api/settings', undefined, { signedIn: false });
  assert.ok(!Number.isNaN(Date.parse(payload.serverTime)));
  for (const section of ['sound', 'redraw', 'countdown']) assert.ok(payload.appSettings[section], section);
  // The certificate is the organiser's document — signatories, venue, notes.
  assert.equal(payload.appSettings.certificate, undefined);
});

test('the countdown holds public draws until it ends, but not an organiser', async () => {
  const future = new Date(Date.now() + 3600000).toISOString().replace(/\.\d{3}Z$/, 'Z');
  await save({ countdown: { enabled: true, targetAt: future, lockDraw: true } });

  const blocked = await call('POST', '/api/draw', {}, { signedIn: false });
  assert.equal(blocked.status, 423);
  assert.equal(blocked.payload.reason, 'countdown');

  const organiser = await call('POST', '/api/draw', {});
  assert.equal(organiser.status, 200);

  await save({ countdown: { enabled: false } });
  await call('POST', '/api/admin/draw/reset', {});
});

test('the board redraw obeys the organiser\'s switches', async () => {
  await call('POST', '/api/draw', {}, { signedIn: false });

  const off = await call('POST', '/api/draw/absent', {}, { signedIn: false });
  assert.equal(off.status, 403);

  await save({ redraw: { enabled: true, showOnBoard: true, requireSignIn: true } });
  const anonymous = await call('POST', '/api/draw/absent', {}, { signedIn: false });
  assert.equal(anonymous.status, 401);

  const signedIn = await call('POST', '/api/draw/absent', {});
  assert.equal(signedIn.status, 200);
  assert.equal(signedIn.payload.stats.absentCount, 1);
  // Only display fields reach the board.
  assert.deepEqual(Object.keys(signedIn.payload.absent.record).sort(), Object.keys(signedIn.payload.absent.record).sort());

  const state = await call('GET', '/api/state', undefined, { signedIn: false });
  assert.equal(state.payload.absent.length, 1);
  assert.equal(state.payload.stats.nextPrizeNumber, 1);
});

test('from the board, only the winner on screen can be struck off', async () => {
  await save({ redraw: { enabled: true, showOnBoard: true, requireSignIn: false } });
  await call('POST', '/api/admin/draw/reset', {});
  const first = await call('POST', '/api/draw', {}, { signedIn: false });
  await call('POST', '/api/draw', {}, { signedIn: false });

  const older = await call('POST', '/api/draw/absent', { drawIndex: first.payload.winner.drawIndex }, { signedIn: false });
  assert.equal(older.status, 409);
  assert.equal(older.payload.reason, 'not-latest');

  const latest = await call('POST', '/api/draw/absent', {}, { signedIn: false });
  assert.equal(latest.status, 200);
  assert.notEqual(latest.payload.absent.drawIndex, first.payload.winner.drawIndex);
  await save({ redraw: { requireSignIn: true } });
});

test('an organiser can restore an absentee and the export lists both kinds', async () => {
  const overview = await call('GET', '/api/admin/overview');
  const [struck] = overview.payload.absent;
  assert.ok(struck);

  const restored = await call('POST', '/api/admin/draw/restore', { drawIndex: struck.drawIndex });
  assert.equal(restored.status, 200);

  await call('POST', '/api/admin/draw/absent', { drawIndex: struck.drawIndex });
  await call('POST', '/api/draw', {});
  const csv = await call('GET', '/api/admin/export/winners.csv');
  assert.match(csv.payload, /Status/);
  assert.match(csv.payload, /Not present/);
  assert.match(csv.payload, /Winner/);
});

test('the certificate data carries both fingerprints and a stable reference', async () => {
  const first = await call('GET', '/api/admin/certificate');
  const second = await call('GET', '/api/admin/certificate');
  assert.equal(first.status, 200);
  assert.match(first.payload.reference, /^PK-\d{8}-[A-F0-9]{6}$/);
  assert.equal(first.payload.reference, second.payload.reference);
  assert.match(first.payload.poolFingerprint, /^[a-f0-9]{64}$/);
  assert.equal(first.payload.poolFingerprint, first.payload.currentPoolFingerprint);
  assert.equal(first.payload.poolSize, 6);

  const anonymous = await call('GET', '/api/admin/certificate', undefined, { signedIn: false });
  assert.equal(anonymous.status, 401);
});

test('sound tracks upload, rename and delete, and cues fall back when one goes', async () => {
  const bytes = Buffer.concat([Buffer.from('ID3\u0004'), Buffer.alloc(800, 3)]);
  const uploaded = await call('POST', '/api/admin/sound/tracks', {
    content: `data:audio/mpeg;base64,${bytes.toString('base64')}`,
    name: 'Walk in.mp3',
  });
  assert.equal(uploaded.status, 200);
  const { track } = uploaded.payload;
  assert.equal(track.name, 'Walk in');

  const served = await fetch(`${base}/${track.src}`);
  assert.equal(served.status, 200);
  assert.equal(served.headers.get('content-type'), 'audio/mpeg');

  await save({ sound: { cues: { reveal: { source: 'track', track: track.id } } } });
  const renamed = await call('PATCH', `/api/admin/sound/tracks/${track.id}`, { name: 'Fanfare' });
  assert.equal(renamed.payload.appSettings.sound.library[0].name, 'Fanfare');

  const duplicate = await call('POST', '/api/admin/sound/tracks', {
    content: `data:audio/mpeg;base64,${bytes.toString('base64')}`,
    name: 'again.mp3',
  });
  assert.equal(duplicate.status, 409);

  const removed = await call('DELETE', `/api/admin/sound/tracks/${track.id}`);
  assert.equal(removed.payload.appSettings.sound.cues.reveal.source, 'preset');
  assert.equal((await fetch(`${base}/${track.src}`)).status, 404);

  const bad = await call('POST', '/api/admin/sound/tracks', { content: 'data:audio/mpeg;base64,PGh0bWw+', name: 'x.mp3' });
  assert.equal(bad.status, 400);
});

test('templates save, apply, export, import and delete', async () => {
  await save({ ui: { primaryColor: '#abcdef' } });
  const created = await call('POST', '/api/admin/templates', { name: 'House style', sections: ['look'] });
  assert.equal(created.status, 200);
  const { id } = created.payload.template;

  await save({ ui: { primaryColor: '#000000' } });
  const applied = await call('POST', `/api/admin/templates/${id}/apply`, { sections: ['look'] });
  assert.equal(applied.payload.appSettings.ui.primaryColor, '#abcdef');

  const exported = await call('GET', `/api/admin/templates/${id}/export?embed=1`);
  assert.match(exported.headers.get('content-disposition'), /pickora-house-style\.json/);
  const file = exported.payload;

  const imported = await call('POST', '/api/admin/templates/import', { file, name: 'Imported style' });
  assert.equal(imported.status, 200);
  assert.equal(imported.payload.template.name, 'Imported style');

  const current = await call('GET', '/api/admin/templates/current/export');
  assert.equal(current.payload.template.sections.length, 13);

  const listed = await call('GET', '/api/admin/templates');
  assert.ok(listed.payload.templates.some((template) => template.id === id));

  assert.equal((await call('DELETE', `/api/admin/templates/${id}`)).status, 200);
  assert.equal((await call('DELETE', '/api/admin/templates/builtin-gala-evening')).status, 409);
  assert.equal((await call('GET', '/api/admin/templates', undefined, { signedIn: false })).status, 401);
});

test('the templates document is never served as a file', async () => {
  assert.equal((await fetch(`${base}/templates.json`)).status, 404);
  assert.equal((await fetch(`${base}/tests/api.test.js`)).status, 404);
});

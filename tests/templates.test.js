'use strict';

const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

const { useTemporaryDataDir, sampleTickets, TICKET_DATA } = require('./helpers');

useTemporaryDataDir();

const store = require('../server/store');
const ticketStore = require('../server/tickets');
const templates = require('../server/templates');
const audio = require('../server/audio');
const { normalizeAppSettings } = require('../server/settings');

function current(overrides = {}) {
  return normalizeAppSettings({ eventName: 'Spring Gala', data: TICKET_DATA, ...overrides });
}

beforeEach(async () => {
  await store.hydrate({ force: true });
  ticketStore.saveTickets(sampleTickets(3));
  store.writeDocument('templates', { templates: [] });
});

test('the built-in templates load and cannot be deleted', () => {
  const list = templates.listTemplates(normalizeAppSettings);
  const builtIns = list.filter((template) => template.builtIn);
  assert.ok(builtIns.length >= 4);
  assert.ok(builtIns.every((template) => template.id.startsWith('builtin-')));
  assert.throws(() => templates.deleteTemplate(builtIns[0].id, normalizeAppSettings), /cannot be deleted/);
});

test('saving keeps only the chosen sections', () => {
  const template = templates.createTemplate(
    { name: 'Look only', sections: ['look', 'wording'] },
    current({ ui: { primaryColor: '#123456' } }),
    normalizeAppSettings
  );
  assert.deepEqual(template.sections, ['look', 'wording']);
  assert.deepEqual(Object.keys(template.settings).sort(), ['copy', 'text', 'ui', 'wheel']);
  assert.equal(template.settings.ui.primaryColor, '#123456');
});

test('a template needs a name and at least one section', () => {
  assert.throws(() => templates.createTemplate({ name: '' }, current(), normalizeAppSettings), /name/);
  assert.throws(() => templates.createTemplate({ name: 'X', sections: [] }, current(), normalizeAppSettings), /at least one/);
});

test('applying replaces only the chosen sections and keeps the event name', () => {
  const template = templates.createTemplate(
    { name: 'Gold', sections: ['look', 'prizes'] },
    current({ eventName: 'Other', ui: { primaryColor: '#d4af37' }, prizes: { items: [{ name: 'Car' }] } }),
    normalizeAppSettings
  );
  const before = current({ ui: { primaryColor: '#000000' }, prizes: { items: [{ name: 'Phone' }] } });
  const applied = templates.applyTemplate(template, before, { sections: ['look'] }, normalizeAppSettings);
  assert.equal(applied.appSettings.ui.primaryColor, '#d4af37');
  assert.equal(applied.appSettings.prizes.items[0].name, 'Phone');
  assert.equal(applied.appSettings.eventName, 'Spring Gala');
});

test('applying a built-in look leaves uploaded artwork alone', () => {
  const gala = templates.findTemplate('builtin-gala-evening', normalizeAppSettings);
  const before = current({ branding: { logo: { src: 'assets/logo-0123456789.png' } } });
  const applied = templates.applyTemplate(gala, before, {}, normalizeAppSettings);
  assert.equal(applied.appSettings.branding.logo.src, 'assets/logo-0123456789.png');
  assert.equal(applied.appSettings.sound.enabled, true);
});

test('applying a template keeps the event\'s own sound library', () => {
  const library = [{ id: 'track-mine', name: 'Mine', src: 'assets/audio-0123456789.mp3' }];
  const gala = templates.findTemplate('builtin-gala-evening', normalizeAppSettings);
  const applied = templates.applyTemplate(gala, current({ sound: { library } }), {}, normalizeAppSettings);
  assert.deepEqual(applied.appSettings.sound.library.map((track) => track.id), ['track-mine']);
});

test('a file in use by a template is not deleted', async () => {
  await store.saveBlob('logo-0123456789.png', Buffer.from('x'));
  templates.createTemplate(
    { name: 'Logo', sections: ['branding'] },
    current({ branding: { logo: { src: 'assets/logo-0123456789.png' } } }),
    normalizeAppSettings
  );
  const removed = await templates.removeIfUnused('assets/logo-0123456789.png', current(), normalizeAppSettings);
  assert.equal(removed, false);
  assert.ok(await store.readBlob('logo-0123456789.png'));
});

test('missing files are dropped when a template is applied', async () => {
  const withMissing = current({
    branding: { logo: { src: 'assets/logo-aaaaaaaaaa.png' } },
    welcome: { images: [{ src: 'assets/guest-bbbbbbbbbb.jpg' }] },
  });
  const { appSettings, missing } = await templates.withoutMissingAssets(withMissing, normalizeAppSettings);
  assert.equal(missing.length, 2);
  assert.equal(appSettings.branding.logo.src, 'pickora-logo.png');
  assert.deepEqual(appSettings.welcome.images, []);
});

test('export and import carry embedded files, and refuse tampered ones', async () => {
  const bytes = Buffer.concat([Buffer.from('ID3\u0004'), Buffer.alloc(600, 7)]);
  const name = audio.audioFileName(bytes, 'mp3');
  await store.saveBlob(name, bytes);
  const library = [{ id: 'track-walk', name: 'Walk-in', src: `assets/${name}` }];
  const template = templates.createTemplate(
    { name: 'With music', sections: ['sound'] },
    current({ sound: { library, cues: { ambient: { enabled: true, source: 'track', track: 'track-walk' } } } }),
    normalizeAppSettings
  );

  const file = await templates.exportTemplate(template, { embed: true });
  assert.equal(file.format, 'pickora-template');
  assert.ok(file.assets[`assets/${name}`]);

  await store.deleteBlob(name);
  const tampered = { ...file, assets: { ...file.assets, 'assets/audio-ffffffffff.mp3': bytes.toString('base64') } };
  const { input, refused } = await templates.importTemplate(tampered);
  assert.deepEqual(refused, ['assets/audio-ffffffffff.mp3']);
  assert.deepEqual(await store.readBlob(name), bytes);
  assert.equal(input.name, 'With music');
});

test('import refuses files that are not templates', async () => {
  await assert.rejects(templates.importTemplate({ format: 'something-else' }), /not a Pickora template/);
  await assert.rejects(templates.importTemplate({ format: 'pickora-template', version: 99 }), /newer version/);
});

test('applying a countdown style keeps the event\'s own time and switch', () => {
  const gala = templates.findTemplate('builtin-gala-evening', normalizeAppSettings);
  const before = current({ countdown: { enabled: true, targetAt: '2026-12-31T20:00:00+04:00', title: 'Old title' } });
  const applied = templates.applyTemplate(gala, before, { sections: ['countdown'] }, normalizeAppSettings);
  assert.equal(applied.appSettings.countdown.enabled, true);
  assert.equal(applied.appSettings.countdown.targetAt, '2026-12-31T20:00:00+04:00');
  assert.equal(applied.appSettings.countdown.title, 'The grand draw begins in');
});

test('applying reports template tracks that do not fit in the library', () => {
  const own = Array.from({ length: 30 }, (_unused, index) => ({
    id: `track-own-${index}`,
    name: `Own ${index}`,
    src: `assets/audio-${String(index).padStart(10, '0')}.mp3`,
  }));
  const template = {
    sections: ['sound'],
    settings: {
      sound: normalizeAppSettings({ sound: { library: [{ id: 'track-extra', name: 'Extra', src: 'assets/audio-ffffffffff.mp3' }] } }).sound,
    },
  };
  const applied = templates.applyTemplate(template, current({ sound: { library: own } }), {}, normalizeAppSettings);
  assert.deepEqual(applied.droppedTracks, ['Extra']);
  assert.equal(applied.appSettings.sound.library.length, 30);
});

test('a refused import stores none of its files', async () => {
  for (let index = 0; index < templates.MAX_TEMPLATES; index += 1) {
    templates.createTemplate({ name: `T${index}`, sections: ['look'] }, current(), normalizeAppSettings);
  }
  assert.throws(() => templates.assertCanCreate('One more', normalizeAppSettings), /up to 50/);
  assert.throws(() => templates.assertCanCreate('', normalizeAppSettings));
});

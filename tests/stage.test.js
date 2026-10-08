'use strict';

const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

const { useTemporaryDataDir, sampleTickets, TICKET_DATA } = require('./helpers');

useTemporaryDataDir();

const store = require('../server/store');
const live = require('../server/live');
const stage = require('../server/stage-features');
const ticketStore = require('../server/tickets');
const draw = require('../server/draw');
const reset = require('../server/reset');
const templates = require('../server/templates');
const { normalizeAppSettings } = require('../server/settings');

const BOARD_A = 'board-aaaaaaaaaaaaaaaa';
const SIGNED_IN = { signedIn: true };
const BOARD_B = 'board-bbbbbbbbbbbbbbbb';

function settings(overrides = {}) {
  return normalizeAppSettings({ totalPrizes: 3, data: TICKET_DATA, ...overrides });
}

beforeEach(async () => {
  await store.hydrate({ force: true });
  store.writeDocument('live', { seq: 0, revision: 0, events: [], controller: null, status: null });
  store.writeDocument('remote', { seq: 0, commands: [] });
  store.writeDocument('templates', { templates: [] });
  ticketStore.saveTickets(sampleTickets(8));
  draw.resetDraw(settings());
});

/* --------------------------------------------------------------- settings */

test('sponsors, remote, live sync and the wheel are all off by default', () => {
  const appSettings = settings();
  assert.equal(appSettings.sponsors.enabled, false);
  assert.equal(appSettings.remote.enabled, false);
  assert.equal(appSettings.liveSync.enabled, false);
  assert.equal(appSettings.wheel.style, 'reel');
});

test('a prize can only be linked to a sponsor that exists', () => {
  const sponsors = stage.normalizeSponsors({
    enabled: true,
    items: [{ id: 'sponsor-a', name: 'Acme' }],
    prizeSponsors: { 'prize-1': 'sponsor-a', 'prize-2': 'sponsor-gone', '../x': 'sponsor-a' },
  });
  assert.deepEqual(sponsors.prizeSponsors, { 'prize-1': 'sponsor-a' });
  assert.equal(stage.sponsorForPrize(sponsors, 'prize-1').name, 'Acme');
  assert.equal(stage.sponsorForPrize({ ...sponsors, enabled: false }, 'prize-1'), null);
});

test('sponsor links and logos are only ever safe ones', () => {
  const sponsors = stage.normalizeSponsors({
    items: [
      { name: 'A', url: 'javascript:alert(1)', logo: { src: '../../etc/passwd' } },
      { name: 'B', url: 'acme.example', logo: { src: 'assets/sponsor-0123456789.png' } },
    ],
  });
  assert.equal(sponsors.items[0].url, '');
  assert.equal(sponsors.items[0].logo.src, '');
  assert.equal(sponsors.items[1].url, 'https://acme.example');
  assert.equal(sponsors.items[1].logo.src, 'assets/sponsor-0123456789.png');
});

test('the remote key is checked safely, and expires', () => {
  const key = stage.newRemoteKey();
  const remote = stage.normalizeRemote({ enabled: true, key, keyExpiresAt: '2030-01-01T00:00:00Z' });
  assert.equal(stage.remoteKeyMatches(remote, key, Date.parse('2029-12-31T00:00:00Z')), true);
  assert.equal(stage.remoteKeyMatches(remote, key, Date.parse('2030-01-02T00:00:00Z')), false);
  assert.equal(stage.remoteKeyMatches(remote, `${key}x`), false);
  assert.equal(stage.remoteKeyMatches({ ...remote, enabled: false }, key), false);
  assert.equal(stage.publicRemote(remote).key, undefined);
});

/* --------------------------------------------------------------- the lease */

/** A board checking in, keeping the lease token it is given, as a browser would. */
function makeBoard(id, { signedIn = true, role = 'auto', page = 'board' } = {}) {
  let token = null;
  return {
    poll(appSettings, extra = {}, now = Date.now()) {
      const result = live.poll({ boardId: id, role, page, leaseToken: token, ...extra }, appSettings, now, { signedIn });
      if (result.response.leaseToken) token = result.response.leaseToken;
      return result;
    },
    publish(appSettings, status) {
      return live.publishStatus({ boardId: id, leaseToken: token, ...status }, appSettings);
    },
    token: () => token,
  };
}

test('nobody takes control while live sync and the remote are both off', () => {
  assert.equal(makeBoard(BOARD_A).poll(settings()).response.controller.active, false);
});

test('the first signed-in board takes control and a second one follows', () => {
  const appSettings = settings({ liveSync: { enabled: true } });
  const first = makeBoard(BOARD_A).poll(appSettings).response;
  assert.equal(first.controller.isYou, true);
  assert.ok(first.leaseToken);
  const second = makeBoard(BOARD_B).poll(appSettings).response;
  assert.equal(second.controller.isYou, false);
  assert.equal(second.controller.active, true);
  assert.equal(second.leaseToken, null);
});

test('a board that is not signed in cannot take control unless the organiser allows it', () => {
  const strict = settings({ liveSync: { enabled: true } });
  assert.equal(makeBoard(BOARD_A, { signedIn: false }).poll(strict).response.controller.isYou, false);
  const open = settings({ liveSync: { enabled: true, claimRequiresSignIn: false } });
  assert.equal(makeBoard(BOARD_A, { signedIn: false }).poll(open).response.controller.isYou, true);
});

test('knowing the controller\'s id is not enough to act as it', () => {
  const appSettings = settings({ liveSync: { enabled: true, claimRequiresSignIn: false } });
  makeBoard(BOARD_A).poll(appSettings);
  // An impostor with the right id but no token.
  const impostor = live.poll({ boardId: BOARD_A, page: 'board' }, appSettings).response;
  assert.equal(impostor.controller.isYou, false);
  assert.equal(live.publishStatus({ boardId: BOARD_A, state: 'rolling' }, appSettings).ok, false);
});

test('events never reveal which board caused them', () => {
  const appSettings = settings({ liveSync: { enabled: true } });
  const controller = makeBoard(BOARD_A);
  controller.poll(appSettings);
  const follower = makeBoard(BOARD_B);
  const baseline = follower.poll(appSettings).response.seq;
  live.appendEvent('draw', { winner: {} }, BOARD_A);
  const [event] = follower.poll(appSettings, { after: baseline }).response.events;
  assert.equal(event.origin, undefined);
  assert.equal(event.mine, false);
  const [own] = controller.poll(appSettings, { after: baseline }).response.events;
  assert.equal(own.mine, true);
});

test('a malformed origin is not stored in the feed', () => {
  live.appendEvent('draw', {}, '<script>'.repeat(50));
  assert.equal(live.readLive().events.at(-1).origin, null);
});

test('a welcome screen never takes control', () => {
  const appSettings = settings({ liveSync: { enabled: true } });
  assert.equal(makeBoard(BOARD_A, { page: 'welcome' }).poll(appSettings).response.controller.isYou, false);
});

test('in main-only mode just a main board controls, and it outranks an auto one', () => {
  const autoMode = settings({ liveSync: { enabled: true } });
  makeBoard(BOARD_A).poll(autoMode);
  assert.equal(makeBoard(BOARD_B, { role: 'main' }).poll(autoMode).response.controller.isYou, true);

  store.writeDocument('live', { seq: 0, revision: 0, events: [], controller: null, status: null });
  const mainOnly = settings({ liveSync: { enabled: true, controllerMode: 'main-only' } });
  assert.equal(makeBoard(BOARD_A).poll(mainOnly).response.controller.isYou, false);
});

test('control passes on once the lease runs out', () => {
  const appSettings = settings({ liveSync: { enabled: true, leaseSeconds: 5, pollMs: 500 } });
  const now = Date.now();
  makeBoard(BOARD_A).poll(appSettings, {}, now);
  const other = makeBoard(BOARD_B);
  assert.equal(other.poll(appSettings, {}, now + 2000).response.controller.isYou, false);
  assert.equal(other.poll(appSettings, {}, now + 6000).response.controller.isYou, true);
});

test('the lease always outlasts a few check-ins, whatever was configured', () => {
  const appSettings = settings({ liveSync: { enabled: true, leaseSeconds: 5, pollMs: 4000 } });
  const now = Date.now();
  makeBoard(BOARD_A).poll(appSettings, {}, now);
  // 5 s configured, but a board checking every 4 s keeps control for 16 s.
  assert.equal(makeBoard(BOARD_B).poll(appSettings, {}, now + 9000).response.controller.isYou, false);
});

test('checking in renews the lease only now and then', () => {
  const appSettings = settings({ liveSync: { enabled: true, leaseSeconds: 30, pollMs: 1000 } });
  const now = Date.now();
  const board = makeBoard(BOARD_A);
  assert.equal(board.poll(appSettings, {}, now).wrote, true);
  assert.equal(board.poll(appSettings, {}, now + 1000).wrote, false);
  assert.equal(board.poll(appSettings, {}, now + 11000).wrote, true);
});

/* ---------------------------------------------------------------- the feed */

test('the controller rolling and changing screen reaches the followers', () => {
  const appSettings = settings({ liveSync: { enabled: true } });
  const controller = makeBoard(BOARD_A);
  controller.poll(appSettings);
  const follower = makeBoard(BOARD_B);
  const baseline = follower.poll(appSettings).response.seq;

  controller.publish(appSettings, { state: 'idle', screen: 'board' });
  controller.publish(appSettings, { state: 'rolling', screen: 'board', prizeNumber: 1 });
  controller.publish(appSettings, { state: 'idle', screen: 'welcome' });

  const { events } = follower.poll(appSettings, { after: baseline }).response;
  assert.deepEqual(events.map((event) => event.type), ['roll', 'screen']);
  assert.equal(events[1].data.screen, 'welcome');
});

test('a follower cannot publish status', () => {
  const appSettings = settings({ liveSync: { enabled: true } });
  makeBoard(BOARD_A).poll(appSettings);
  const follower = makeBoard(BOARD_B);
  follower.poll(appSettings);
  assert.equal(follower.publish(appSettings, { state: 'rolling' }).ok, false);
});

test('remote commands reach the controller only', () => {
  const appSettings = settings({ remote: { enabled: true } });
  const controller = makeBoard(BOARD_A);
  controller.poll(appSettings);
  live.pushCommand('toggle');
  live.pushCommand('screen', 'prizes');

  const response = controller.poll(appSettings, { commandsAfter: 0 }).response;
  assert.deepEqual(response.commands.map((command) => command.action), ['toggle', 'screen']);
  const follower = makeBoard(BOARD_B);
  assert.deepEqual(follower.poll(appSettings, { commandsAfter: 0 }).response.commands, []);
  const later = controller.poll(appSettings, { commandsAfter: response.commandSeq }).response;
  assert.deepEqual(later.commands, []);
});

test('a screen too far behind is told to start again from the state', () => {
  const appSettings = settings({ liveSync: { enabled: true } });
  for (let index = 0; index < 120; index += 1) live.appendEvent('data', {});
  const board = makeBoard(BOARD_B);
  assert.equal(board.poll(appSettings, { after: 3 }).response.resync, true);
  assert.equal(board.poll(appSettings, { after: 119 }).response.resync, false);
});

test('saving settings bumps the revision every screen watches', () => {
  const { saveSettingsFile, loadSettingsFile } = require('../server/settings');
  const before = live.readLive().revision;
  saveSettingsFile(loadSettingsFile());
  assert.equal(live.readLive().revision, before + 1);
});

/* ------------------------------------------------------------- reset event */

test('a reset clears only what was chosen', async () => {
  const appSettings = settings({ prizes: { items: [{ name: 'Car' }] }, ui: { primaryColor: '#123456' } });
  draw.drawWinner(appSettings);
  let saved = null;
  const result = await reset.resetEvent({ results: true }, appSettings, { normalizeAppSettings, saveSettings: (next) => { saved = next; } });
  assert.equal(result.ok, true);
  assert.equal(draw.loadDrawState().winners.length, 0);
  assert.equal(ticketStore.loadTicketSource(appSettings.data).tickets.length, 8);
  assert.equal(saved.prizes.items[0].name, 'Car');
  assert.equal(saved.ui.primaryColor, '#123456');
});

test('a settings reset returns the board to defaults but keeps content and artwork unless asked', async () => {
  const appSettings = settings({
    prizes: { items: [{ name: 'Car' }] },
    ui: { primaryColor: '#123456' },
    branding: { logo: { src: 'assets/logo-0123456789.png' } },
  });
  let saved = null;
  await reset.resetEvent({ settings: true }, appSettings, { normalizeAppSettings, saveSettings: (next) => { saved = next; } });
  assert.equal(saved.ui.primaryColor, normalizeAppSettings({}).ui.primaryColor);
  assert.equal(saved.prizes.items[0].name, 'Car');
  assert.equal(saved.branding.logo.src, 'assets/logo-0123456789.png');
});

test('a reset always unpairs the remote and keeps templates unless chosen', async () => {
  const appSettings = settings({ remote: { enabled: true, key: stage.newRemoteKey() } });
  templates.createTemplate({ name: 'Keep me', sections: ['look'] }, appSettings, normalizeAppSettings);
  let saved = null;
  await reset.resetEvent({ entries: true }, appSettings, { normalizeAppSettings, saveSettings: (next) => { saved = next; } });
  assert.equal(saved.remote.key, '');
  assert.equal(ticketStore.loadTicketSource(appSettings.data).tickets.length, 0);
  assert.ok(templates.listTemplates(normalizeAppSettings).some((template) => template.name === 'Keep me'));
});

test('a reset with nothing chosen does nothing', async () => {
  const result = await reset.resetEvent({}, settings(), { normalizeAppSettings, saveSettings: () => assert.fail('saved') });
  assert.equal(result.ok, false);
});

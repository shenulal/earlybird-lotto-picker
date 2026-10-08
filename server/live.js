'use strict';

/**
 * The live channel between screens: a short feed of what has happened, which
 * board is in control, and the commands a phone remote has sent.
 *
 * Every screen checks in on a timer (`poll`). One draw board at a time holds a
 * lease and is the *controller*: it runs the draw and carries out remote
 * commands. The others are followers, mirroring what the feed tells them. The
 * draw itself is still made once, on the server, by whoever asks — so two
 * screens can never pick two winners for one press.
 *
 * Writes are kept rare on purpose. A check-in is a read; the lease is renewed
 * only every third of its length, and the feed is written only when something
 * actually happens. On a key-value store that is the difference between a few
 * requests a minute and a few a second per screen.
 */

const crypto = require('crypto');

const store = require('./store');

const MAX_EVENTS = 100;
const MAX_COMMANDS = 50;
const BOARD_ID = /^[A-Za-z0-9_-]{16,64}$/;
const ROLES = Object.freeze(['auto', 'main']);
const PAGES = Object.freeze(['board', 'welcome', 'prizes']);
const STATES = Object.freeze(['idle', 'announcing', 'rolling', 'revealing', 'complete']);

const EMPTY_LIVE = Object.freeze({ seq: 0, revision: 0, events: [], controller: null, status: null });
const EMPTY_REMOTE = Object.freeze({ seq: 0, commands: [] });

function readLive() {
  const live = store.readDocument('live', EMPTY_LIVE) || EMPTY_LIVE;
  return {
    seq: Number(live.seq) || 0,
    revision: Number(live.revision) || 0,
    events: Array.isArray(live.events) ? live.events : [],
    controller: live.controller && typeof live.controller === 'object' ? live.controller : null,
    status: live.status && typeof live.status === 'object' ? live.status : null,
  };
}

function readRemote() {
  const remote = store.readDocument('remote', EMPTY_REMOTE) || EMPTY_REMOTE;
  return { seq: Number(remote.seq) || 0, commands: Array.isArray(remote.commands) ? remote.commands : [] };
}

/**
 * Adds something that happened to the feed. `origin` is the board that caused
 * it, so that board does not act on its own news a second time.
 */
function appendEvent(type, data = {}, origin = null) {
  const live = readLive();
  // FIX: only a well-formed id is kept, so a caller cannot park arbitrary
  // data in the shared feed.
  const event = { seq: live.seq + 1, type, at: new Date().toISOString(), origin: asBoardId(origin), data };
  store.writeDocument('live', { ...live, seq: event.seq, events: [...live.events, event].slice(-MAX_EVENTS) });
  return event;
}

/** Tells every screen the settings changed, so each reloads them. */
function bumpRevision() {
  const live = readLive();
  store.writeDocument('live', { ...live, revision: live.revision + 1 });
}

/**
 * How long a claim on control lasts without a check-in. Never shorter than a
 * few check-ins, whatever was configured, or control would flap between
 * boards whenever a check-in ran a little late.
 */
function leaseMs(appSettings) {
  const { liveSync, remote } = appSettings;
  const slowest = Math.max(liveSync.pollMs, remote.enabled ? remote.pollMs : 0);
  return Math.max(liveSync.leaseSeconds * 1000, slowest * 4);
}

function leaseIsLive(controller, appSettings, now) {
  return Boolean(controller) && now - Date.parse(controller.seenAt) < leaseMs(appSettings);
}

function hashToken(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

/**
 * Whether a request speaks for the board holding control: its id and the
 * lease token it was given when it claimed — compared as hashes, in constant
 * time. The id alone is not proof; ids are not secrets.
 */
function holdsLease(controller, boardId, token) {
  if (!controller || !boardId || controller.boardId !== boardId || typeof token !== 'string' || !token) return false;
  const expected = Buffer.from(controller.tokenHash || '', 'hex');
  const actual = Buffer.from(hashToken(token), 'hex');
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

/** A board id as given, if it looks like one; anything else is nobody. */
function asBoardId(value) {
  return typeof value === 'string' && BOARD_ID.test(value) ? value : null;
}

/**
 * One screen checking in.
 *
 * Claims or renews the controller lease where the rules allow, and answers
 * with what happened since `after`, the controller's status, and — for the
 * controller only — remote commands since `commandsAfter`.
 *
 * Taking control needs an organiser sign-in in that browser, unless the
 * organiser chose otherwise: control is what the phone remote's commands go
 * to, and what decides which screens show Start and Stop.
 */
function poll(input, appSettings, now = Date.now(), { signedIn = false } = {}) {
  const { liveSync, remote } = appSettings;
  const boardId = asBoardId(input.boardId);
  const role = ROLES.includes(input.role) ? input.role : 'auto';
  const page = PAGES.includes(input.page) ? input.page : 'board';
  // No cursor at all is a screen's first check-in: it takes the current
  // position and is sent no history. Zero is a real position — "seen nothing
  // yet" on a brand-new feed — and must still receive what follows.
  const initial = input.after === undefined || input.after === null || input.after === '';
  const after = initial ? 0 : Math.max(0, Number(input.after) || 0);
  const commandsAfter = Math.max(0, Number(input.commandsAfter) || 0);

  const live = readLive();
  const needsController = liveSync.enabled || remote.enabled;
  let controller = leaseIsLive(live.controller, appSettings, now) ? live.controller : null;
  let isController = holdsLease(controller, boardId, input.leaseToken);
  let leaseToken = null;
  let wrote = false;

  const mayClaim = signedIn || !liveSync.claimRequiresSignIn;
  if (needsController && boardId && !isController && mayClaim && page === 'board') {
    const allowedRole = liveSync.controllerMode === 'auto' || role === 'main';
    // A board opened as the main one takes over from one that only claimed
    // control by being first.
    const outranks = role === 'main' && controller && controller.role !== 'main';
    if (allowedRole && (!controller || outranks)) {
      leaseToken = crypto.randomBytes(24).toString('base64url');
      controller = { boardId, role, page, tokenHash: hashToken(leaseToken), seenAt: new Date(now).toISOString() };
      isController = true;
      wrote = true;
    }
  } else if (isController) {
    // Renewed only now and then: a check-in is otherwise a pure read.
    const stale = now - Date.parse(controller.seenAt) > leaseMs(appSettings) / 3;
    if (stale || controller.page !== page) {
      controller = { ...controller, page, seenAt: new Date(now).toISOString() };
      wrote = true;
    }
  }

  if (wrote) store.writeDocument('live', { ...live, controller });

  const oldest = live.events.length ? live.events[0].seq : live.seq + 1;
  // Which board caused an event is never sent out — only whether it was the
  // one asking, so it can skip its own news.
  const events = live.events
    .filter((event) => event.seq > after)
    .map(({ origin, ...event }) => ({ ...event, mine: Boolean(boardId && origin === boardId) }));
  const remoteDoc = isController && remote.enabled ? readRemote() : null;

  return {
    wrote,
    response: {
      ok: true,
      enabled: needsController,
      seq: live.seq,
      revision: live.revision,
      // Too far behind to catch up from the feed: start again from the state.
      resync: !initial && (after > live.seq || after < oldest - 1),
      events: initial ? [] : events,
      status: live.status,
      controller: { active: Boolean(controller), isYou: isController, page: controller ? controller.page : null },
      // Only ever sent to the board that has just claimed control.
      leaseToken,
      commandSeq: remoteDoc ? remoteDoc.seq : null,
      commands: remoteDoc ? remoteDoc.commands.filter((command) => command.seq > commandsAfter) : [],
      serverTime: new Date(now).toISOString(),
    },
  };
}

/**
 * The controller saying what it is doing. Followers are told when it starts
 * rolling and when it moves to another screen; everything else is status.
 */
function publishStatus(input, appSettings, now = Date.now()) {
  const live = readLive();
  const controller = leaseIsLive(live.controller, appSettings, now) ? live.controller : null;
  if (!holdsLease(controller, asBoardId(input.boardId), input.leaseToken)) return { ok: false, reason: 'not-controller' };

  const state = STATES.includes(input.state) ? input.state : 'idle';
  const screen = PAGES.includes(input.screen) ? input.screen : 'board';
  const previous = live.status || {};
  const status = {
    state,
    screen,
    prizeNumber: Number(input.prizeNumber) || null,
    updatedAt: new Date(now).toISOString(),
  };

  const events = [];
  if (state === 'rolling' && previous.state !== 'rolling') events.push({ type: 'roll', data: { prizeNumber: status.prizeNumber } });
  if (screen !== previous.screen && previous.screen) events.push({ type: 'screen', data: { screen } });

  let seq = live.seq;
  const appended = events.map((event) => {
    seq += 1;
    return { seq, type: event.type, at: status.updatedAt, origin: controller.boardId, data: event.data };
  });

  store.writeDocument('live', {
    ...live,
    seq,
    status,
    controller: { ...controller, seenAt: status.updatedAt },
    events: [...live.events, ...appended].slice(-MAX_EVENTS),
  });
  return { ok: true, status };
}

/** Queues a command from the phone remote for the controller to carry out. */
function pushCommand(action, value) {
  const remote = readRemote();
  const command = { seq: remote.seq + 1, action, value: value === undefined ? null : value, at: new Date().toISOString() };
  store.writeDocument('remote', { seq: command.seq, commands: [...remote.commands, command].slice(-MAX_COMMANDS) });
  return command;
}

/** Whether a controller is listening right now. */
function controllerActive(appSettings, now = Date.now()) {
  const live = readLive();
  return leaseIsLive(live.controller, appSettings, now);
}

/** Forgets every command and the controller — after a reset or a new key. */
function clearRemote() {
  store.writeDocument('remote', { seq: readRemote().seq, commands: [] });
}

module.exports = {
  BOARD_ID,
  asBoardId,
  readLive,
  appendEvent,
  bumpRevision,
  poll,
  publishStatus,
  pushCommand,
  controllerActive,
  clearRemote,
};

'use strict';

const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

const { useTemporaryDataDir, sampleTickets, TICKET_DATA } = require('./helpers');

useTemporaryDataDir();

const store = require('../server/store');
const draw = require('../server/draw');
const ticketStore = require('../server/tickets');
const { normalizeAppSettings } = require('../server/settings');

function settings(overrides = {}) {
  return normalizeAppSettings({ totalPrizes: 3, data: TICKET_DATA, ...overrides });
}

beforeEach(async () => {
  await store.hydrate({ force: true });
  ticketStore.saveTickets(sampleTickets(10));
  draw.resetDraw(settings());
});

test('draws award prizes in order and never repeat an entry', () => {
  const appSettings = settings();
  const seen = new Set();
  [1, 2, 3].forEach((expectedPrize) => {
    const result = draw.drawWinner(appSettings);
    assert.equal(result.ok, true);
    assert.equal(result.winner.prizeNumber, expectedPrize);
    assert.ok(!seen.has(result.winner.record.ticket));
    seen.add(result.winner.record.ticket);
  });
  assert.equal(draw.drawWinner(appSettings).reason, 'prizes-exhausted');
});

test('lowest-first counts back from the last prize', () => {
  const appSettings = settings({ prizes: { drawOrder: 'lowest-first' } });
  assert.deepEqual(
    [1, 2, 3].map(() => draw.drawWinner(appSettings).winner.prizeNumber),
    [3, 2, 1]
  );
});

test('the first draw records the entry-list fingerprint and the pool size', () => {
  const first = draw.drawWinner(settings());
  const state = draw.loadDrawState();
  assert.equal(state.poolSize, 10);
  assert.equal(state.poolFingerprint, draw.poolFingerprint(sampleTickets(10)));
  assert.equal(first.winner.poolSize, 10);
});

test('the fingerprint ignores row order but notices a changed entry', () => {
  const tickets = sampleTickets(5);
  const reversed = [...tickets].reverse();
  assert.equal(draw.poolFingerprint(tickets), draw.poolFingerprint(reversed));
  const edited = tickets.map((ticket, index) => (index === 2 ? { ...ticket, name: 'Someone else' } : ticket));
  assert.notEqual(draw.poolFingerprint(tickets), draw.poolFingerprint(edited));
});

test('marking absent is refused while the redraw is switched off', () => {
  draw.drawWinner(settings());
  assert.equal(draw.markAbsent(settings(), undefined).reason, 'redraw-disabled');
});

test('a winner marked absent opens their prize for the very next draw', () => {
  const appSettings = settings({ redraw: { enabled: true } });
  draw.drawWinner(appSettings);
  const second = draw.drawWinner(appSettings);

  const struck = draw.markAbsent(appSettings, undefined);
  assert.equal(struck.ok, true);
  assert.equal(struck.absent.drawIndex, second.winner.drawIndex);
  assert.equal(struck.stats.nextPrizeNumber, 2);

  const redraw = draw.drawWinner(appSettings);
  assert.equal(redraw.winner.prizeNumber, 2);
  // A fresh draw index, never the struck-off one again.
  assert.equal(redraw.winner.drawIndex, 3);
  assert.notEqual(redraw.winner.record.ticket, struck.absent.record.ticket);
});

test('an absent entry stays out of the pool unless returned to it', () => {
  const excluded = settings({ redraw: { enabled: true } });
  draw.drawWinner(excluded);
  draw.markAbsent(excluded);
  assert.equal(draw.statsFor(excluded, sampleTickets(10), draw.loadDrawState()).remainingTickets, 9);

  const returned = settings({ redraw: { enabled: true, returnToPool: true } });
  assert.equal(draw.statsFor(returned, sampleTickets(10), draw.loadDrawState()).remainingTickets, 10);
});

test('the per-prize redraw limit is enforced', () => {
  const appSettings = settings({ redraw: { enabled: true, maxPerPrize: 1 } });
  draw.drawWinner(appSettings);
  assert.equal(draw.markAbsent(appSettings).ok, true);
  draw.drawWinner(appSettings);
  assert.equal(draw.markAbsent(appSettings).reason, 'redraw-limit');
});

test('an earlier winner can be struck off and their prize is drawn next', () => {
  const appSettings = settings({ redraw: { enabled: true } });
  const first = draw.drawWinner(appSettings);
  draw.drawWinner(appSettings);
  assert.equal(draw.markAbsent(appSettings, first.winner.drawIndex).ok, true);
  assert.equal(draw.drawWinner(appSettings).winner.prizeNumber, 1);
});

test('restoring puts a winner back only while their prize is still open', () => {
  const appSettings = settings({ redraw: { enabled: true } });
  const first = draw.drawWinner(appSettings);
  draw.markAbsent(appSettings);

  const restored = draw.restoreAbsent(appSettings, first.winner.drawIndex);
  assert.equal(restored.ok, true);
  assert.equal(draw.loadDrawState().winners.length, 1);

  draw.markAbsent(appSettings);
  draw.drawWinner(appSettings);
  assert.equal(draw.restoreAbsent(appSettings, first.winner.drawIndex).reason, 'prize-taken');
});

test('reset clears winners, absentees, the sequence and the fingerprint', () => {
  const appSettings = settings({ redraw: { enabled: true } });
  draw.drawWinner(appSettings);
  draw.markAbsent(appSettings);
  draw.resetDraw(appSettings);
  const state = draw.loadDrawState();
  assert.deepEqual([state.winners.length, state.absent.length, state.sequence, state.poolFingerprint], [0, 0, 0, null]);
});

test('a draw state written before the redraw existed still loads', async () => {
  store.writeDocument('draw', { winners: [{ prizeNumber: 1, drawIndex: 1, record: { ticket: 'T-001' } }], startedAt: null });
  const state = draw.loadDrawState();
  assert.deepEqual(state.absent, []);
  assert.equal(state.sequence, 1);
  assert.equal(draw.drawWinner(settings()).winner.drawIndex, 2);
});

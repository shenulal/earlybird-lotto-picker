'use strict';

const crypto = require('crypto');

const { PATHS } = require('./paths');
const { readJson, writeJson } = require('./store');
const { loadTicketSource } = require('./tickets');

const EMPTY_STATE = Object.freeze({ winners: [], absent: [], startedAt: null, updatedAt: null });

/**
 * The draw as recorded.
 *
 * `absent` holds winners struck off as not present. `sequence` counts every
 * draw ever made, so a draw index is never reused once a winner is struck off
 * and the prize drawn again. A file written before either existed reads as
 * having none.
 */
function loadDrawState() {
  const state = readJson(PATHS.drawState, EMPTY_STATE) || EMPTY_STATE;
  const winners = Array.isArray(state.winners) ? state.winners : [];
  const absent = Array.isArray(state.absent) ? state.absent : [];
  const highest = [...winners, ...absent].reduce((top, entry) => Math.max(top, Number(entry.drawIndex) || 0), 0);

  return {
    winners,
    absent,
    sequence: Math.max(Number(state.sequence) || 0, highest),
    poolFingerprint: typeof state.poolFingerprint === 'string' ? state.poolFingerprint : null,
    poolSize: Number.isFinite(Number(state.poolSize)) && state.poolSize !== null ? Number(state.poolSize) : null,
    startedAt: state.startedAt || null,
    updatedAt: state.updatedAt || null,
  };
}

function saveDrawState(state) {
  writeJson(PATHS.drawState, { ...state, updatedAt: new Date().toISOString() });
}

function readTickets(appSettings) {
  return loadTicketSource(appSettings.data, appSettings.data.duplicatePolicy);
}

function identity(record, identifier) {
  return String((record && record[identifier]) ?? '').toLowerCase();
}

/**
 * Entries still in the draw: everyone not yet drawn and, unless the organiser
 * returns them to the pool, not struck off as absent either.
 */
function remainingPool(tickets, winners, identifier, absent = []) {
  const drawn = new Set([...winners, ...absent].map((entry) => identity(entry.record, identifier)));
  return tickets.filter((ticket) => !drawn.has(String(ticket[identifier] || '').toLowerCase()));
}

function excludedAbsent(appSettings, state) {
  return appSettings.redraw && appSettings.redraw.returnToPool ? [] : state.absent;
}

/**
 * The prize position each draw awards, in the order the organiser chose:
 * highest-first runs 1, 2, 3…, lowest-first counts back from the last prize so
 * the evening builds to the top one.
 */
function prizeOrder(appSettings) {
  const total = appSettings.totalPrizes;
  const ascending = Array.from({ length: total }, (_unused, index) => index + 1);
  return appSettings.prizes.drawOrder === 'lowest-first' ? ascending.reverse() : ascending;
}

/**
 * The prize the next draw awards: the first in order that nobody holds.
 *
 * With no winner ever struck off this is exactly the next position in the
 * sequence. Once a winner is marked absent their prize is open again, and it
 * is the one drawn next — the room redraws the prize it was just watching.
 */
function nextPrizeNumber(appSettings, winners) {
  const awarded = new Set(winners.map((winner) => Number(winner.prizeNumber)));
  const open = prizeOrder(appSettings).find((prize) => !awarded.has(prize));
  return open === undefined ? null : open;
}

/** Kept for callers that think in draw positions rather than prizes held. */
function prizeNumberForDraw(appSettings, drawIndex) {
  const order = prizeOrder(appSettings);
  return order[Math.min(drawIndex, order.length - 1)] || 1;
}

/**
 * A fingerprint of the entry list, independent of row order.
 *
 * Each record is written as its fields in key order, the records are sorted,
 * and the lot is hashed. Recorded when the first winner is drawn, so the
 * certificate can show exactly which list the draw ran against — and anyone
 * holding that list can recompute it.
 */
function poolFingerprint(tickets) {
  const lines = tickets
    .map((ticket) =>
      Object.keys(ticket)
        .sort()
        .map((key) => `${key}=${ticket[key] === null || ticket[key] === undefined ? '' : String(ticket[key])}`)
        .join('\u001f')
    )
    .sort();
  return crypto.createHash('sha256').update(lines.join('\n'), 'utf8').digest('hex');
}

function buildStats(appSettings, tickets, winners, absent = []) {
  const totalPrizes = appSettings.totalPrizes;
  const excluded = appSettings.redraw && appSettings.redraw.returnToPool ? [] : absent;
  const remainingTickets = remainingPool(tickets, winners, appSettings.data.identifier, excluded).length;

  return {
    totalPrizes,
    winnersCount: winners.length,
    absentCount: absent.length,
    remainingPrizes: Math.max(0, totalPrizes - winners.length),
    totalTickets: tickets.length,
    remainingTickets,
    isComplete: winners.length >= totalPrizes || remainingTickets === 0,
    // What the next Start will award, so the board can announce it first.
    nextPrizeNumber: winners.length < totalPrizes ? nextPrizeNumber(appSettings, winners) : null,
  };
}

function statsFor(appSettings, tickets, state) {
  return buildStats(appSettings, tickets, state.winners, state.absent);
}

/**
 * Performs one draw and persists it. Returns a discriminated result rather
 * than throwing, because "no prizes left" is an expected outcome on stage.
 */
function drawWinner(appSettings) {
  const { tickets } = readTickets(appSettings);
  const state = loadDrawState();

  if (tickets.length === 0) {
    return { ok: false, reason: 'no-tickets', message: 'No participants have been uploaded yet.' };
  }

  const prizeNumber = nextPrizeNumber(appSettings, state.winners);
  if (state.winners.length >= appSettings.totalPrizes || prizeNumber === null) {
    return { ok: false, reason: 'prizes-exhausted', message: 'All prizes have already been awarded.' };
  }

  const pool = remainingPool(tickets, state.winners, appSettings.data.identifier, excludedAbsent(appSettings, state));
  if (pool.length === 0) {
    return { ok: false, reason: 'pool-empty', message: 'Every ticket has already been drawn.' };
  }

  // crypto.randomInt is uniform; Math.random is not suitable for a draw whose
  // fairness has to be defensible.
  const selected = pool[crypto.randomInt(0, pool.length)];
  const isFirstDraw = state.winners.length === 0 && state.absent.length === 0;
  const winner = {
    prizeNumber,
    drawIndex: state.sequence + 1,
    drawnAt: new Date().toISOString(),
    // How many entries this draw chose from — the odds the room actually had.
    poolSize: pool.length,
    record: selected,
  };

  const nextState = {
    ...state,
    sequence: winner.drawIndex,
    startedAt: state.startedAt || winner.drawnAt,
    poolFingerprint: isFirstDraw || !state.poolFingerprint ? poolFingerprint(tickets) : state.poolFingerprint,
    poolSize: isFirstDraw || state.poolSize === null ? tickets.length : state.poolSize,
    winners: [...state.winners, winner],
  };

  saveDrawState(nextState);

  return { ok: true, winner, stats: statsFor(appSettings, tickets, nextState) };
}

/**
 * Strikes a winner off as not present, opening their prize again.
 *
 * `drawIndex` names the winner; without it the most recent is meant, which is
 * the one on the board. The entry is kept in `absent` with when it happened,
 * so the result stays auditable rather than quietly disappearing.
 */
function markAbsent(appSettings, drawIndex) {
  const redraw = appSettings.redraw || {};
  if (!redraw.enabled) {
    return { ok: false, reason: 'redraw-disabled', message: 'Redrawing for a winner who is not present is switched off.' };
  }

  const state = loadDrawState();
  if (state.winners.length === 0) {
    return { ok: false, reason: 'no-winner', message: 'There is no winner to mark as not present.' };
  }

  const wanted = drawIndex === undefined || drawIndex === null || drawIndex === '' ? null : Number(drawIndex);
  const target = wanted === null
    ? state.winners[state.winners.length - 1]
    : state.winners.find((winner) => Number(winner.drawIndex) === wanted);
  if (!target) {
    return { ok: false, reason: 'not-found', message: 'That winner is no longer in the results.' };
  }

  const redrawn = state.absent.filter((entry) => Number(entry.prizeNumber) === Number(target.prizeNumber)).length;
  if (redraw.maxPerPrize > 0 && redrawn >= redraw.maxPerPrize) {
    return {
      ok: false,
      reason: 'redraw-limit',
      message: `This prize has already been redrawn ${redrawn} time(s), the most allowed.`,
    };
  }

  const struck = { ...target, absentAt: new Date().toISOString() };
  const nextState = {
    ...state,
    winners: state.winners.filter((winner) => winner !== target),
    absent: [...state.absent, struck],
  };
  saveDrawState(nextState);

  return { ok: true, absent: struck, stats: statsFor(appSettings, readTickets(appSettings).tickets, nextState) };
}

/**
 * Puts a winner struck off by mistake back in the results.
 *
 * Only while their prize is still open and they have not been drawn again
 * since — otherwise two people would hold one prize, or one person two.
 */
function restoreAbsent(appSettings, drawIndex) {
  const state = loadDrawState();
  const target = state.absent.find((entry) => Number(entry.drawIndex) === Number(drawIndex));
  if (!target) return { ok: false, reason: 'not-found', message: 'That entry is not in the not-present list.' };

  const identifier = appSettings.data.identifier;
  if (state.winners.some((winner) => Number(winner.prizeNumber) === Number(target.prizeNumber))) {
    return { ok: false, reason: 'prize-taken', message: 'That prize has already been drawn again.' };
  }
  if (state.winners.some((winner) => identity(winner.record, identifier) === identity(target.record, identifier))) {
    return { ok: false, reason: 'already-winner', message: 'That entry has since won another prize.' };
  }

  const { absentAt: _absentAt, ...restored } = target;
  const winners = [...state.winners, restored].sort((a, b) => Number(a.drawIndex) - Number(b.drawIndex));
  const nextState = { ...state, winners, absent: state.absent.filter((entry) => entry !== target) };
  saveDrawState(nextState);

  return { ok: true, restored, stats: statsFor(appSettings, readTickets(appSettings).tickets, nextState) };
}

function undoLastWinner(appSettings) {
  const state = loadDrawState();
  if (state.winners.length === 0) {
    return { ok: false, reason: 'nothing-to-undo', message: 'There are no draws to undo.' };
  }

  const removed = state.winners[state.winners.length - 1];
  const nextState = { ...state, winners: state.winners.slice(0, -1) };
  saveDrawState(nextState);

  return { ok: true, removed, stats: statsFor(appSettings, readTickets(appSettings).tickets, nextState) };
}

function resetDraw(appSettings) {
  saveDrawState({ winners: [], absent: [], sequence: 0, poolFingerprint: null, poolSize: null, startedAt: null });
  return { ok: true, stats: buildStats(appSettings, readTickets(appSettings).tickets, [], []) };
}

module.exports = {
  prizeNumberForDraw,
  nextPrizeNumber,
  poolFingerprint,
  loadDrawState,
  saveDrawState,
  readTickets,
  remainingPool,
  buildStats,
  statsFor,
  drawWinner,
  markAbsent,
  restoreAbsent,
  undoLastWinner,
  resetDraw,
};

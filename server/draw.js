'use strict';

const crypto = require('crypto');

const { PATHS } = require('./paths');
const { readJson, writeJson } = require('./store');
const { loadTicketSource } = require('./tickets');

const EMPTY_STATE = Object.freeze({ winners: [], startedAt: null, updatedAt: null });

function loadDrawState() {
  const state = readJson(PATHS.drawState, EMPTY_STATE) || EMPTY_STATE;
  return {
    winners: Array.isArray(state.winners) ? state.winners : [],
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

function remainingPool(tickets, winners, identifier) {
  const drawn = new Set(winners.map((winner) => String(winner.record?.[identifier] ?? '').toLowerCase()));
  return tickets.filter((ticket) => !drawn.has(String(ticket[identifier] || '').toLowerCase()));
}

/**
 * The prize position a given draw awards.
 *
 * Draws happen in sequence, but the rank they carry depends on which end of
 * the list the organiser chose to start from: highest-first awards 1st, 2nd,
 * 3rd in turn, lowest-first counts back from the last prize so the evening
 * builds to the top one.
 */
function prizeNumberForDraw(appSettings, drawIndex) {
  const total = appSettings.totalPrizes;
  if (appSettings.prizes.drawOrder === 'lowest-first') {
    return Math.max(1, total - drawIndex);
  }
  return drawIndex + 1;
}

function buildStats(appSettings, tickets, winners) {
  const totalPrizes = appSettings.totalPrizes;
  const remainingTickets = remainingPool(tickets, winners, appSettings.data.identifier).length;

  return {
    totalPrizes,
    winnersCount: winners.length,
    remainingPrizes: Math.max(0, totalPrizes - winners.length),
    totalTickets: tickets.length,
    remainingTickets,
    isComplete: winners.length >= totalPrizes || remainingTickets === 0,
    // What the next Start will award, so the board can announce it first.
    nextPrizeNumber: winners.length < totalPrizes ? prizeNumberForDraw(appSettings, winners.length) : null,
  };
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

  if (state.winners.length >= appSettings.totalPrizes) {
    return { ok: false, reason: 'prizes-exhausted', message: 'All prizes have already been awarded.' };
  }

  const pool = remainingPool(tickets, state.winners, appSettings.data.identifier);
  if (pool.length === 0) {
    return { ok: false, reason: 'pool-empty', message: 'Every ticket has already been drawn.' };
  }

  // crypto.randomInt is uniform; Math.random is not suitable for a draw whose
  // fairness has to be defensible.
  const selected = pool[crypto.randomInt(0, pool.length)];
  const winner = {
    // The position awarded, which is not the sequence when the organiser
    // draws from the lowest prize upwards.
    prizeNumber: prizeNumberForDraw(appSettings, state.winners.length),
    drawIndex: state.winners.length + 1,
    drawnAt: new Date().toISOString(),
    record: selected,
  };

  const nextState = {
    ...state,
    startedAt: state.startedAt || winner.drawnAt,
    winners: [...state.winners, winner],
  };

  saveDrawState(nextState);

  return { ok: true, winner, stats: buildStats(appSettings, tickets, nextState.winners) };
}

function undoLastWinner(appSettings) {
  const state = loadDrawState();
  if (state.winners.length === 0) {
    return { ok: false, reason: 'nothing-to-undo', message: 'There are no draws to undo.' };
  }

  const removed = state.winners[state.winners.length - 1];
  const nextState = { ...state, winners: state.winners.slice(0, -1) };
  saveDrawState(nextState);

  return { ok: true, removed, stats: buildStats(appSettings, readTickets(appSettings).tickets, nextState.winners) };
}

function resetDraw(appSettings) {
  saveDrawState({ winners: [], startedAt: null });
  return { ok: true, stats: buildStats(appSettings, readTickets(appSettings).tickets, []) };
}

module.exports = {
  prizeNumberForDraw,
  loadDrawState,
  saveDrawState,
  readTickets,
  remainingPool,
  buildStats,
  drawWinner,
  undoLastWinner,
  resetDraw,
};

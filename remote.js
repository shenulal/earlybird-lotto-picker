/**
 * The phone remote.
 *
 * Opened from the QR code in the console, carrying the pairing key. Sends
 * commands; never draws itself. The draw board in control carries each one
 * out, so what the room sees is exactly what a press on the board would do.
 *
 * The key is taken out of the address bar as soon as it is read, so it does
 * not sit in the phone's history or on a screen anyone can photograph.
 */
(function remotePage(global, document) {
  'use strict';

  const KEY_STORE = 'pickora-remote-key';
  const $ = (id) => document.getElementById(id);
  const elements = {
    eventName: $('eventName'),
    connection: $('connection'),
    remote: $('remote'),
    notice: $('notice'),
    message: $('message'),
    statusLine: $('statusLine'),
    statusDetail: $('statusDetail'),
    primary: $('primaryBtn'),
    absent: $('absentBtn'),
    mute: $('muteBtn'),
    screenRow: $('screenRow'),
    statPrizes: $('statPrizes'),
    statDrawn: $('statDrawn'),
    statLeft: $('statLeft'),
  };

  let key = '';
  let snapshot = null;
  let pollTimer = null;
  let muted = false;
  let busy = false;

  function readKey() {
    const params = new URLSearchParams(global.location.search);
    const fromUrl = params.get('key');
    if (fromUrl) {
      try {
        global.sessionStorage.setItem(KEY_STORE, fromUrl);
      } catch (_error) {
        /* kept in memory for this page only */
      }
      params.delete('key');
      const rest = params.toString();
      global.history.replaceState(null, '', `${global.location.pathname}${rest ? `?${rest}` : ''}`);
      return fromUrl;
    }
    try {
      return global.sessionStorage.getItem(KEY_STORE) || '';
    } catch (_error) {
      return '';
    }
  }

  function buzz() {
    if (snapshot && snapshot.remote.haptics && global.navigator.vibrate) global.navigator.vibrate(25);
  }

  function say(text, tone = 'info') {
    elements.message.textContent = text || '';
    elements.message.dataset.tone = tone;
  }

  function showNotice(text) {
    elements.remote.hidden = true;
    elements.notice.hidden = false;
    elements.notice.textContent = text;
  }

  async function request(path, options = {}) {
    const response = await fetch(path, {
      credentials: 'same-origin',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      ...options,
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(payload.error || `Request failed (${response.status})`);
      error.status = response.status;
      throw error;
    }
    return payload;
  }

  /* --------------------------------------------------------------- render */

  function describe(winner) {
    if (!winner) return '';
    const record = winner.record || {};
    return snapshot.cardFields.map((field) => record[field]).filter((value) => value !== undefined && value !== '').join(' · ');
  }

  function render() {
    const { stats, status, copy, remote } = snapshot;
    elements.eventName.textContent = snapshot.eventName;
    elements.connection.dataset.state = snapshot.controller ? 'on' : 'off';
    elements.connection.textContent = snapshot.controller ? 'Draw board connected' : 'No draw board listening — open it on the event computer';

    const state = status ? status.state : 'idle';
    const rolling = state === 'rolling';
    elements.primary.dataset.mode = rolling ? 'stop' : 'start';
    elements.primary.textContent = rolling ? copy.stopButton : copy.startButton;
    elements.primary.hidden = !remote.actions.draw;
    elements.primary.disabled = busy || stats.isComplete || !snapshot.controller;

    if (rolling) {
      elements.statusLine.textContent = 'Spinning…';
      elements.statusDetail.textContent = snapshot.nextPrize ? snapshot.nextPrize.name : '';
    } else if (stats.isComplete) {
      elements.statusLine.textContent = 'All prizes awarded';
      elements.statusDetail.textContent = '';
    } else if (snapshot.lastWinner && state !== 'announcing') {
      elements.statusLine.textContent = describe(snapshot.lastWinner) || 'Winner drawn';
      const prize = snapshot.lastWinner.prize;
      elements.statusDetail.textContent = prize ? `${prize.label} — ${prize.name}` : `${copy.prizeLabel} ${snapshot.lastWinner.prizeNumber}`;
    } else {
      elements.statusLine.textContent = snapshot.nextPrize ? `Next: ${snapshot.nextPrize.name}` : 'Ready to draw';
      elements.statusDetail.textContent = snapshot.nextPrize ? snapshot.nextPrize.label : '';
    }

    elements.absent.textContent = copy.notPresentButton;
    elements.absent.hidden = !(remote.actions.notPresent && snapshot.notPresentAvailable);
    elements.absent.disabled = busy || rolling || !snapshot.lastWinner;

    elements.mute.textContent = muted ? `${copy.soundToggle}: off` : `${copy.soundToggle}: on`;
    elements.mute.setAttribute('aria-pressed', String(!muted));
    elements.mute.hidden = !remote.actions.sound;

    elements.screenRow.hidden = !remote.actions.screens;
    const labels = { board: copy.boardToggle, welcome: copy.welcomeToggle, prizes: copy.prizesToggle };
    elements.screenRow.querySelectorAll('[data-screen]').forEach((button) => {
      button.textContent = labels[button.dataset.screen] || button.dataset.screen;
      button.setAttribute('aria-pressed', String(Boolean(status && status.screen === button.dataset.screen)));
    });

    elements.statPrizes.textContent = stats.totalPrizes;
    elements.statDrawn.textContent = stats.winnersCount;
    elements.statLeft.textContent = stats.remainingPrizes;

    elements.remote.hidden = false;
    elements.notice.hidden = true;
  }

  /* -------------------------------------------------------------- network */

  async function refresh() {
    try {
      snapshot = await request('/api/remote/state', { headers: { Accept: 'application/json', 'X-Pickora-Remote-Key': key } });
      render();
    } catch (error) {
      if (error.status === 401 || error.status === 403 || error.status === 429) {
        showNotice(error.message);
        global.clearTimeout(pollTimer);
        return;
      }
      elements.connection.dataset.state = 'off';
      elements.connection.textContent = 'Cannot reach the server — retrying';
    }
    schedule();
  }

  function schedule() {
    global.clearTimeout(pollTimer);
    const ms = snapshot ? Math.max(800, snapshot.remote.pollMs) : 1500;
    pollTimer = global.setTimeout(refresh, ms);
  }

  async function send(action, value) {
    if (busy) return;
    busy = true;
    buzz();
    say('');
    if (snapshot) render();
    try {
      const result = await request('/api/remote/command', { method: 'POST', body: JSON.stringify({ key, action, value }) });
      snapshot = { ...snapshot, ...result };
      if (!result.delivered && result.message) say(result.message, 'error');
    } catch (error) {
      say(error.message, 'error');
      if (error.status === 401) showNotice(error.message);
    } finally {
      busy = false;
      if (snapshot) render();
      // A press is usually followed by the board changing state; look sooner.
      global.clearTimeout(pollTimer);
      pollTimer = global.setTimeout(refresh, 400);
    }
  }

  /* --------------------------------------------------------------- wiring */

  elements.primary.addEventListener('click', () => send('toggle'));
  elements.absent.addEventListener('click', () => {
    if (!snapshot.lastWinner) return;
    if (snapshot.remote.confirmNotPresent && !global.confirm(snapshot.copy.notPresentConfirm)) return;
    // The winner on this screen, by number: the server refuses if it has changed.
    send('notPresent', snapshot.lastWinner.drawIndex);
  });
  elements.mute.addEventListener('click', () => {
    muted = !muted;
    send('mute', muted);
  });
  elements.screenRow.addEventListener('click', (event) => {
    const button = event.target.closest('[data-screen]');
    if (button) send('screen', button.dataset.screen);
  });

  key = readKey();
  refresh();
})(window, document);

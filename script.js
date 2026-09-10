/**
 * Public draw board.
 *
 * The board never selects a winner itself — it animates the remaining pool and
 * asks the server to draw, so the result is recorded once and survives a
 * refresh, a second screen, or a mid-event browser crash.
 *
 * Nothing about the participant shape is hard-coded: what appears on the reel,
 * in the announcement, on the winner card and in the winners panel all comes
 * from the display slots in the configuration.
 */
(function board(global, document) {
  'use strict';

  const api = global.lotteryApi;

  const STATUS = {
    IDLE: 'idle',
    // The prize has been named and the reel is waiting on the operator.
    ANNOUNCING: 'announcing',
    ROLLING: 'rolling',
    REVEALING: 'revealing',
    COMPLETE: 'complete',
  };
  const REVEAL_ANIMATIONS = ['reveal-rise', 'reveal-flip', 'reveal-zoom', 'reveal-swing', 'reveal-drop'];

  const prefersReducedMotion = global.matchMedia('(prefers-reduced-motion: reduce)');

  const elements = {
    stage: document.getElementById('stage'),
    reel: document.getElementById('reel'),
    startBtn: document.getElementById('startBtn'),
    stopBtn: document.getElementById('stopBtn'),
    fullscreenBtn: document.getElementById('fullscreenBtn'),
    winnersToggle: document.getElementById('winnersToggle'),
    winnersToggleLabel: document.getElementById('winnersToggleLabel'),
    winnersPanel: document.getElementById('winnersPanel'),
    winnersHeading: document.getElementById('winnersHeading'),
    winnersList: document.getElementById('winnersList'),
    winnersBadge: document.getElementById('winnersBadge'),
    organiserLink: document.getElementById('organiserLink'),
    newDrawBtn: document.getElementById('newDrawBtn'),
    newDrawLabel: document.getElementById('newDrawLabel'),
    stats: document.getElementById('stats'),
    totalPrizes: document.getElementById('totalPrizes'),
    remainingPrizes: document.getElementById('remainingPrizes'),
    winnersCount: document.getElementById('winnersCount'),
    eventName: document.getElementById('eventName'),
    organizationName: document.getElementById('organizationName'),
    logo: document.getElementById('boardLogo'),
    loading: document.getElementById('loading'),
    loadingText: document.getElementById('loadingText'),
    footer: document.getElementById('boardFooter'),
    notice: document.getElementById('notice'),
    confettiCanvas: document.getElementById('confettiCanvas'),

  };

  const state = {
    settings: null,
    labels: {},
    pool: [],
    winners: [],
    stats: null,
    status: STATUS.IDLE,
    canReset: false,
    rollStartedAt: 0,
    stopRequested: false,
    deal: () => null,
  };

  let confetti = null;
  let reel = null;

  /* ------------------------------------------------------------- utilities */

  function escapeHtml(value) {
    return String(value === null || value === undefined ? '' : value).replace(
      /[&<>"']/g,
      (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]
    );
  }

  function copy(key) {
    return (state.settings && state.settings.copy[key]) || '';
  }

  /**
   * A whole number below `bound`, every value equally likely.
   *
   * Rejection sampling rather than a plain remainder, which would favour the
   * low end of the range whenever the range does not divide evenly.
   */
  function randomBelow(bound) {
    const buffer = new Uint32Array(1);
    const limit = Math.floor(0x100000000 / bound) * bound;
    let value = limit;
    while (value >= limit) {
      global.crypto.getRandomValues(buffer);
      [value] = buffer;
    }
    return value % bound;
  }

  /**
   * Deals entries for the reel from a shuffled deck.
   *
   * Picking independently at random each time would let some entries never
   * appear while others came round repeatedly, which looks like the board
   * favours them. A shuffle shows every remaining entry once before any of
   * them repeats, so all of them get the same time on screen. The winner
   * itself is drawn by the server, uniformly, and never here.
   */
  function createDeck(pool) {
    let deck = [];

    return function deal() {
      if (pool.length === 0) return null;

      if (deck.length === 0) {
        deck = pool.slice();
        for (let index = deck.length - 1; index > 0; index -= 1) {
          const swap = randomBelow(index + 1);
          const held = deck[index];
          deck[index] = deck[swap];
          deck[swap] = held;
        }
      }

      return deck.pop();
    };
  }

  /**
   * Puts markup on the stage.
   *
   * Anything that writes here replaces the reel, so the reel is torn down
   * first — otherwise its animation frames keep painting a detached element.
   */
  function setStage(html) {
    if (reel) {
      reel.destroy();
      reel = null;
    }
    elements.reel.innerHTML = html;
  }

  function showNotice(message, tone = 'info') {
    elements.notice.textContent = message;
    elements.notice.dataset.tone = tone;
    elements.notice.hidden = false;
    clearTimeout(showNotice.timerId);
    showNotice.timerId = setTimeout(() => {
      elements.notice.hidden = true;
    }, 6000);
  }

  /**
   * Renders one configured slot against a participant record. Lines whose
   * field is empty for this record are dropped so the layout never shows a
   * stray label with nothing after it.
   */
  function renderSlot(slotName, record, extraClass = '') {
    const lines = state.settings.display[slotName].lines
      .map((line) => {
        const value = record ? record[line.field] : undefined;
        if (value === undefined || value === null || String(value).trim() === '') return '';

        const label = line.showLabel && state.labels[line.field] ? `<span class="line-label">${escapeHtml(state.labels[line.field])}</span>` : '';
        return `<p class="slot-line" data-emphasis="${line.emphasis}">${label}<span class="line-value">${escapeHtml(value)}</span></p>`;
      })
      .join('');

    return `<div class="slot slot-${slotName} ${extraClass}">${lines}</div>`;
  }

  /* ------------------------------------------------------------- rendering */

  function applyCopy(settings) {
    elements.startBtn.querySelector('.control-text').textContent = settings.copy.startButton;
    elements.stopBtn.querySelector('.control-text').textContent = settings.copy.stopButton;
    elements.winnersToggleLabel.textContent = settings.copy.winnersToggle;
    elements.winnersHeading.textContent = settings.copy.winnersHeading;
    elements.fullscreenBtn.querySelector('.tool-label').textContent = settings.copy.fullscreenButton;
    elements.organiserLink.textContent = settings.copy.organiserLink;
    elements.newDrawLabel.textContent = settings.copy.newDrawButton;
    elements.loadingText.textContent = settings.copy.loading;
    elements.footer.textContent = settings.copy.footer;
    elements.footer.hidden = !settings.copy.footer;
  }

  function applySettings(settings, session = {}) {
    state.settings = settings;
    // Offered only to someone allowed to use it, so a viewer cannot clear the
    // results in the middle of an event.
    state.canReset = Boolean(session.authenticated) || settings.draw.allowResetFromBoard;
    state.labels = settings.data.fields.reduce((map, field) => ({ ...map, [field.key]: field.label }), {});

    document.title = settings.eventName;
    document.body.dataset.align = settings.ui.boardAlignment;
    elements.stats.hidden = !settings.ui.showStats;

    global.applyPickoraTheme(settings, {
      logo: elements.logo,
      eventName: elements.eventName,
      organizationName: elements.organizationName,
      footer: elements.footer,
    });
    applyCopy(settings);
    global.renderPickoraNav('board', settings);
    // Shown to everyone: hiding it made the option look absent. Permission
    // decides what a click does, not whether the control exists.
    elements.newDrawBtn.dataset.locked = String(!state.canReset);
    elements.newDrawBtn.title = state.canReset
      ? 'Clear the current draw and start over (N)'
      : 'Sign in on the organiser console to start a new draw';
    setWinnersPanel(settings.ui.showWinnersPanel);

    confetti = global.createConfetti(elements.confettiCanvas, { palette: settings.animation.confettiPalette });

  }

  function setWinnersPanel(isOpen) {
    elements.winnersPanel.hidden = !isOpen;
    elements.winnersToggle.setAttribute('aria-expanded', String(Boolean(isOpen)));
    document.body.classList.toggle('has-winners-panel', Boolean(isOpen));
  }

  function renderStats() {
    if (!state.stats) return;
    elements.totalPrizes.textContent = state.stats.totalPrizes;
    elements.remainingPrizes.textContent = state.stats.remainingPrizes;
    elements.winnersCount.textContent = state.stats.winnersCount;
    elements.winnersBadge.textContent = state.stats.winnersCount;
  }

  function renderWinners() {
    if (state.winners.length === 0) {
      elements.winnersList.innerHTML = `<li class="winners-empty">${escapeHtml(copy('winnersEmpty'))}</li>`;
      return;
    }

    elements.winnersList.innerHTML = state.winners
      .slice(-state.settings.display.panel.maxEntries)
      .reverse()
      .map(
        (winner) => `
        <li class="winner-row">
          <span class="winner-rank">${escapeHtml(winner.prizeNumber)}</span>
          ${renderSlot('panel', winner.record)}
        </li>`
      )
      .join('');
  }

  function setStatus(status) {
    state.status = status;
    elements.stage.dataset.status = status;

    const isRolling = status === STATUS.ROLLING;
    elements.startBtn.disabled = isRolling || status === STATUS.REVEALING || status === STATUS.COMPLETE;
    elements.stopBtn.disabled = !isRolling || state.stopRequested;
  }

  function renderMessage(title, detail = '') {
    setStage(`
      <p class="stage-message">
        <span class="stage-message-title">${escapeHtml(title)}</span>
        ${detail ? `<span class="stage-message-detail">${escapeHtml(detail)}</span>` : ''}
      </p>`);
  }

  /** The prize at this rank, when the organiser has listed one. */
  function prizeAt(prizeNumber) {
    const { prizes } = state.settings;
    if (!prizes.enabled || !prizeNumber) return null;
    return prizes.items[prizeNumber - 1] || null;
  }

  function prizeFor(prizeNumber) {
    return state.settings.prizes.showOnWinner ? prizeAt(prizeNumber) : null;
  }

  /**
   * The prize the next Start will award, when the organiser chose to name it
   * beforehand. The server decides the rank, since the order runs either way.
   */
  function upcomingPrize() {
    if (state.settings.prizes.announceMode !== 'before') return null;
    if (!state.stats || state.stats.isComplete) return null;
    return prizeAt(state.stats.nextPrizeNumber);
  }

  /**
   * The announcement that precedes a draw: the position, the prize itself and
   * a photo of it, held until the operator starts the reel.
   */
  function renderPrizeAnnouncement(prize) {
    const image = prize.images[0];
    setStage(`
      <div class="prize-call reveal-rise">
        <p class="prize-call-eyebrow">${escapeHtml(copy('upNextLabel'))} &middot; ${escapeHtml(prize.label)}</p>
        <div class="prize-call-body">
          ${image ? `<span class="prize-call-media"><img src="${escapeHtml(image.src)}" alt=""
              ${image.width && image.height ? `width="${image.width}" height="${image.height}"` : ''}></span>` : ''}
          <span class="prize-call-text">
            <span class="prize-call-name">${escapeHtml(prize.name)}</span>
            ${prize.description ? `<span class="prize-call-note">${escapeHtml(prize.description)}</span>` : ''}
          </span>
        </div>
        <p class="prize-call-prompt">${escapeHtml(copy('drawPrompt'))}</p>
      </div>`);
  }

  function renderWinnerCard(winner, animation, isReplay = false) {
    const eyebrow = isReplay ? copy('lastWinnerEyebrow') : copy('winnerEyebrow');
    const prize = prizeFor(winner.prizeNumber);
    const rank = prize ? prize.label : `${copy('prizeLabel')} ${winner.prizeNumber}`;

    setStage(`
      <div class="winner-card ${animation}">
        <p class="winner-eyebrow">${escapeHtml(eyebrow)} &middot; ${escapeHtml(rank)}</p>
        ${renderSlot('card', winner.record)}
        ${prize ? `<p class="winner-prize">${escapeHtml(prize.name)}</p>` : ''}
      </div>`);
  }

  function renderIdle() {
    if (state.stats && state.stats.isComplete) {
      setStatus(STATUS.COMPLETE);
      renderMessage(copy('completeTitle'), `${state.stats.winnersCount}`);
      return;
    }

    setStatus(STATUS.IDLE);

    // What comes next matters more than what just happened, so the upcoming
    // prize takes the stage ahead of the previous winner.
    const next = upcomingPrize();
    if (next) {
      renderPrizeAnnouncement(next);
      setStatus(STATUS.ANNOUNCING);
      return;
    }

    const lastWinner = state.winners[state.winners.length - 1];
    if (lastWinner) {
      renderWinnerCard(lastWinner, 'reveal-rise', true);
      return;
    }

    renderMessage(copy('readyTitle'), copy('readyDetail'));
  }

  /* ------------------------------------------------------------ draw cycle */

  function startSlot() {
    if (state.status !== STATUS.IDLE && state.status !== STATUS.ANNOUNCING) return;

    if (!state.stats || state.stats.isComplete) {
      renderIdle();
      return;
    }

    if (state.pool.length === 0) {
      showNotice('There are no entries left to draw.', 'warn');
      return;
    }

    // Between draws the winner is still on screen. The first Start brings up
    // the next prize; the second rolls for it, so the host controls the pause.
    const next = upcomingPrize();
    if (next && state.status !== STATUS.ANNOUNCING) {
      confetti.stop();
      renderPrizeAnnouncement(next);
      setStatus(STATUS.ANNOUNCING);
      return;
    }

    confetti.stop();
    state.stopRequested = false;
    state.rollStartedAt = Date.now();
    setStatus(STATUS.ROLLING);
    startReel();
  }

  /** Hands the reel a fresh shuffle of whoever is still in the draw. */
  function startReel() {
    state.deal = createDeck(state.pool);

    setStage('');
    reel = global.createPickoraReel(elements.reel, {
      renderItem: (record) => renderSlot('reel', record, 'slot-rolling'),
      deal: () => state.deal(),
      reducedMotion: prefersReducedMotion.matches,
    });
    reel.start(state.settings.animation.rollingSpeed);
  }

  /**
   * Brings the reel to rest and reveals who it stopped on.
   *
   * The reel starts slowing on this call, not after a wait — the configured
   * minimum roll is spent decelerating instead of holding the operator's
   * keypress. The draw is asked for at the same moment, so the answer is
   * usually in hand while the reel is still slowing and it can come to rest
   * on the winner itself.
   */
  async function stopSlot() {
    if (state.status !== STATUS.ROLLING || state.stopRequested || !reel) return;

    state.stopRequested = true;
    elements.stopBtn.disabled = true;

    const elapsed = Date.now() - state.rollStartedAt;
    const settling = reel.settle(state.settings.draw.minimumRollMs - elapsed);

    const drawing = api.drawWinner();
    // Handled by the await below; this branch only feeds the reel.
    drawing.then((result) => reel && reel.land(result.winner.record)).catch(() => {});

    try {
      const [result] = await Promise.all([drawing, settling]);
      setStatus(STATUS.REVEALING);
      await revealWinner(result.winner);
      state.stats = result.stats;
      await refreshState();
    } catch (error) {
      showNotice(error.message, 'error');
      await refreshState();
      renderIdle();
    } finally {
      state.stopRequested = false;
    }
  }

  function revealWinner(winner) {
    const { animation } = state.settings;
    const revealAnimation = REVEAL_ANIMATIONS[(winner.prizeNumber - 1) % REVEAL_ANIMATIONS.length];

    setStage(`
      <div class="winner-call ${revealAnimation}">
        <p class="winner-eyebrow">${escapeHtml(copy('winnerEyebrow'))}</p>
        ${renderSlot('call', winner.record)}
      </div>`);

    return new Promise((resolve) => {
      setTimeout(() => {
        renderWinnerCard(winner, revealAnimation);
        setTimeout(() => {
          // CHANGED: the reveal fires whichever celebration the organiser chose.
      confetti.start({
        count: animation.confettiCount,
        duration: animation.confettiDuration,
        type: animation.celebration,
      });
        }, animation.confettiStartDelay);
        resolve();
      }, animation.winnerAnnouncementDelay);
    });
  }

  /* ------------------------------------------------------------ data sync */

  async function refreshState() {
    const [stateResponse, poolResponse] = await Promise.all([api.getState(), api.getPool()]);

    state.winners = stateResponse.winners;
    state.stats = poolResponse.stats;
    state.pool = poolResponse.pool;

    renderStats();
    renderWinners();

    if (state.status !== STATUS.REVEALING) renderIdle();
    else setStatus(state.stats.isComplete ? STATUS.COMPLETE : STATUS.IDLE);
  }

  /* -------------------------------------------------------------- controls */

  function toggleFullscreen() {
    if (document.fullscreenElement) {
      document.exitFullscreen();
      return;
    }
    document.documentElement.requestFullscreen().catch(() => {
      showNotice('Fullscreen was blocked by the browser.', 'warn');
    });
  }

  /** Clears every recorded winner so the next Start begins a fresh draw. */
  async function startNewDraw() {
    if (state.status === STATUS.ROLLING || state.status === STATUS.REVEALING) return;

    if (!state.canReset) {
      showNotice(
        'Sign in on the organiser console to start a new draw, or allow it from the board in Settings.',
        'warn'
      );
      return;
    }

    const drawn = state.stats ? state.stats.winnersCount : 0;
    const detail = drawn > 0 ? `\n\n${drawn} recorded winner(s) will be cleared. This cannot be undone.` : '';
    if (!global.confirm(`${copy('newDrawConfirm')}${detail}`)) return;

    elements.newDrawBtn.disabled = true;
    try {
      confetti.stop();
      await api.resetFromBoard();
      await refreshState();
      renderIdle();
      showNotice('A new draw has started.', 'info');
    } catch (error) {
      showNotice(error.message, 'error');
    } finally {
      elements.newDrawBtn.disabled = false;
    }
  }

  function bindControls() {
    elements.startBtn.addEventListener('click', startSlot);
    elements.stopBtn.addEventListener('click', stopSlot);
    elements.fullscreenBtn.addEventListener('click', toggleFullscreen);
    elements.winnersToggle.addEventListener('click', () => setWinnersPanel(elements.winnersPanel.hidden));
    elements.newDrawBtn.addEventListener('click', startNewDraw);

    document.addEventListener('keydown', (event) => {
      if (/^(INPUT|TEXTAREA|SELECT)$/.test(event.target.tagName) || event.metaKey || event.ctrlKey || event.altKey) return;
      // A held key repeats; one press is one action.
      if (event.repeat) return;

      if (event.code === 'Space' || event.key === 'Enter') {
        event.preventDefault();
        if (state.status === STATUS.ROLLING) stopSlot();
        else startSlot();
        return;
      }

      const key = event.key.toLowerCase();
      if (key === 'w') setWinnersPanel(elements.winnersPanel.hidden);
      if (key === 'f') toggleFullscreen();
      if (key === 'g') global.location.assign('/welcome');
      if (key === 'p') global.location.assign('/prizes');
      if (key === 'n') startNewDraw();
    });
  }

  /* ------------------------------------------------------------------ boot */

  async function init() {
    try {
      const settingsResponse = await api.getSettings();
      applySettings(settingsResponse.appSettings, settingsResponse.session);

      await refreshState();
      bindControls();

      if (state.stats.totalTickets === 0) {
        showNotice('No participants have been uploaded yet. Open the organiser console to add them.', 'warn');
      }
    } catch (error) {
      renderMessage('Unable to load the draw', error.message);
      showNotice(error.message, 'error');
    } finally {
      elements.loading.hidden = true;
    }
  }

  document.addEventListener('DOMContentLoaded', init);
})(window, document);

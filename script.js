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

  const STATUS = { IDLE: 'idle', ROLLING: 'rolling', REVEALING: 'revealing', COMPLETE: 'complete' };
  const REVEAL_ANIMATIONS = ['reveal-rise', 'reveal-flip', 'reveal-zoom', 'reveal-swing', 'reveal-drop'];

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

    welcomePanel: document.getElementById('welcomePanel'),
    welcomeToggle: document.getElementById('welcomeToggle'),
    welcomeToggleLabel: document.getElementById('welcomeToggleLabel'),
    welcomeClose: document.getElementById('welcomeClose'),
    welcomeFigure: document.getElementById('welcomeFigure'),
    welcomeTrack: document.getElementById('welcomeTrack'),
    welcomeDots: document.getElementById('welcomeDots'),
    welcomePrev: document.getElementById('welcomePrev'),
    welcomeNext: document.getElementById('welcomeNext'),
    welcomeTitle: document.getElementById('welcomeTitle'),
    welcomeMessage: document.getElementById('welcomeMessage'),
    welcomeCaption: document.getElementById('welcomeCaption'),
  };

  const state = {
    settings: null,
    labels: {},
    pool: [],
    winners: [],
    stats: null,
    status: STATUS.IDLE,
    reelTimerId: null,
    rollStartedAt: 0,
    stopRequested: false,
  };

  let confetti = null;
  let welcome = null;

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

  function applyBranding(settings) {
    const { branding, ui } = settings;
    const root = document.documentElement;

    root.style.setProperty('--accent', ui.primaryColor);
    root.style.setProperty('--stage-backdrop', ui.backgroundColor || 'none');
    root.style.setProperty('--backdrop-image', branding.background.src ? `url('${encodeURI(branding.background.src)}')` : 'none');
    root.style.setProperty('--backdrop-fit', branding.background.fit === 'tile' ? 'auto' : branding.background.fit);
    root.style.setProperty('--backdrop-repeat', branding.background.fit === 'tile' ? 'repeat' : 'no-repeat');
    root.style.setProperty('--backdrop-overlay', String(branding.background.overlayOpacity / 100));
    root.style.setProperty('--logo-max-height', `${branding.logo.maxHeight}px`);

    const hasLogo = Boolean(branding.logo.src) && branding.logo.position !== 'hidden';
    elements.logo.hidden = !hasLogo;
    if (hasLogo) {
      elements.logo.src = branding.logo.src;
      elements.logo.alt = settings.organizationName || settings.eventName;
      document.body.dataset.logoPosition = branding.logo.position;
      // Explicit dimensions keep the logo from shifting the layout as it loads.
      if (branding.logo.width && branding.logo.height) {
        elements.logo.width = branding.logo.width;
        elements.logo.height = branding.logo.height;
      }
    }
  }

  function applyCopy(settings) {
    elements.startBtn.querySelector('.control-text').textContent = settings.copy.startButton;
    elements.stopBtn.querySelector('.control-text').textContent = settings.copy.stopButton;
    elements.winnersToggleLabel.textContent = settings.copy.winnersToggle;
    elements.winnersHeading.textContent = settings.copy.winnersHeading;
    elements.fullscreenBtn.querySelector('.tool-label').textContent = settings.copy.fullscreenButton;
    elements.organiserLink.textContent = settings.copy.organiserLink;
    elements.welcomeToggleLabel.textContent = settings.copy.welcomeToggle;
    elements.loadingText.textContent = settings.copy.loading;
    elements.footer.textContent = settings.copy.footer;
    elements.footer.hidden = !settings.copy.footer;
  }

  function applySettings(settings) {
    state.settings = settings;
    state.labels = settings.data.fields.reduce((map, field) => ({ ...map, [field.key]: field.label }), {});

    document.title = settings.eventName;
    document.documentElement.lang = settings.locale || 'en';
    document.documentElement.dir = settings.direction;
    document.body.dataset.align = settings.ui.boardAlignment;

    elements.eventName.textContent = settings.eventName;
    elements.organizationName.textContent = settings.organizationName || '';
    elements.organizationName.hidden = !(settings.ui.showOrganizationName && settings.organizationName);
    elements.stats.hidden = !settings.ui.showStats;

    applyBranding(settings);
    applyCopy(settings);
    setWinnersPanel(settings.ui.showWinnersPanel);

    confetti = global.createConfetti(elements.confettiCanvas, { palette: settings.animation.confettiPalette });

    if (!welcome) {
      welcome = global.createWelcome({
        panel: elements.welcomePanel,
        toggle: elements.welcomeToggle,
        close: elements.welcomeClose,
        figure: elements.welcomeFigure,
        track: elements.welcomeTrack,
        dots: elements.welcomeDots,
        prev: elements.welcomePrev,
        next: elements.welcomeNext,
        title: elements.welcomeTitle,
        message: elements.welcomeMessage,
        caption: elements.welcomeCaption,
      });
    }
    welcome.apply(settings.welcome);
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
    elements.reel.innerHTML = `
      <p class="stage-message">
        <span class="stage-message-title">${escapeHtml(title)}</span>
        ${detail ? `<span class="stage-message-detail">${escapeHtml(detail)}</span>` : ''}
      </p>`;
  }

  function renderWinnerCard(winner, animation, isReplay = false) {
    const eyebrow = isReplay ? copy('lastWinnerEyebrow') : copy('winnerEyebrow');
    elements.reel.innerHTML = `
      <div class="winner-card ${animation}">
        <p class="winner-eyebrow">${escapeHtml(eyebrow)} &middot; ${escapeHtml(copy('prizeLabel'))} ${escapeHtml(winner.prizeNumber)}</p>
        ${renderSlot('card', winner.record)}
      </div>`;
  }

  function renderIdle() {
    if (state.stats && state.stats.isComplete) {
      setStatus(STATUS.COMPLETE);
      renderMessage(copy('completeTitle'), `${state.stats.winnersCount}`);
      return;
    }

    setStatus(STATUS.IDLE);
    const lastWinner = state.winners[state.winners.length - 1];

    if (lastWinner) {
      renderWinnerCard(lastWinner, 'reveal-rise', true);
      return;
    }

    renderMessage(copy('readyTitle'), copy('readyDetail'));
  }

  /* ------------------------------------------------------------ draw cycle */

  function stopReel() {
    if (state.reelTimerId) {
      clearInterval(state.reelTimerId);
      state.reelTimerId = null;
    }
  }

  function startSlot() {
    if (state.status !== STATUS.IDLE) return;

    // The overlay sits over the stage; drawing takes the screen back.
    if (welcome && welcome.isOpen() && state.settings.welcome.placement === 'overlay') welcome.close();

    if (!state.stats || state.stats.isComplete) {
      renderIdle();
      return;
    }

    if (state.pool.length === 0) {
      showNotice('There are no entries left to draw.', 'warn');
      return;
    }

    confetti.stop();
    state.stopRequested = false;
    state.rollStartedAt = Date.now();
    setStatus(STATUS.ROLLING);

    const tick = () => {
      const record = state.pool[Math.floor(Math.random() * state.pool.length)];
      elements.reel.innerHTML = renderSlot('reel', record, 'slot-rolling');
    };

    tick();
    state.reelTimerId = setInterval(tick, state.settings.animation.rollingSpeed);
  }

  async function stopSlot() {
    if (state.status !== STATUS.ROLLING || state.stopRequested) return;

    // Honour the configured minimum spin so an early click still reads as a
    // draw rather than an instant cut to the result.
    const elapsed = Date.now() - state.rollStartedAt;
    const remaining = Math.max(0, state.settings.draw.minimumRollMs - elapsed);

    state.stopRequested = true;
    elements.stopBtn.disabled = true;

    if (remaining > 0) await new Promise((resolve) => setTimeout(resolve, remaining));

    stopReel();
    setStatus(STATUS.REVEALING);

    try {
      const result = await api.drawWinner();
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

    elements.reel.innerHTML = `
      <div class="winner-call ${revealAnimation}">
        <p class="winner-eyebrow">${escapeHtml(copy('winnerEyebrow'))}</p>
        ${renderSlot('call', winner.record)}
      </div>`;

    return new Promise((resolve) => {
      setTimeout(() => {
        renderWinnerCard(winner, revealAnimation);
        setTimeout(() => {
          confetti.start({ count: animation.confettiCount, duration: animation.confettiDuration });
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

  function bindControls() {
    elements.startBtn.addEventListener('click', startSlot);
    elements.stopBtn.addEventListener('click', stopSlot);
    elements.fullscreenBtn.addEventListener('click', toggleFullscreen);
    elements.winnersToggle.addEventListener('click', () => setWinnersPanel(elements.winnersPanel.hidden));

    document.addEventListener('keydown', (event) => {
      if (/^(INPUT|TEXTAREA|SELECT)$/.test(event.target.tagName) || event.metaKey || event.ctrlKey || event.altKey) return;

      if (event.code === 'Space' || event.key === 'Enter') {
        event.preventDefault();
        if (state.status === STATUS.ROLLING) stopSlot();
        else startSlot();
        return;
      }

      const key = event.key.toLowerCase();
      if (key === 'w') setWinnersPanel(elements.winnersPanel.hidden);
      if (key === 'f') toggleFullscreen();
      if (key === 'g' && welcome) welcome.toggle();
      if (event.key === 'Escape' && welcome && welcome.isOpen()) welcome.close();
    });
  }

  /* ------------------------------------------------------------------ boot */

  async function init() {
    try {
      const settingsResponse = await api.getSettings();
      applySettings(settingsResponse.appSettings);

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

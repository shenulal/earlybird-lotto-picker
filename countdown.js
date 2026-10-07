/**
 * The countdown to the draw, shared by the public pages.
 *
 * Runs on the server's clock rather than the screen's: each settings response
 * carries the server time, and the difference is applied here. Two screens
 * whose clocks disagree by a minute still reach zero together.
 *
 * Everything shown — the title, the units, the labels, the closing message,
 * how long it stays — comes from the organiser's settings.
 */
(function countdownModule(global, document) {
  'use strict';

  const TICK_MS = 200;

  function pad(value) {
    return String(value).padStart(2, '0');
  }

  /** Splits a span of milliseconds into whole days, hours, minutes, seconds. */
  function split(ms) {
    const total = Math.max(0, Math.ceil(ms / 1000));
    return {
      total,
      days: Math.floor(total / 86400),
      hours: Math.floor((total % 86400) / 3600),
      minutes: Math.floor((total % 3600) / 60),
      seconds: total % 60,
    };
  }

  /** Which units to show, given the organiser's choice and what is left. */
  function unitsFor(mode, parts) {
    if (mode === 'dhms') return ['days', 'hours', 'minutes', 'seconds'];
    if (mode === 'hms') return ['hours', 'minutes', 'seconds'];
    if (mode === 'ms') return ['minutes', 'seconds'];
    if (parts.days > 0) return ['days', 'hours', 'minutes', 'seconds'];
    if (parts.hours > 0) return ['hours', 'minutes', 'seconds'];
    return ['minutes', 'seconds'];
  }

  /** The value a unit shows, folding larger units in when they are hidden. */
  function valueFor(unit, units, parts) {
    if (unit === units[0]) {
      if (unit === 'hours') return parts.days * 24 + parts.hours;
      if (unit === 'minutes') return Math.floor(parts.total / 60);
    }
    return parts[unit];
  }

  function escapeHtml(value) {
    return String(value === null || value === undefined ? '' : value).replace(
      /[&<>"']/g,
      (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]
    );
  }

  /**
   * Creates the countdown for one page. `onTick(seconds)` and `onComplete()`
   * let the page tie sound and controls to it; `sound` is optional.
   */
  function createCountdown({ page = 'board', sound = null, onChange = () => {} } = {}) {
    let settings = null;
    let offsetMs = 0;
    let timer = null;
    let hideTimer = null;
    // FIX: wakes the page when a lock ends on a screen that does not show the
    // countdown, so the board's Start comes back at zero.
    let unlockTimer = null;
    let lastSecond = null;
    let completedFor = null;
    let dismissed = false;

    const root = document.createElement('section');
    root.className = 'countdown';
    root.hidden = true;
    root.setAttribute('aria-live', 'polite');
    root.innerHTML = `
      <div class="countdown-inner">
        <p class="countdown-title"></p>
        <p class="countdown-subtitle"></p>
        <div class="countdown-clock" role="timer"></div>
        <p class="countdown-done" hidden></p>
      </div>`;
    document.body.appendChild(root);

    // What a top banner pushes down — the menu, a logo, the header — is moved
    // by the banner's real height, measured, not a guess that breaks the
    // moment the words wrap on a narrow screen.
    if (global.ResizeObserver) {
      new global.ResizeObserver(() => {
        document.body.style.setProperty('--countdown-banner-height', `${Math.ceil(root.getBoundingClientRect().height)}px`);
      }).observe(root);
    }

    const titleEl = root.querySelector('.countdown-title');
    const subtitleEl = root.querySelector('.countdown-subtitle');
    const clockEl = root.querySelector('.countdown-clock');
    const doneEl = root.querySelector('.countdown-done');

    function now() {
      return Date.now() + offsetMs;
    }

    function target() {
      return settings && settings.targetAt ? Date.parse(settings.targetAt) : NaN;
    }

    function appliesHere() {
      return Boolean(settings && settings.enabled && settings.targetAt && settings.screens[page]);
    }

    /** Whether the draw is held right now — for the board's Start button. */
    function isLocked() {
      return Boolean(settings && settings.enabled && settings.lockDraw && settings.targetAt && now() < target());
    }

    function setVisible(visible) {
      const changed = root.hidden === visible;
      root.hidden = !visible;
      document.body.classList.toggle('has-countdown', visible && settings.style === 'overlay');
      document.body.classList.toggle('has-countdown-banner', visible && settings.style === 'banner');
      document.body.classList.toggle('has-countdown-banner-top', visible && settings.style === 'banner' && settings.position === 'top');
      if (changed) onChange();
    }

    let renderedKey = '';

    function renderClock(parts) {
      const units = unitsFor(settings.units, parts);
      // The clock ticks five times a second but changes once: only a new
      // second, or new labels, touch the page.
      const key = `${parts.total}|${settings.units}|${JSON.stringify(settings.labels)}`;
      if (key === renderedKey) return;
      renderedKey = key;
      clockEl.innerHTML = units
        .map((unit) => `
          <span class="countdown-unit">
            <span class="countdown-value">${pad(valueFor(unit, units, parts))}</span>
            <span class="countdown-label">${escapeHtml(settings.labels[unit])}</span>
          </span>`)
        .join('<span class="countdown-sep" aria-hidden="true">:</span>');
    }

    function showComplete() {
      clockEl.hidden = true;
      doneEl.hidden = false;
      doneEl.textContent = settings.completeMessage;
      root.dataset.phase = 'done';
    }

    function tick() {
      if (!appliesHere() || dismissed) {
        setVisible(false);
        return;
      }

      const remaining = target() - now();
      if (remaining > 0) {
        const parts = split(remaining);
        root.dataset.phase = parts.total <= settings.finalSeconds ? 'final' : 'running';
        clockEl.hidden = false;
        doneEl.hidden = true;
        renderClock(parts);
        setVisible(true);

        // One tick per second of the final stretch, and only on a change of
        // second — a slow frame must not tick twice, a skipped one not at all.
        if (parts.total <= settings.finalSeconds && parts.total !== lastSecond && lastSecond !== null && sound) {
          sound.play('countdownTick');
        }
        lastSecond = parts.total;
        return;
      }

      // Zero. Announce it once per target, then hold the closing message for
      // as long as the organiser asked — zero holds it until the draw starts.
      const key = settings.targetAt;
      const since = -remaining;
      const holdMs = settings.completeHoldSeconds * 1000;
      if (completedFor !== key) {
        completedFor = key;
        // A page loaded long after zero shows nothing and plays nothing.
        if (holdMs > 0 && since > holdMs) {
          setVisible(false);
          return;
        }
        if (lastSecond !== null && sound) sound.play('countdownEnd');
        onChange();
      }
      lastSecond = 0;

      if (holdMs > 0 && since > holdMs) {
        setVisible(false);
        return;
      }
      showComplete();
      setVisible(true);
    }

    function restart() {
      global.clearInterval(timer);
      global.clearTimeout(hideTimer);
      global.clearTimeout(unlockTimer);
      timer = null;
      if (isLocked()) {
        // setTimeout tops out around 24.8 days; a longer wait re-arms itself.
        const wait = Math.min(target() - now() + 50, 2 ** 31 - 1);
        unlockTimer = global.setTimeout(() => {
          onChange();
          if (isLocked()) restart();
        }, wait);
      }
      if (!appliesHere()) {
        setVisible(false);
        return;
      }
      titleEl.textContent = settings.title;
      subtitleEl.textContent = settings.subtitle;
      subtitleEl.hidden = !settings.subtitle;
      root.dataset.style = settings.style;
      root.dataset.position = settings.position;
      tick();
      timer = global.setInterval(tick, TICK_MS);
    }

    /**
     * Takes the latest countdown settings and the server's time as of the
     * response that carried them.
     */
    function update(countdownSettings, serverTime) {
      const previousTarget = settings && settings.targetAt;
      settings = countdownSettings;
      const server = Date.parse(serverTime);
      if (!Number.isNaN(server)) offsetMs = server - Date.now();
      if (settings.targetAt !== previousTarget) {
        dismissed = false;
        lastSecond = null;
      }
      restart();
    }

    /**
     * Takes the countdown off the screen — the board does this on Start.
     * `force` is for a signed-in organiser drawing before zero.
     */
    function dismiss(force = false) {
      if (isLocked() && !force) return;
      dismissed = true;
      setVisible(false);
    }

    return { update, isLocked, dismiss, isVisible: () => !root.hidden };
  }

  global.createPickoraCountdown = createCountdown;
})(window, document);

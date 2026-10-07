/**
 * Console: the Countdown panel.
 *
 * The date and time are picked in this computer's own time zone and stored as
 * an instant with its offset, so a screen in another time zone — or a server
 * in one — still reaches zero at the same moment.
 */
(function countdownPanel(global, document) {
  'use strict';

  const features = global.PickoraConsoleFeatures;
  if (!features) return;

  features.register(function createCountdownPanel(context, helpers) {
    const { escapeHtml, numberFrom, busy } = helpers;
    const $ = (id) => document.getElementById(id);

    const elements = {
      enabled: $('countdownEnabled'),
      target: $('countdownTarget'),
      zone: $('countdownZone'),
      lock: $('countdownLock'),
      title: $('countdownTitle'),
      subtitle: $('countdownSubtitle'),
      complete: $('countdownComplete'),
      hold: $('countdownHold'),
      days: $('countdownLabelDays'),
      hours: $('countdownLabelHours'),
      minutes: $('countdownLabelMinutes'),
      seconds: $('countdownLabelSeconds'),
      style: $('countdownStyle'),
      position: $('countdownPosition'),
      units: $('countdownUnits'),
      final: $('countdownFinal'),
      onBoard: $('countdownOnBoard'),
      onWelcome: $('countdownOnWelcome'),
      onPrizes: $('countdownOnPrizes'),
      preview: $('countdownPreview'),
      status: $('countdownStatus'),
      save: $('saveCountdownBtn'),
      revert: $('revertCountdownBtn'),
    };

    let previewTimer = null;

    /* ------------------------------------------------------------- the time */

    function pad(value) {
      return String(value).padStart(2, '0');
    }

    /** An instant as the value a datetime-local input shows, in local time. */
    function toLocalInput(iso) {
      if (!iso) return '';
      const date = new Date(iso);
      if (Number.isNaN(date.getTime())) return '';
      return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
    }

    /** A datetime-local value, read as local time, as an instant with offset. */
    function fromLocalInput(value) {
      if (!value) return '';
      const date = new Date(value);
      if (Number.isNaN(date.getTime())) return '';
      const offset = -date.getTimezoneOffset();
      const sign = offset >= 0 ? '+' : '-';
      const hours = pad(Math.floor(Math.abs(offset) / 60));
      const minutes = pad(Math.abs(offset) % 60);
      return `${toLocalInput(date.toISOString())}${sign}${hours}:${minutes}`;
    }

    function describeZone() {
      let zone = '';
      try {
        zone = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
      } catch (_error) {
        zone = '';
      }
      const offset = -new Date().getTimezoneOffset();
      const sign = offset >= 0 ? '+' : '−';
      const label = `UTC${sign}${pad(Math.floor(Math.abs(offset) / 60))}:${pad(Math.abs(offset) % 60)}`;
      elements.zone.textContent = `In this computer's time zone${zone ? ` (${zone}, ${label})` : ` (${label})`}. Every screen counts down to the same moment.`;
    }

    /* --------------------------------------------------------------- render */

    function render() {
      const countdown = context.getSettings().countdown;
      elements.enabled.checked = countdown.enabled;
      elements.target.value = toLocalInput(countdown.targetAt);
      elements.lock.checked = countdown.lockDraw;
      elements.title.value = countdown.title;
      elements.subtitle.value = countdown.subtitle;
      elements.complete.value = countdown.completeMessage;
      elements.hold.value = countdown.completeHoldSeconds;
      elements.days.value = countdown.labels.days;
      elements.hours.value = countdown.labels.hours;
      elements.minutes.value = countdown.labels.minutes;
      elements.seconds.value = countdown.labels.seconds;
      elements.style.value = countdown.style;
      elements.position.value = countdown.position;
      elements.units.value = countdown.units;
      elements.final.value = countdown.finalSeconds;
      elements.onBoard.checked = countdown.screens.board;
      elements.onWelcome.checked = countdown.screens.welcome;
      elements.onPrizes.checked = countdown.screens.prizes;
      describeZone();
      renderPreview();
    }

    function collect() {
      const countdown = context.getSettings().countdown;
      return {
        ...countdown,
        enabled: elements.enabled.checked,
        targetAt: fromLocalInput(elements.target.value),
        lockDraw: elements.lock.checked,
        title: elements.title.value.trim(),
        subtitle: elements.subtitle.value.trim(),
        completeMessage: elements.complete.value.trim(),
        completeHoldSeconds: numberFrom(elements.hold, countdown.completeHoldSeconds),
        labels: {
          days: elements.days.value.trim(),
          hours: elements.hours.value.trim(),
          minutes: elements.minutes.value.trim(),
          seconds: elements.seconds.value.trim(),
        },
        style: elements.style.value,
        position: elements.position.value,
        units: elements.units.value,
        finalSeconds: numberFrom(elements.final, countdown.finalSeconds),
        screens: { board: elements.onBoard.checked, welcome: elements.onWelcome.checked, prizes: elements.onPrizes.checked },
      };
    }

    /* -------------------------------------------------------------- preview */

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

    function unitsFor(mode, parts) {
      if (mode === 'dhms') return ['days', 'hours', 'minutes', 'seconds'];
      if (mode === 'hms') return ['hours', 'minutes', 'seconds'];
      if (mode === 'ms') return ['minutes', 'seconds'];
      if (parts.days > 0) return ['days', 'hours', 'minutes', 'seconds'];
      if (parts.hours > 0) return ['hours', 'minutes', 'seconds'];
      return ['minutes', 'seconds'];
    }

    function renderPreview() {
      const draft = collect();
      const target = Date.parse(draft.targetAt);
      // Without a time chosen, the preview shows a sample a few minutes out.
      const remaining = Number.isNaN(target) ? 754000 : target - Date.now();
      const parts = split(remaining);
      const units = unitsFor(draft.units, parts);
      const value = (unit) => {
        if (unit === units[0] && unit === 'hours') return parts.days * 24 + parts.hours;
        if (unit === units[0] && unit === 'minutes') return Math.floor(parts.total / 60);
        return parts[unit];
      };

      elements.preview.dataset.style = draft.style;
      elements.preview.dataset.final = String(remaining > 0 && parts.total <= draft.finalSeconds);
      elements.preview.innerHTML =
        remaining > 0
          ? `<p class="countdown-preview-title">${escapeHtml(draft.title)}</p>
             ${draft.subtitle && draft.style === 'overlay' ? `<p class="countdown-preview-sub">${escapeHtml(draft.subtitle)}</p>` : ''}
             <div class="countdown-preview-clock">${units
               .map((unit) => `<span><b>${pad(value(unit))}</b><small>${escapeHtml(draft.labels[unit])}</small></span>`)
               .join('<i>:</i>')}</div>`
          : `<p class="countdown-preview-done">${escapeHtml(draft.completeMessage)}</p>`;

      if (!draft.enabled) elements.status.textContent = 'Off — the screens show no countdown.';
      else if (!draft.targetAt) elements.status.textContent = 'Choose when the draw starts.';
      else if (remaining <= 0) elements.status.textContent = 'That time has passed — the screens show the message at zero, then nothing.';
      else elements.status.textContent = `Reaches zero at ${new Date(target).toLocaleString()}.`;
    }

    /* --------------------------------------------------------------- wiring */

    function bind() {
      const panel = document.getElementById('panel-countdown');
      panel.addEventListener('input', renderPreview);
      panel.addEventListener('change', renderPreview);

      panel.querySelectorAll('[data-countdown-in]').forEach((button) => {
        button.addEventListener('click', () => {
          const minutes = Number(button.dataset.countdownIn);
          const when = new Date(Date.now() + minutes * 60000);
          when.setSeconds(0, 0);
          elements.target.value = toLocalInput(when.toISOString());
          elements.enabled.checked = true;
          renderPreview();
        });
      });

      elements.save.addEventListener('click', () => {
        const countdown = collect();
        if (countdown.enabled && !countdown.targetAt) {
          context.toast('Choose when the draw starts, or switch the countdown off.', 'error');
          return;
        }
        busy(elements.save, 'Saving…', () =>
          context
            .save({ ...context.getSettings(), countdown }, 'Countdown saved. Open screens pick it up within 20 seconds.')
            .catch(() => {})
        );
      });
      elements.revert.addEventListener('click', () => context.reload());

      // The preview counts down live, but only while the panel is showing.
      previewTimer = global.setInterval(() => {
        if (!panel.hidden) renderPreview();
      }, 1000);
    }

    return { bind, render, destroy: () => global.clearInterval(previewTimer) };
  });
})(window, document);

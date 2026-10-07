/**
 * Console panels for the event features — sound, the countdown, the draw
 * certificate, templates — and the "not present" tools on the overview.
 *
 * Each feature lives in its own small file and registers itself here; the
 * console (admin.js) creates them all with the shared editor context and
 * renders them whenever the configuration changes. Kept apart from
 * admin-config.js so each file stays about one thing.
 */
(function consoleFeatures(global, document) {
  'use strict';

  const factories = [];

  /* ---------------------------------------------------------------- helpers */

  function escapeHtml(value) {
    return String(value === null || value === undefined ? '' : value).replace(
      /[&<>"']/g,
      (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]
    );
  }

  function formatBytes(bytes) {
    if (!bytes) return '—';
    if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
    return `${(bytes / 1048576).toFixed(1)} MB`;
  }

  function formatTimestamp(value) {
    if (!value) return '—';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
  }

  /** Reads a chosen file as a data URL, for posting to the server. */
  function readAsDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(new Error('The file could not be read.'));
      reader.readAsDataURL(file);
    });
  }

  function readAsText(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(new Error('The file could not be read.'));
      reader.readAsText(file);
    });
  }

  /** A number from an input, or the fallback when it is empty or not one. */
  function numberFrom(input, fallback = 0) {
    if (!input || String(input.value).trim() === '') return fallback;
    const value = Number(input.value);
    return Number.isFinite(value) ? value : fallback;
  }

  async function busy(button, label, action) {
    const original = button.textContent;
    button.disabled = true;
    if (label) button.textContent = label;
    try {
      return await action();
    } finally {
      button.disabled = false;
      button.textContent = original;
    }
  }

  const helpers = { escapeHtml, formatBytes, formatTimestamp, readAsDataUrl, readAsText, numberFrom, busy };

  /* ---------------------------------------------------------------- registry */

  function register(factory) {
    factories.push(factory);
  }

  function create(context) {
    const panels = factories.map((factory) => factory(context, helpers));
    return {
      bind() {
        panels.forEach((panel) => panel.bind && panel.bind());
      },
      render() {
        panels.forEach((panel) => panel.render && panel.render());
      },
    };
  }

  /* -------------------------------------------- overview: not-present tools */

  register(function notPresentTools(context) {
    const api = global.lotteryApi;
    const card = document.getElementById('absentCard');
    const head = document.getElementById('absentHead');
    const body = document.getElementById('absentBody');
    const winnersBody = document.getElementById('winnersBody');

    function render() {
      const overview = context.getOverview();
      if (!overview) return;
      const { appSettings } = overview;
      const absent = overview.absent || [];

      card.hidden = absent.length === 0 && !appSettings.redraw.enabled;
      const fields = appSettings.data.fields;
      head.innerHTML = `<tr><th>#</th>${fields.map((field) => `<th>${escapeHtml(field.label)}</th>`).join('')}<th>Drawn at</th><th>Marked not present</th><th></th></tr>`;

      if (absent.length === 0) {
        body.innerHTML = `<tr class="table-empty"><td colspan="${fields.length + 4}">Nobody has been marked as not present.</td></tr>`;
        return;
      }

      body.innerHTML = absent
        .slice()
        .reverse()
        .map(
          (entry) => `
          <tr>
            <td class="num">${escapeHtml(entry.prizeNumber)}</td>
            ${fields.map((field) => `<td>${escapeHtml((entry.record || {})[field.key]) || '&mdash;'}</td>`).join('')}
            <td>${escapeHtml(formatTimestamp(entry.drawnAt))}</td>
            <td>${escapeHtml(formatTimestamp(entry.absentAt))}</td>
            <td><button type="button" class="btn btn-ghost btn-small" data-restore="${escapeHtml(entry.drawIndex)}">Restore as winner</button></td>
          </tr>`
        )
        .join('');
    }

    async function markAbsent(drawIndex, button) {
      const overview = context.getOverview();
      const winner = overview.winners.find((entry) => Number(entry.drawIndex) === Number(drawIndex));
      if (!winner) return;
      const identifier = overview.appSettings.data.identifier;
      const who = (winner.record || {})[identifier] || `prize ${winner.prizeNumber}`;
      if (!global.confirm(`Mark ${who} as not present?\n\nPrize ${winner.prizeNumber} opens again and is the next one drawn.`)) return;

      await busy(button, 'Marking…', async () => {
        try {
          await api.adminMarkAbsent(Number(drawIndex));
          context.toast(`${who} was marked as not present. Prize ${winner.prizeNumber} will be drawn again.`);
          await context.reload();
        } catch (error) {
          context.toast(error.message, 'error');
        }
      });
    }

    async function restore(drawIndex, button) {
      await busy(button, 'Restoring…', async () => {
        try {
          await api.adminRestoreAbsent(Number(drawIndex));
          context.toast('Restored as a winner.');
          await context.reload();
        } catch (error) {
          context.toast(error.message, 'error');
        }
      });
    }

    function bind() {
      body.addEventListener('click', (event) => {
        const button = event.target.closest('[data-restore]');
        if (button) restore(button.dataset.restore, button);
      });
      winnersBody.addEventListener('click', (event) => {
        const button = event.target.closest('[data-absent]');
        if (button) markAbsent(button.dataset.absent, button);
      });
    }

    return { bind, render };
  });

  global.PickoraConsoleFeatures = { register, create, helpers };
})(window, document);

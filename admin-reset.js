/**
 * Console: the Reset event panel.
 *
 * Three deliberate steps before anything is cleared: download what you need,
 * choose exactly what goes, then confirm with the event's name and your
 * password — which the server checks again, with the sign-in lockout behind
 * it. A last dialog lists what will be cleared before the request is sent.
 */
(function resetPanel(global, document) {
  'use strict';

  const features = global.PickoraConsoleFeatures;
  if (!features) return;

  /** What each part means, in the organiser's words. */
  const SCOPES = [
    { key: 'results', title: 'Draw results', hint: 'Every winner, everyone marked not present, and the entry-list fingerprint.' },
    { key: 'entries', title: 'Entry list', hint: 'All participants, and the link to a Google Sheet.' },
    { key: 'prizes', title: 'Prizes', hint: 'The prize list and its settings.' },
    { key: 'welcome', title: 'Welcome screen', hint: 'The message and guest photos.' },
    { key: 'sponsors', title: 'Sponsors', hint: 'The sponsor list, prize sponsorships and the strip.' },
    { key: 'channels', title: 'Social channels', hint: 'Links and QR codes.' },
    { key: 'uploads', title: 'Uploaded images', hint: 'Logo, backdrop, guest and prize photos, sponsor logos.' },
    { key: 'sounds', title: 'Your sound tracks', hint: 'Uploaded audio. Cues fall back to the built-in sounds.' },
    { key: 'settings', title: 'All settings back to defaults', hint: 'Colours, layout, wording, draw rules, sound, countdown, certificate, sync, remote.' },
    { key: 'templates', title: 'Saved templates', hint: 'Usually kept — they are how the next event starts quickly.' },
  ];

  const PRESETS = {
    results: ['results'],
    next: ['results', 'entries', 'prizes', 'welcome', 'sponsors'],
    factory: ['results', 'entries', 'prizes', 'welcome', 'sponsors', 'channels', 'uploads', 'sounds', 'settings'],
  };

  features.register(function createResetPanel(context, helpers) {
    const api = global.lotteryApi;
    const { escapeHtml, busy } = helpers;
    const $ = (id) => document.getElementById(id);

    const elements = {
      scope: $('resetScope'),
      summary: $('resetSummary'),
      eventName: $('resetEventName'),
      confirmText: $('resetConfirmText'),
      password: $('resetPassword'),
      backedUp: $('resetBackedUp'),
      error: $('resetError'),
      button: $('resetEventBtn'),
      panel: $('panel-reset'),
    };

    function chosen() {
      return SCOPES.filter((scope) => {
        const input = elements.scope.querySelector(`[data-scope="${scope.key}"]`);
        return input && input.checked;
      });
    }

    function eventName() {
      return context.getSettings().eventName;
    }

    /** The button only wakes once every step is done. */
    function refresh() {
      const picked = chosen();
      elements.summary.textContent = picked.length
        ? `Will clear: ${picked.map((scope) => scope.title.toLowerCase()).join(', ')}. Your sign-in is kept${picked.some((scope) => scope.key === 'templates') ? '' : ', and so are saved templates'}.`
        : 'Nothing chosen yet.';
      const named = elements.confirmText.value.trim().toLowerCase() === eventName().trim().toLowerCase();
      elements.button.disabled = !(picked.length && named && elements.password.value && elements.backedUp.checked);
    }

    function render() {
      elements.eventName.textContent = eventName();
      if (!elements.scope.children.length) {
        elements.scope.innerHTML = SCOPES.map(
          (scope) => `
          <label class="switch">
            <input type="checkbox" data-scope="${escapeHtml(scope.key)}">
            <span><strong>${escapeHtml(scope.title)}</strong><small>${escapeHtml(scope.hint)}</small></span>
          </label>`
        ).join('');
      }
      refresh();
    }

    function showError(message) {
      elements.error.textContent = message;
      elements.error.hidden = !message;
    }

    async function resetEvent() {
      const picked = chosen();
      const list = picked.map((scope) => `• ${scope.title}`).join('\n');
      if (!global.confirm(`Reset "${eventName()}"?\n\nThis permanently clears:\n${list}\n\nIt cannot be undone.`)) return;

      showError('');
      await busy(elements.button, 'Resetting…', async () => {
        try {
          const result = await api.resetEvent({
            scope: Object.fromEntries(picked.map((scope) => [scope.key, true])),
            confirmText: elements.confirmText.value,
            password: elements.password.value,
          });
          elements.password.value = '';
          elements.confirmText.value = '';
          elements.backedUp.checked = false;
          elements.scope.querySelectorAll('input').forEach((input) => {
            input.checked = false;
          });
          await context.reload();
          context.toast(
            `The event was reset.${result.filesRemoved ? ` ${result.filesRemoved} uploaded file(s) were deleted.` : ''} Open screens update by themselves.`
          );
        } catch (error) {
          elements.password.value = '';
          showError(error.message);
        } finally {
          refresh();
        }
      });
    }

    function bind() {
      elements.panel.addEventListener('input', refresh);
      elements.panel.addEventListener('change', refresh);
      elements.panel.querySelectorAll('[data-reset-preset]').forEach((button) => {
        button.addEventListener('click', () => {
          const keys = PRESETS[button.dataset.resetPreset] || [];
          elements.scope.querySelectorAll('input').forEach((input) => {
            input.checked = keys.includes(input.dataset.scope);
          });
          refresh();
        });
      });
      elements.button.addEventListener('click', resetEvent);
    }

    return { bind, render };
  });
})(window, document);

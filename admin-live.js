/**
 * Console: the Live sync panel — how the screens in the room stay together,
 * and the addresses to open on each of them.
 */
(function livePanel(global, document) {
  'use strict';

  const features = global.PickoraConsoleFeatures;
  if (!features) return;

  features.register(function createLivePanel(context, helpers) {
    const { escapeHtml, numberFrom, busy } = helpers;
    const $ = (id) => document.getElementById(id);

    const TOGGLES = {
      enabled: 'liveEnabled',
      claimRequiresSignIn: 'liveClaimSignIn',
      mirrorDraws: 'liveMirror',
      followNavigation: 'liveFollowNav',
      followersCanDraw: 'liveFollowersDraw',
      soundOnFollowers: 'liveFollowerSound',
      celebrateOnFollowers: 'liveFollowerConfetti',
      showStatus: 'liveShowStatus',
    };

    function renderAddresses(sync) {
      const origin = global.location.origin;
      const rows = [
        {
          title: 'Main draw board',
          url: `${origin}/?role=main`,
          note: sync.controllerMode === 'main-only'
            ? 'The only board allowed to run the draw. Open it on the event computer.'
            : 'Takes over from any other board. Open it on the event computer.',
        },
        { title: 'Following draw boards', url: `${origin}/`, note: 'LED walls, lobby screens, a livestream PC.' },
        { title: 'Welcome screen', url: `${origin}/welcome`, note: 'Follows the main board when it changes screen.' },
        { title: 'Prize screen', url: `${origin}/prizes`, note: '' },
      ];
      $('liveAddresses').innerHTML = rows
        .map(
          (row) => `
          <div class="address-row">
            <div><strong>${escapeHtml(row.title)}</strong>${row.note ? `<p class="field-hint">${escapeHtml(row.note)}</p>` : ''}</div>
            <code>${escapeHtml(row.url)}</code>
            <button type="button" class="btn btn-ghost btn-small" data-copy="${escapeHtml(row.url)}">Copy</button>
          </div>`
        )
        .join('');
    }

    function render() {
      const sync = context.getSettings().liveSync;
      Object.entries(TOGGLES).forEach(([key, id]) => {
        $(id).checked = Boolean(sync[key]);
      });
      $('livePoll').value = sync.pollMs;
      $('liveMode').value = sync.controllerMode;
      $('liveLease').value = sync.leaseSeconds;
      $('liveOnBoard').checked = sync.screens.board;
      $('liveOnWelcome').checked = sync.screens.welcome;
      $('liveOnPrizes').checked = sync.screens.prizes;
      renderAddresses(sync);
    }

    function collect() {
      const sync = context.getSettings().liveSync;
      return {
        ...sync,
        ...Object.fromEntries(Object.entries(TOGGLES).map(([key, id]) => [key, $(id).checked])),
        pollMs: numberFrom($('livePoll'), sync.pollMs),
        controllerMode: $('liveMode').value,
        leaseSeconds: numberFrom($('liveLease'), sync.leaseSeconds),
        screens: { board: $('liveOnBoard').checked, welcome: $('liveOnWelcome').checked, prizes: $('liveOnPrizes').checked },
      };
    }

    function bind() {
      $('liveMode').addEventListener('change', () => renderAddresses(collect()));
      $('liveAddresses').addEventListener('click', async (event) => {
        const button = event.target.closest('[data-copy]');
        if (!button) return;
        try {
          await global.navigator.clipboard.writeText(button.dataset.copy);
          context.toast('Address copied.');
        } catch (_error) {
          context.toast(button.dataset.copy);
        }
      });
      $('saveLiveBtn').addEventListener('click', () =>
        busy($('saveLiveBtn'), 'Saving…', () =>
          context.save({ ...context.getSettings(), liveSync: collect() }, 'Live sync saved. Open screens pick it up within 20 seconds.').catch(() => {})
        )
      );
      $('revertLiveBtn').addEventListener('click', () => context.reload());
    }

    return { bind, render };
  });
})(window, document);

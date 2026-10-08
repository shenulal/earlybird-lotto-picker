/**
 * Console: the Phone remote panel — what the remote may do, and pairing a
 * phone with a QR code. The code is drawn here, by the same encoder the
 * screens use (qr.js), so the pairing link never leaves this page.
 */
(function remotePanel(global, document) {
  'use strict';

  const features = global.PickoraConsoleFeatures;
  if (!features) return;

  features.register(function createRemotePanel(context, helpers) {
    const api = global.lotteryApi;
    const { numberFrom, busy, formatTimestamp } = helpers;
    const $ = (id) => document.getElementById(id);

    const TOGGLES = {
      enabled: 'remoteEnabled',
      requireSignIn: 'remoteRequireSignIn',
      confirmNotPresent: 'remoteConfirm',
      haptics: 'remoteHaptics',
      showStatusOnBoard: 'remoteShowStatus',
    };
    const ACTIONS = { draw: 'remoteActDraw', notPresent: 'remoteActAbsent', screens: 'remoteActScreens', sound: 'remoteActSound' };

    function pairingUrl(remote) {
      return `${global.location.origin}/remote?key=${encodeURIComponent(remote.key)}`;
    }

    function renderPairing(remote) {
      const paired = Boolean(remote.key);
      const expired = paired && remote.keyExpiresAt && Date.now() > Date.parse(remote.keyExpiresAt);
      $('remoteCopyBtn').hidden = !paired;
      $('remoteRevokeBtn').hidden = !paired;
      $('remotePairBtn').textContent = paired ? 'Make a new pairing' : 'Pair a phone';

      if (!paired) {
        $('remotePairStatus').textContent = remote.enabled ? 'No phone is paired.' : 'The remote is switched off. Switch it on and save, then pair a phone.';
        $('remoteQr').innerHTML = '';
        return;
      }

      $('remotePairStatus').textContent = expired
        ? 'This pairing has expired. Make a new one.'
        : `Paired ${formatTimestamp(remote.keyCreatedAt)}${remote.keyExpiresAt ? `, valid until ${formatTimestamp(remote.keyExpiresAt)}` : ', never expires'}. Scan with the phone's camera.`;
      $('remoteQr').innerHTML =
        global.pickoraQr && !expired ? global.pickoraQr.toSvg(pairingUrl(remote), { label: 'Phone remote pairing code' }) : '';
    }

    function render() {
      const remote = context.getSettings().remote;
      Object.entries(TOGGLES).forEach(([key, id]) => {
        $(id).checked = Boolean(remote[key]);
      });
      Object.entries(ACTIONS).forEach(([key, id]) => {
        $(id).checked = Boolean(remote.actions[key]);
      });
      $('remoteExpiry').value = remote.expiryHours;
      $('remotePoll').value = remote.pollMs;
      renderPairing(remote);
    }

    function collect() {
      const remote = context.getSettings().remote;
      return {
        ...remote,
        ...Object.fromEntries(Object.entries(TOGGLES).map(([key, id]) => [key, $(id).checked])),
        actions: Object.fromEntries(Object.entries(ACTIONS).map(([key, id]) => [key, $(id).checked])),
        expiryHours: numberFrom($('remoteExpiry'), remote.expiryHours),
        pollMs: numberFrom($('remotePoll'), remote.pollMs),
      };
    }

    async function pair() {
      const remote = context.getSettings().remote;
      if (remote.key && !global.confirm('Make a new pairing? The phone using the current one will stop working.')) return;
      await busy($('remotePairBtn'), 'Pairing…', async () => {
        try {
          // The draft first, so the expiry and permissions chosen apply.
          await context.save({ ...context.getSettings(), remote: { ...collect(), enabled: true } }, '', { quiet: true });
          const result = await api.createRemoteKey();
          context.applySettings(result.appSettings);
          context.toast('Paired. Scan the code with the phone on stage.');
        } catch (error) {
          context.toast(error.message, 'error');
        }
      });
    }

    async function revoke() {
      if (!global.confirm('Unpair the phone? Its remote stops working at once.')) return;
      try {
        const result = await api.revokeRemoteKey();
        context.applySettings(result.appSettings);
        context.toast('The phone was unpaired.');
      } catch (error) {
        context.toast(error.message, 'error');
      }
    }

    function bind() {
      $('remotePairBtn').addEventListener('click', pair);
      $('remoteRevokeBtn').addEventListener('click', revoke);
      $('remoteCopyBtn').addEventListener('click', async () => {
        const url = pairingUrl(context.getSettings().remote);
        try {
          await global.navigator.clipboard.writeText(url);
          context.toast('Remote link copied. Share it only with the person running the draw.');
        } catch (_error) {
          context.toast(url);
        }
      });
      $('saveRemoteBtn').addEventListener('click', () =>
        busy($('saveRemoteBtn'), 'Saving…', () =>
          context.save({ ...context.getSettings(), remote: collect() }, 'Remote saved.').catch(() => {})
        )
      );
      $('revertRemoteBtn').addEventListener('click', () => context.reload());
    }

    return { bind, render };
  });
})(window, document);

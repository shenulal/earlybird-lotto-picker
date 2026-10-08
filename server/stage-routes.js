'use strict';

/**
 * Endpoints for live sync between screens, the phone remote, sponsor logos
 * and "Reset event".
 *
 * Mounted on the same router as everything else, after storage has been
 * loaded for the request.
 */

const auth = require('./auth');
const draw = require('./draw');
const live = require('./live');
const images = require('./images');
const schema = require('./schema');
const store = require('./store');
const templates = require('./templates');
const reset = require('./reset');
const stage = require('./stage-features');
const { StorageError } = store;
const { normalizeAppSettings, loadSettingsFile, saveSettingsFile, activeAdminCredential } = require('./settings');

const PAGES = ['board', 'welcome', 'prizes'];

/** What the phone remote may ask for, and which switch allows it. */
const REMOTE_COMMANDS = Object.freeze({
  toggle: 'draw',
  start: 'draw',
  stop: 'draw',
  notPresent: 'notPresent',
  screen: 'screens',
  mute: 'sound',
});

function registerStageRoutes(router, { requireAuth, currentSession, sendError, publicWinner }) {
  /* ------------------------------------------------------------ live sync */

  /* Every screen checks in here on a timer. Writes only when it claims or
     renews control, so most calls are reads. */
  router.post('/live/poll', async (req, res) => {
    try {
      const { appSettings } = loadSettingsFile();
      const { wrote, response } = live.poll(req.body || {}, appSettings, Date.now(), { signedIn: Boolean(currentSession(req)) });
      if (wrote) await store.flush();
      res.setHeader('Cache-Control', 'no-store');
      return res.json(response);
    } catch (error) {
      return sendError(res, error);
    }
  });

  /* The controller saying what it is doing: rolling, revealing, which
     screen it is on. Only the board holding control is listened to. */
  router.post('/live/status', async (req, res) => {
    try {
      const { appSettings } = loadSettingsFile();
      const result = live.publishStatus(req.body || {}, appSettings);
      if (!result.ok) return res.status(409).json(result);
      await store.flush();
      return res.json(result);
    } catch (error) {
      return sendError(res, error);
    }
  });

  /* --------------------------------------------------------- phone remote */

  /**
   * Whether this request may use the remote: a signed-in organiser always
   * may; otherwise the pairing key, unless the organiser requires sign-in.
   * Wrong keys count towards the same lockout as wrong passwords.
   */
  function remoteAccess(req, appSettings, presentedKey) {
    const { remote } = appSettings;
    if (!remote.enabled) return { ok: false, status: 403, error: 'The phone remote is switched off.' };
    if (currentSession(req)) return { ok: true };
    if (remote.requireSignIn) return { ok: false, status: 401, error: 'Sign in on this phone to use the remote.' };

    const clientKey = `remote:${req.ip || 'unknown'}`;
    if (auth.isLockedOut(clientKey)) return { ok: false, status: 429, error: 'Too many attempts. Try again in 15 minutes.' };
    if (!stage.remoteKeyMatches(remote, presentedKey)) {
      auth.registerFailedLogin(clientKey);
      return { ok: false, status: 401, error: 'This remote link is not valid any more. Scan the code in the console again.' };
    }
    auth.clearFailedLogins(clientKey);
    return { ok: true };
  }

  function remoteSnapshot(appSettings) {
    const { tickets } = draw.readTickets(appSettings);
    const state = draw.loadDrawState();
    const stats = draw.statsFor(appSettings, tickets, state);
    const allowedKeys = schema.publicFieldKeys(appSettings.display);
    const last = state.winners[state.winners.length - 1] || null;
    const prizeAt = (number) => (appSettings.prizes.enabled && number ? appSettings.prizes.items[number - 1] || null : null);
    const liveState = live.readLive();

    return {
      eventName: appSettings.eventName,
      stats,
      status: liveState.status,
      controller: live.controllerActive(appSettings),
      nextPrize: prizeAt(stats.nextPrizeNumber),
      lastWinner: last ? { ...publicWinner(last, allowedKeys), prize: prizeAt(last.prizeNumber) } : null,
      labels: appSettings.data.fields.filter((field) => allowedKeys.includes(field.key)).map(({ key, label }) => ({ key, label })),
      cardFields: appSettings.display.card.lines.map((line) => line.field),
      remote: stage.publicRemote(appSettings.remote),
      notPresentAvailable: appSettings.redraw.enabled,
      copy: {
        startButton: appSettings.copy.startButton,
        stopButton: appSettings.copy.stopButton,
        notPresentButton: appSettings.copy.notPresentButton,
        notPresentConfirm: appSettings.copy.notPresentConfirm,
        prizeLabel: appSettings.copy.prizeLabel,
        welcomeToggle: appSettings.copy.welcomeToggle,
        boardToggle: appSettings.copy.boardToggle,
        prizesToggle: appSettings.copy.prizesToggle,
        soundToggle: appSettings.copy.soundToggle,
      },
    };
  }

  router.get('/remote/state', (req, res) => {
    try {
      const { appSettings } = loadSettingsFile();
      // The key travels in a header, not the address, so access logs and
      // proxies along the way do not record it.
      const access = remoteAccess(req, appSettings, req.headers['x-pickora-remote-key']);
      if (!access.ok) return res.status(access.status).json({ ok: false, error: access.error });
      res.setHeader('Cache-Control', 'no-store');
      return res.json({ ok: true, ...remoteSnapshot(appSettings) });
    } catch (error) {
      return sendError(res, error);
    }
  });

  router.post('/remote/command', async (req, res) => {
    try {
      const { appSettings } = loadSettingsFile();
      const body = req.body || {};
      const access = remoteAccess(req, appSettings, body.key);
      if (!access.ok) return res.status(access.status).json({ ok: false, error: access.error });

      const action = String(body.action || '');
      const permission = REMOTE_COMMANDS[action];
      if (!permission) return res.status(400).json({ ok: false, error: 'Unknown command.' });
      if (!appSettings.remote.actions[permission]) {
        return res.status(403).json({ ok: false, error: 'The organiser has not allowed that from the remote.' });
      }

      /* "Not present" is carried out here and now, by the server: the remote
         is already an authorised channel, and the board learns of it from the
         live feed whether or not it is signed in. */
      if (action === 'notPresent') {
        if (!appSettings.redraw.enabled) {
          return res.status(403).json({ ok: false, error: 'Redrawing for a winner who is not present is switched off.' });
        }
        // FIX: the remote names the winner it is showing, and only that winner
        // — still the latest, and not mid-spin — can be struck off. A second
        // tap, or a second phone, must not strike the previous prize's winner.
        const { winners } = draw.loadDrawState();
        const latest = winners[winners.length - 1];
        const status = live.readLive().status;
        if (!latest || Number(body.value) !== Number(latest.drawIndex)) {
          return res.status(409).json({ ok: false, reason: 'not-latest', error: 'That winner is no longer the latest. Nothing was changed.' });
        }
        if (status && status.state === 'rolling') {
          return res.status(409).json({ ok: false, reason: 'rolling', error: 'Wait for the draw to finish.' });
        }
        const result = draw.markAbsent(appSettings, latest.drawIndex);
        if (!result.ok) return res.status(409).json(result);
        live.appendEvent('absent', {
          absent: publicWinner(result.absent, schema.publicFieldKeys(appSettings.display)),
          autoRedraw: appSettings.redraw.autoRedraw,
          source: 'remote',
        });
        await store.flush();
        return res.json({ ok: true, delivered: true, ...remoteSnapshot(appSettings) });
      }

      let value = null;
      if (action === 'screen') {
        if (!PAGES.includes(body.value)) return res.status(400).json({ ok: false, error: 'Unknown screen.' });
        value = body.value;
      }
      if (action === 'mute') value = body.value === true || body.value === false ? body.value : 'toggle';

      live.pushCommand(action, value);
      await store.flush();
      const delivered = live.controllerActive(appSettings);
      return res.json({
        ok: true,
        delivered,
        message: delivered ? '' : 'No draw board is listening. Open the draw board on the event computer.',
        ...remoteSnapshot(appSettings),
      });
    } catch (error) {
      return sendError(res, error);
    }
  });

  /* A fresh pairing key, valid for the organiser's chosen number of hours.
     Making one replaces the last, so an old link stops working at once. */
  router.post('/admin/remote/key', requireAuth, async (_req, res) => {
    try {
      const settingsFile = loadSettingsFile();
      const { remote } = settingsFile.appSettings;
      const now = new Date();
      const expires = remote.expiryHours > 0 ? new Date(now.getTime() + remote.expiryHours * 3600000).toISOString() : '';
      const appSettings = normalizeAppSettings({
        ...settingsFile.appSettings,
        remote: { ...remote, enabled: true, key: stage.newRemoteKey(), keyCreatedAt: now.toISOString(), keyExpiresAt: expires },
      });
      saveSettingsFile({ ...settingsFile, appSettings });
      live.clearRemote();
      await store.flush();
      return res.json({ ok: true, appSettings });
    } catch (error) {
      return sendError(res, error);
    }
  });

  router.delete('/admin/remote/key', requireAuth, async (_req, res) => {
    try {
      const settingsFile = loadSettingsFile();
      const appSettings = normalizeAppSettings({
        ...settingsFile.appSettings,
        remote: { ...settingsFile.appSettings.remote, key: '', keyCreatedAt: '', keyExpiresAt: '' },
      });
      saveSettingsFile({ ...settingsFile, appSettings });
      live.clearRemote();
      await store.flush();
      return res.json({ ok: true, appSettings });
    } catch (error) {
      return sendError(res, error);
    }
  });

  /* -------------------------------------------------------- sponsor logos */

  router.post('/admin/sponsors/:id/logo', requireAuth, async (req, res) => {
    try {
      const settingsFile = loadSettingsFile();
      const { sponsors } = settingsFile.appSettings;
      const sponsor = sponsors.items.find((item) => item.id === req.params.id);
      if (!sponsor) return res.status(404).json({ ok: false, error: 'Save the sponsor first, then add its logo.' });

      const asset = await images.saveImageAsset('sponsor', (req.body || {}).content, (req.body || {}).name);
      const previous = sponsor.logo.src;
      const appSettings = normalizeAppSettings({
        ...settingsFile.appSettings,
        sponsors: {
          ...sponsors,
          items: sponsors.items.map((item) =>
            item.id === sponsor.id ? { ...item, logo: { src: asset.src, width: asset.width, height: asset.height } } : item
          ),
        },
      });
      saveSettingsFile({ ...settingsFile, appSettings });
      await store.flush();
      if (previous && previous !== asset.src) await templates.removeIfUnused(previous, appSettings, normalizeAppSettings);
      return res.json({ ok: true, asset, appSettings });
    } catch (error) {
      if (error instanceof StorageError) return sendError(res, error);
      return res.status(400).json({ ok: false, error: error.message });
    }
  });

  router.delete('/admin/sponsors/:id/logo', requireAuth, async (req, res) => {
    try {
      const settingsFile = loadSettingsFile();
      const { sponsors } = settingsFile.appSettings;
      const sponsor = sponsors.items.find((item) => item.id === req.params.id);
      if (!sponsor) return res.status(404).json({ ok: false, error: 'That sponsor no longer exists.' });

      const appSettings = normalizeAppSettings({
        ...settingsFile.appSettings,
        sponsors: {
          ...sponsors,
          items: sponsors.items.map((item) => (item.id === sponsor.id ? { ...item, logo: { src: '', width: null, height: null } } : item)),
        },
      });
      saveSettingsFile({ ...settingsFile, appSettings });
      await store.flush();
      await templates.removeIfUnused(sponsor.logo.src, appSettings, normalizeAppSettings);
      return res.json({ ok: true, appSettings });
    } catch (error) {
      return sendError(res, error);
    }
  });

  /* ---------------------------------------------------------- reset event */

  /**
   * Clears the chosen parts of the event. Guarded twice over: the organiser
   * must type the event's name exactly, and give the console password again
   * — checked here, and counted towards the sign-in lockout when wrong. A
   * session left open on an unattended laptop is not enough.
   */
  router.post('/admin/reset-event', requireAuth, async (req, res) => {
    const body = req.body || {};
    const clientKey = `reset:${req.ip || 'unknown'}`;

    try {
      if (auth.isLockedOut(clientKey)) {
        return res.status(429).json({ ok: false, error: 'Too many failed attempts. Try again in 15 minutes.' });
      }

      const settingsFile = loadSettingsFile();
      const { appSettings } = settingsFile;
      const scope = reset.asScope(body.scope);
      if (scope.length === 0) return res.status(400).json({ ok: false, error: 'Choose at least one thing to clear.' });

      const typed = String(body.confirmText || '').trim();
      if (typed.toLowerCase() !== appSettings.eventName.trim().toLowerCase()) {
        return res.status(400).json({ ok: false, reason: 'confirm-text', error: `Type the event name — ${appSettings.eventName} — to confirm.` });
      }

      if (!auth.verifyPassword(String(body.password || ''), activeAdminCredential(settingsFile))) {
        auth.registerFailedLogin(clientKey);
        return res.status(401).json({ ok: false, reason: 'password', error: 'That password is not correct.' });
      }
      auth.clearFailedLogins(clientKey);

      const result = await reset.resetEvent(body.scope, appSettings, {
        normalizeAppSettings,
        saveSettings: (next) => saveSettingsFile({ ...settingsFile, appSettings: next }),
      });
      if (!result.ok) return res.status(400).json(result);
      await store.flush();
      return res.json(result);
    } catch (error) {
      return sendError(res, error);
    }
  });
}

module.exports = { registerStageRoutes, REMOTE_COMMANDS };

'use strict';

const express = require('./micro');

const auth = require('./auth');
const draw = require('./draw');
const images = require('./images');
const schema = require('./schema');
const ticketStore = require('./tickets');
const { StorageError } = require('./store');
const {
  normalizeAppSettings,
  loadSettingsFile,
  saveSettingsFile,
  ensureAdminCredentials,
  MAX_WELCOME_IMAGES,
} = require('./settings');

const MIN_PASSWORD_LENGTH = 8;
const ASSET_KINDS = ['logo', 'background'];

function currentSession(req) {
  const cookies = auth.parseCookies(req.headers.cookie);
  return auth.readSessionToken(cookies[auth.SESSION_COOKIE]);
}

function requireAuth(req, res, next) {
  const session = currentSession(req);
  if (!session) return res.status(401).json({ ok: false, error: 'Sign in to continue.' });
  req.adminSession = session;
  return next();
}

/**
 * The board only ever receives the fields its own display slots reference —
 * anything else in the participant record stays on the server.
 */
function publicWinner(winner, allowedKeys) {
  return {
    prizeNumber: winner.prizeNumber,
    drawnAt: winner.drawnAt,
    record: schema.projectRecord(winner.record || {}, allowedKeys),
  };
}

function sendError(res, error) {
  if (error instanceof StorageError) return res.status(500).json({ ok: false, error: error.message });
  return res.status(500).json({ ok: false, error: 'Unexpected server error.' });
}

function exportColumns(appSettings) {
  return [
    { key: 'prizeNumber', label: 'Prize #' },
    ...appSettings.data.fields.filter((field) => field.includeInExport).map((field) => ({ key: field.key, label: field.label })),
    { key: 'drawnAt', label: 'Drawn At' },
  ];
}

function createApiRouter() {
  const router = express.Router();
  router.use(express.json({ limit: '25mb' }));

  /* ---------------------------------------------------------------- public */

  router.get('/settings', (req, res) => {
    const { appSettings } = loadSettingsFile();
    // Field metadata the board needs for labels, without export or
    // sensitivity flags that are an organiser concern.
    const publicKeys = schema.publicFieldKeys(appSettings.display);
    const { data, ...rest } = appSettings;

    res.json({
      ok: true,
      appSettings: {
        ...rest,
        data: {
          identifier: data.identifier,
          fields: data.fields.filter((field) => publicKeys.includes(field.key)).map(({ key, label }) => ({ key, label })),
        },
      },
      session: { authenticated: Boolean(currentSession(req)) },
    });
  });

  router.get('/pool', (_req, res) => {
    try {
      const { appSettings } = loadSettingsFile();
      const { tickets } = draw.readTickets(appSettings);
      const state = draw.loadDrawState();
      // The reel animates over live records, so only reel fields are sent.
      const reelKeys = [...new Set(appSettings.display.reel.lines.map((line) => line.field))];

      res.json({
        ok: true,
        pool: draw
          .remainingPool(tickets, state.winners, appSettings.data.identifier)
          .map((ticket) => schema.projectRecord(ticket, reelKeys)),
        stats: draw.buildStats(appSettings, tickets, state.winners),
      });
    } catch (error) {
      sendError(res, error);
    }
  });

  router.get('/state', (_req, res) => {
    try {
      const { appSettings } = loadSettingsFile();
      const { tickets } = draw.readTickets(appSettings);
      const state = draw.loadDrawState();
      const allowedKeys = schema.publicFieldKeys(appSettings.display);

      res.json({
        ok: true,
        winners: state.winners.map((winner) => publicWinner(winner, allowedKeys)),
        stats: draw.buildStats(appSettings, tickets, state.winners),
      });
    } catch (error) {
      sendError(res, error);
    }
  });

  router.post('/draw', (req, res) => {
    try {
      const { appSettings } = loadSettingsFile();
      const isAdmin = Boolean(currentSession(req));

      if (!appSettings.draw.publicDrawEnabled && !isAdmin) {
        return res.status(403).json({ ok: false, error: 'Draws are currently paused by the organiser.' });
      }
      if (appSettings.draw.requireAuthForDraw && !isAdmin) {
        return res.status(401).json({ ok: false, error: 'Sign in as an organiser to run the draw.' });
      }

      const result = draw.drawWinner(appSettings);
      if (!result.ok) return res.status(409).json(result);

      return res.json({ ...result, winner: publicWinner(result.winner, schema.publicFieldKeys(appSettings.display)) });
    } catch (error) {
      return sendError(res, error);
    }
  });

  /* ------------------------------------------------------------------ auth */

  router.get('/auth/session', (req, res) => {
    const session = currentSession(req);
    const { settingsFile } = ensureAdminCredentials();

    res.json({
      ok: true,
      authenticated: Boolean(session),
      username: session ? session.username : null,
      usingDefaultPassword: Boolean(settingsFile.adminAuth && settingsFile.adminAuth.isDefaultPassword),
      credentialSource: settingsFile.adminAuth ? settingsFile.adminAuth.source : 'file',
    });
  });

  router.post('/auth/login', (req, res) => {
    const clientKey = req.ip || 'unknown';
    if (auth.isLockedOut(clientKey)) {
      return res.status(429).json({ ok: false, error: 'Too many failed attempts. Try again in 15 minutes.' });
    }

    const username = String((req.body && req.body.username) || '').trim();
    const password = String((req.body && req.body.password) || '');

    try {
      const { settingsFile } = ensureAdminCredentials();
      const credential = settingsFile.adminAuth;
      const usernameMatches = Boolean(credential) && username.toLowerCase() === String(credential.username).toLowerCase();

      if (!usernameMatches || !auth.verifyPassword(password, credential)) {
        auth.registerFailedLogin(clientKey);
        return res.status(401).json({ ok: false, error: 'Incorrect username or password.' });
      }

      auth.clearFailedLogins(clientKey);
      res.cookie(auth.SESSION_COOKIE, auth.createSessionToken(credential.username), {
        httpOnly: true,
        sameSite: 'lax',
        maxAge: auth.SESSION_TTL_MS,
        secure: req.secure || req.headers['x-forwarded-proto'] === 'https',
      });

      return res.json({ ok: true, username: credential.username, usingDefaultPassword: Boolean(credential.isDefaultPassword) });
    } catch (error) {
      return sendError(res, error);
    }
  });

  router.post('/auth/logout', (_req, res) => {
    res.clearCookie(auth.SESSION_COOKIE);
    res.json({ ok: true });
  });

  /* ----------------------------------------------------------------- admin */

  router.get('/admin/overview', requireAuth, (_req, res) => {
    try {
      const { appSettings, adminAuth } = loadSettingsFile();
      const source = draw.readTickets(appSettings);
      const state = draw.loadDrawState();

      res.json({
        ok: true,
        appSettings,
        account: {
          username: adminAuth ? adminAuth.username : 'admin',
          usingDefaultPassword: Boolean(adminAuth && adminAuth.isDefaultPassword),
          credentialSource: adminAuth ? adminAuth.source : 'file',
        },
        data: {
          rawCount: source.rawCount,
          ticketCount: source.tickets.length,
          issues: source.issues,
          sample: source.tickets.slice(0, 8),
        },
        stats: draw.buildStats(appSettings, source.tickets, state.winners),
        winners: state.winners,
        startedAt: state.startedAt,
        updatedAt: state.updatedAt,
      });
    } catch (error) {
      sendError(res, error);
    }
  });

  router.put('/admin/settings', requireAuth, (req, res) => {
    try {
      const settingsFile = loadSettingsFile();
      const incoming = (req.body && req.body.appSettings) || req.body || {};
      // Merged over what is stored, so a partial payload cannot silently drop
      // the field schema or the display slots.
      const appSettings = normalizeAppSettings({ ...settingsFile.appSettings, ...incoming });
      saveSettingsFile({ ...settingsFile, appSettings });
      res.json({ ok: true, appSettings });
    } catch (error) {
      sendError(res, error);
    }
  });

  router.post('/admin/password', requireAuth, (req, res) => {
    const currentPassword = String((req.body && req.body.currentPassword) || '');
    const newPassword = String((req.body && req.body.newPassword) || '');
    const username = String((req.body && req.body.username) || '').trim();

    if (newPassword.length < MIN_PASSWORD_LENGTH) {
      return res.status(400).json({ ok: false, error: `Choose a password of at least ${MIN_PASSWORD_LENGTH} characters.` });
    }

    try {
      const settingsFile = loadSettingsFile();
      const credential = settingsFile.adminAuth;

      if (credential && credential.source === 'environment') {
        return res.status(409).json({
          ok: false,
          error: 'Credentials are pinned by ADMIN_USERNAME / ADMIN_PASSWORD. Change them in the deployment environment.',
        });
      }

      if (!auth.verifyPassword(currentPassword, credential)) {
        return res.status(401).json({ ok: false, error: 'Current password is incorrect.' });
      }

      const nextUsername = username || credential.username;
      saveSettingsFile({
        ...settingsFile,
        adminAuth: {
          ...auth.hashPassword(newPassword),
          username: nextUsername,
          source: 'file',
          isDefaultPassword: false,
          updatedAt: new Date().toISOString(),
        },
      });

      res.cookie(auth.SESSION_COOKIE, auth.createSessionToken(nextUsername), {
        httpOnly: true,
        sameSite: 'lax',
        maxAge: auth.SESSION_TTL_MS,
        secure: req.secure || req.headers['x-forwarded-proto'] === 'https',
      });

      return res.json({ ok: true, username: nextUsername });
    } catch (error) {
      return sendError(res, error);
    }
  });

  /* Preview an upload without committing it, so the organiser can confirm the
     detected columns and identifier first. */
  router.post('/admin/tickets/preview', requireAuth, (req, res) => {
    try {
      const { appSettings } = loadSettingsFile();
      const parsed = ticketStore.parseUpload(req.body && req.body.content, req.body && req.body.format, appSettings.data);
      const proposed = parsed.schema;
      const { tickets, issues } = ticketStore.normalizeRecords(parsed.records, proposed, appSettings.data.duplicatePolicy);

      res.json({
        ok: true,
        format: parsed.format,
        columns: parsed.columns,
        schema: proposed,
        issues,
        count: tickets.length,
        sample: tickets.slice(0, 5),
      });
    } catch (error) {
      if (error instanceof StorageError) return sendError(res, error);
      return res.status(400).json({ ok: false, error: error.message });
    }
  });

  router.post('/admin/tickets', requireAuth, (req, res) => {
    const body = req.body || {};
    const mode = body.mode === 'append' ? 'append' : 'replace';
    const state = draw.loadDrawState();

    if (mode === 'replace' && state.winners.length > 0 && !body.force) {
      return res.status(409).json({
        ok: false,
        reason: 'draw-in-progress',
        error: `${state.winners.length} winner(s) have already been drawn. Reset the draw first, or confirm to replace anyway.`,
      });
    }

    try {
      const settingsFile = loadSettingsFile();
      const appSettings = settingsFile.appSettings;
      const parsed = ticketStore.parseUpload(body.content, body.format, appSettings.data);

      // Appending keeps the configured schema; replacing may adopt the one the
      // file implies, optionally overridden by the identifier the user picked.
      const adopt = mode === 'replace' && body.adoptSchema !== false;
      const baseSchema = adopt ? parsed.schema : appSettings.data;
      const nextSchema = {
        ...baseSchema,
        identifier: schema.pickIdentifier(baseSchema.fields, body.identifier || baseSchema.identifier),
      };

      const incoming = ticketStore.normalizeRecords(parsed.records, nextSchema, appSettings.data.duplicatePolicy);
      if (incoming.tickets.length === 0) {
        return res.status(400).json({ ok: false, error: 'No usable records were found in that file.' });
      }

      const existing = mode === 'append' ? draw.readTickets(appSettings).tickets : [];
      const merged = ticketStore.normalizeRecords(
        [...existing, ...incoming.tickets],
        nextSchema,
        appSettings.data.duplicatePolicy
      ).tickets;

      ticketStore.saveTickets(merged);

      const nextSettings = normalizeAppSettings({
        ...appSettings,
        data: { ...nextSchema, duplicatePolicy: appSettings.data.duplicatePolicy },
        // Display slots are rebuilt only when the columns actually changed.
        display: adopt && body.resetDisplay !== false ? {} : appSettings.display,
      });
      saveSettingsFile({ ...settingsFile, appSettings: nextSettings });

      return res.json({
        ok: true,
        mode,
        format: parsed.format,
        imported: incoming.tickets.length,
        ticketCount: merged.length,
        issues: incoming.issues,
        appSettings: nextSettings,
        stats: draw.buildStats(nextSettings, merged, draw.loadDrawState().winners),
      });
    } catch (error) {
      if (error instanceof StorageError) return sendError(res, error);
      return res.status(400).json({ ok: false, error: error.message });
    }
  });

  router.delete('/admin/tickets', requireAuth, (req, res) => {
    const state = draw.loadDrawState();

    if (state.winners.length > 0 && !(req.body && req.body.force)) {
      return res.status(409).json({
        ok: false,
        reason: 'draw-in-progress',
        error: `${state.winners.length} winner(s) have already been drawn. Reset the draw first, or confirm to delete anyway.`,
      });
    }

    try {
      ticketStore.saveTickets([]);
      const { appSettings } = loadSettingsFile();
      return res.json({ ok: true, ticketCount: 0, stats: draw.buildStats(appSettings, [], state.winners) });
    } catch (error) {
      return sendError(res, error);
    }
  });

  router.get('/admin/export/tickets.csv', requireAuth, (_req, res) => {
    try {
      const { appSettings } = loadSettingsFile();
      const columns = appSettings.data.fields.map((field) => ({ key: field.key, label: field.label }));

      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename="entries.csv"');
      res.send(ticketStore.toCsv(draw.readTickets(appSettings).tickets, columns));
    } catch (error) {
      sendError(res, error);
    }
  });

  /* ---------------------------------------------------------------- assets */

  router.post('/admin/assets/:kind', requireAuth, (req, res) => {
    const kind = req.params.kind;
    if (!ASSET_KINDS.includes(kind)) {
      return res.status(400).json({ ok: false, error: 'Unknown asset.' });
    }

    try {
      const asset = images.saveImageAsset(kind, (req.body || {}).content, (req.body || {}).name);
      const settingsFile = loadSettingsFile();
      const previous = settingsFile.appSettings.branding[kind].src;

      const appSettings = normalizeAppSettings({
        ...settingsFile.appSettings,
        branding: {
          ...settingsFile.appSettings.branding,
          [kind]: {
            ...settingsFile.appSettings.branding[kind],
            src: asset.src,
            width: asset.width,
            height: asset.height,
          },
        },
      });

      saveSettingsFile({ ...settingsFile, appSettings });
      if (previous && previous !== asset.src) images.removeImageAsset(previous);

      return res.json({ ok: true, asset, appSettings });
    } catch (error) {
      if (error instanceof StorageError) return sendError(res, error);
      return res.status(400).json({ ok: false, error: error.message });
    }
  });

  router.delete('/admin/assets/:kind', requireAuth, (req, res) => {
    const kind = req.params.kind;
    if (!ASSET_KINDS.includes(kind)) return res.status(400).json({ ok: false, error: 'Unknown asset.' });

    try {
      const settingsFile = loadSettingsFile();
      const previous = settingsFile.appSettings.branding[kind].src;

      const appSettings = normalizeAppSettings({
        ...settingsFile.appSettings,
        branding: {
          ...settingsFile.appSettings.branding,
          [kind]: { ...settingsFile.appSettings.branding[kind], src: '', width: null, height: null },
        },
      });

      saveSettingsFile({ ...settingsFile, appSettings });
      images.removeImageAsset(previous);

      return res.json({ ok: true, appSettings });
    } catch (error) {
      return sendError(res, error);
    }
  });

  /* --------------------------------------------------- guest welcome images */

  router.post('/admin/welcome/images', requireAuth, (req, res) => {
    try {
      const settingsFile = loadSettingsFile();
      const welcome = settingsFile.appSettings.welcome;

      if (welcome.images.length >= MAX_WELCOME_IMAGES) {
        return res.status(409).json({ ok: false, error: `The carousel holds at most ${MAX_WELCOME_IMAGES} photos.` });
      }

      const asset = images.saveImageAsset('guest', (req.body || {}).content, (req.body || {}).name);
      const caption = String((req.body || {}).caption || '').trim();

      // Files are named by content hash, so the same photo uploaded twice
      // would land on one src and behave oddly when removed.
      if (welcome.images.some((image) => image.src === asset.src)) {
        return res.status(409).json({ ok: false, error: 'That photo is already in the carousel.' });
      }

      const appSettings = normalizeAppSettings({
        ...settingsFile.appSettings,
        welcome: {
          ...welcome,
          images: [...welcome.images, { src: asset.src, caption, width: asset.width, height: asset.height }],
        },
      });

      saveSettingsFile({ ...settingsFile, appSettings });
      return res.json({ ok: true, asset, appSettings });
    } catch (error) {
      if (error instanceof StorageError) return sendError(res, error);
      return res.status(400).json({ ok: false, error: error.message });
    }
  });

  router.delete('/admin/welcome/images', requireAuth, (req, res) => {
    const src = String((req.body || {}).src || '');

    try {
      const settingsFile = loadSettingsFile();
      const welcome = settingsFile.appSettings.welcome;
      const remaining = welcome.images.filter((image) => image.src !== src);

      if (remaining.length === welcome.images.length) {
        return res.status(404).json({ ok: false, error: 'That photo is not in the carousel.' });
      }

      const appSettings = normalizeAppSettings({ ...settingsFile.appSettings, welcome: { ...welcome, images: remaining } });
      saveSettingsFile({ ...settingsFile, appSettings });

      // Only delete the file once nothing else references it.
      if (!remaining.some((image) => image.src === src)) images.removeImageAsset(src);

      return res.json({ ok: true, appSettings });
    } catch (error) {
      return sendError(res, error);
    }
  });

  /* ------------------------------------------------------------ draw admin */

  router.post('/admin/draw/undo', requireAuth, (_req, res) => {
    try {
      const { appSettings } = loadSettingsFile();
      const result = draw.undoLastWinner(appSettings);
      res.status(result.ok ? 200 : 409).json(result);
    } catch (error) {
      sendError(res, error);
    }
  });

  router.post('/admin/draw/reset', requireAuth, (_req, res) => {
    try {
      const { appSettings } = loadSettingsFile();
      res.json(draw.resetDraw(appSettings));
    } catch (error) {
      sendError(res, error);
    }
  });

  router.get('/admin/export/winners.csv', requireAuth, (_req, res) => {
    try {
      const { appSettings } = loadSettingsFile();
      const rows = draw.loadDrawState().winners.map((winner) => ({
        prizeNumber: winner.prizeNumber,
        drawnAt: winner.drawnAt,
        ...winner.record,
      }));

      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename="winners.csv"');
      res.send(ticketStore.toCsv(rows, exportColumns(appSettings)));
    } catch (error) {
      sendError(res, error);
    }
  });

  router.use((_req, res) => res.status(404).json({ ok: false, error: 'Unknown endpoint.' }));

  return router;
}

module.exports = { createApiRouter, requireAuth, currentSession };

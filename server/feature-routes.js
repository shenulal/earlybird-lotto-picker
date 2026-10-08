'use strict';

/**
 * Endpoints for the event features: the "winner not present" redraw, uploaded
 * sound tracks, the draw certificate and event templates.
 *
 * Mounted on the same router as everything else, after storage has been
 * loaded for the request, so each handler reads and writes in memory and
 * flushes once before it answers.
 */

const crypto = require('crypto');

const draw = require('./draw');
const audio = require('./audio');
const schema = require('./schema');
const store = require('./store');
const templates = require('./templates');
const live = require('./live');
const { StorageError } = store;
const { normalizeAppSettings, loadSettingsFile, saveSettingsFile } = require('./settings');

const TRACK_ID = /^track-[a-z0-9-]{1,40}$/;

function templateError(res, error, sendError) {
  if (error instanceof templates.TemplateError) {
    return res.status(error.status).json({ ok: false, error: error.message });
  }
  return sendError(res, error);
}

/** The winners and absentees as the board may see them. */
function publicDraw(appSettings, state, publicWinner) {
  const allowedKeys = schema.publicFieldKeys(appSettings.display);
  return {
    winners: state.winners.map((winner) => publicWinner(winner, allowedKeys)),
    absent: appSettings.redraw.showInPanel
      ? state.absent.map((entry) => ({ ...publicWinner(entry, allowedKeys), absentAt: entry.absentAt }))
      : [],
  };
}

/**
 * A short, stable reference for one certificate: the prefix, the day the draw
 * started, and a fragment of the results' own hash — so a reprint of the same
 * results carries the same number, and any change to them a different one.
 */
function certificateReference(prefix, startedAt, resultsHash) {
  const day = (startedAt || new Date().toISOString()).slice(0, 10).replace(/-/g, '');
  return `${prefix}-${day}-${resultsHash.slice(0, 6).toUpperCase()}`;
}

/** A hash of the results themselves, in draw order. */
function resultsFingerprint(state, identifier) {
  const lines = [...state.winners, ...state.absent]
    .sort((a, b) => Number(a.drawIndex) - Number(b.drawIndex))
    .map((entry) =>
      [
        entry.drawIndex,
        entry.prizeNumber,
        String((entry.record && entry.record[identifier]) ?? ''),
        entry.drawnAt,
        entry.absentAt ? `absent:${entry.absentAt}` : 'won',
      ].join('\u001f')
    );
  return crypto.createHash('sha256').update(lines.join('\n'), 'utf8').digest('hex');
}

function registerFeatureRoutes(router, { requireAuth, currentSession, sendError, publicWinner }) {
  /* ------------------------------------------------------- redraw: board */

  /* The board's "Not present" control. Allowed only when the organiser has
     switched the redraw on and offered it on the board — and, unless they
     said otherwise, only to a signed-in browser. */
  router.post('/draw/absent', async (req, res) => {
    try {
      const { appSettings } = loadSettingsFile();
      const { redraw } = appSettings;
      if (!redraw.enabled || !redraw.showOnBoard) {
        return res.status(403).json({ ok: false, error: 'The organiser has not enabled redraws from the board.' });
      }
      if (redraw.requireSignIn && !currentSession(req)) {
        return res.status(401).json({ ok: false, error: 'Sign in as an organiser to mark a winner as not present.' });
      }

      // FIX: from the board, only the winner on the screen — the latest — can
      // be struck off. Older results are the console's business; otherwise,
      // with sign-in not required, anyone could reopen any prize.
      const { winners } = draw.loadDrawState();
      const latest = winners[winners.length - 1];
      const asked = (req.body || {}).drawIndex;
      if (latest && asked !== undefined && asked !== null && Number(asked) !== Number(latest.drawIndex)) {
        return res.status(409).json({ ok: false, reason: 'not-latest', error: 'The results have changed. Reload the board.' });
      }

      const result = draw.markAbsent(appSettings, latest ? latest.drawIndex : undefined);
      if (!result.ok) return res.status(409).json(result);

      const allowedKeys = schema.publicFieldKeys(appSettings.display);
      const absent = publicWinner(result.absent, allowedKeys);
      live.appendEvent('absent', { absent, autoRedraw: redraw.autoRedraw, source: 'board' }, (req.body || {}).boardId || null);
      await store.flush();
      return res.json({ ok: true, absent, stats: result.stats });
    } catch (error) {
      return sendError(res, error);
    }
  });

  /* ------------------------------------------------------- redraw: admin */

  router.post('/admin/draw/absent', requireAuth, async (req, res) => {
    try {
      const { appSettings } = loadSettingsFile();
      const result = draw.markAbsent(appSettings, (req.body || {}).drawIndex);
      if (!result.ok) return res.status(409).json(result);
      live.appendEvent('absent', {
        absent: publicWinner(result.absent, schema.publicFieldKeys(appSettings.display)),
        autoRedraw: false,
        source: 'console',
      });
      await store.flush();
      return res.json(result);
    } catch (error) {
      return sendError(res, error);
    }
  });

  router.post('/admin/draw/restore', requireAuth, async (req, res) => {
    try {
      const { appSettings } = loadSettingsFile();
      const result = draw.restoreAbsent(appSettings, (req.body || {}).drawIndex);
      if (!result.ok) return res.status(409).json(result);
      live.appendEvent('restore', { drawIndex: result.restored.drawIndex });
      await store.flush();
      return res.json(result);
    } catch (error) {
      return sendError(res, error);
    }
  });

  /* ---------------------------------------------------------- sound tracks */

  router.post('/admin/sound/tracks', requireAuth, async (req, res) => {
    try {
      const settingsFile = loadSettingsFile();
      const { sound } = settingsFile.appSettings;
      if (sound.library.length >= 30) {
        return res.status(409).json({ ok: false, error: 'The sound library holds at most 30 tracks. Remove one to make room.' });
      }

      const body = req.body || {};
      const asset = await audio.saveAudioAsset(body.content, body.name);
      if (sound.library.some((track) => track.src === asset.src)) {
        return res.status(409).json({ ok: false, error: 'That file is already in the sound library.' });
      }

      const name = String(body.name || '').replace(/\.[a-z0-9]{2,5}$/i, '').trim() || 'Untitled track';
      const track = {
        id: `track-${Date.now().toString(36)}-${crypto.randomBytes(2).toString('hex')}`,
        name,
        src: asset.src,
        format: asset.format,
        bytes: asset.bytes,
      };

      const appSettings = normalizeAppSettings({
        ...settingsFile.appSettings,
        sound: { ...sound, library: [...sound.library, track] },
      });
      saveSettingsFile({ ...settingsFile, appSettings });
      await store.flush();
      return res.json({ ok: true, track, appSettings });
    } catch (error) {
      if (error instanceof StorageError) return sendError(res, error);
      return res.status(400).json({ ok: false, error: error.message });
    }
  });

  router.patch('/admin/sound/tracks/:id', requireAuth, async (req, res) => {
    try {
      if (!TRACK_ID.test(req.params.id)) return res.status(404).json({ ok: false, error: 'That track no longer exists.' });
      const settingsFile = loadSettingsFile();
      const { sound } = settingsFile.appSettings;
      if (!sound.library.some((track) => track.id === req.params.id)) {
        return res.status(404).json({ ok: false, error: 'That track no longer exists.' });
      }

      const name = String((req.body || {}).name || '').trim();
      if (!name) return res.status(400).json({ ok: false, error: 'Give the track a name.' });

      const library = sound.library.map((track) => (track.id === req.params.id ? { ...track, name } : track));
      const appSettings = normalizeAppSettings({ ...settingsFile.appSettings, sound: { ...sound, library } });
      saveSettingsFile({ ...settingsFile, appSettings });
      await store.flush();
      return res.json({ ok: true, appSettings });
    } catch (error) {
      return sendError(res, error);
    }
  });

  router.delete('/admin/sound/tracks/:id', requireAuth, async (req, res) => {
    try {
      const settingsFile = loadSettingsFile();
      const { sound } = settingsFile.appSettings;
      const track = sound.library.find((entry) => entry.id === req.params.id);
      if (!track) return res.status(404).json({ ok: false, error: 'That track no longer exists.' });

      // Any cue still pointing at it falls back to its built-in sound when
      // the settings are normalised without it.
      const appSettings = normalizeAppSettings({
        ...settingsFile.appSettings,
        sound: { ...sound, library: sound.library.filter((entry) => entry.id !== track.id) },
      });
      saveSettingsFile({ ...settingsFile, appSettings });
      await store.flush();
      await templates.removeIfUnused(track.src, appSettings, normalizeAppSettings);
      return res.json({ ok: true, appSettings });
    } catch (error) {
      return sendError(res, error);
    }
  });

  /* ----------------------------------------------------------- certificate */

  /* Everything the certificate page prints, in one answer. The organiser's
     console reads it; the full participant records are included because the
     certificate is the organiser's own document — masking, if asked for, is
     applied when it is printed. */
  router.get('/admin/certificate', requireAuth, (_req, res) => {
    try {
      const { appSettings } = loadSettingsFile();
      const { tickets } = draw.readTickets(appSettings);
      const state = draw.loadDrawState();
      const identifier = appSettings.data.identifier;
      const hash = resultsFingerprint(state, identifier);

      res.setHeader('Cache-Control', 'no-store');
      res.json({
        ok: true,
        generatedAt: new Date().toISOString(),
        reference: certificateReference(appSettings.certificate.referencePrefix, state.startedAt, hash),
        resultsFingerprint: hash,
        poolFingerprint: state.poolFingerprint,
        // Recomputed now, so a list changed after the draw shows as changed.
        currentPoolFingerprint: tickets.length > 0 ? draw.poolFingerprint(tickets) : null,
        poolSize: state.poolSize,
        startedAt: state.startedAt,
        updatedAt: state.updatedAt,
        appSettings: {
          eventName: appSettings.eventName,
          organizationName: appSettings.organizationName,
          locale: appSettings.locale,
          direction: appSettings.direction,
          totalPrizes: appSettings.totalPrizes,
          branding: appSettings.branding,
          ui: { primaryColor: appSettings.ui.primaryColor },
          prizes: appSettings.prizes,
          data: appSettings.data,
          certificate: appSettings.certificate,
          sponsors: appSettings.sponsors,
          copy: { prizeLabel: appSettings.copy.prizeLabel, notPresentTag: appSettings.copy.notPresentTag },
        },
        stats: draw.statsFor(appSettings, tickets, state),
        winners: state.winners,
        absent: state.absent,
      });
    } catch (error) {
      sendError(res, error);
    }
  });

  /* ------------------------------------------------------------- templates */

  router.get('/admin/templates', requireAuth, (_req, res) => {
    try {
      res.json({
        ok: true,
        templates: templates.listTemplates(normalizeAppSettings),
        sections: templates.SECTION_NAMES,
        defaultSections: templates.DEFAULT_SECTIONS,
        maxTemplates: templates.MAX_TEMPLATES,
      });
    } catch (error) {
      sendError(res, error);
    }
  });

  router.post('/admin/templates', requireAuth, async (req, res) => {
    try {
      const { appSettings } = loadSettingsFile();
      const body = req.body || {};
      const template = templates.createTemplate(
        { name: body.name, description: body.description, sections: body.sections },
        appSettings,
        normalizeAppSettings
      );
      await store.flush();
      return res.json({ ok: true, template });
    } catch (error) {
      return templateError(res, error, sendError);
    }
  });

  router.post('/admin/templates/import', requireAuth, async (req, res) => {
    try {
      const { appSettings } = loadSettingsFile();
      const file = (req.body || {}).file;
      // FIX: everything that could refuse the template is checked before any
      // embedded file is stored, so a refusal leaves no orphaned files.
      const name = String((req.body || {}).name || '').trim() || String(((file || {}).template || {}).name || '').trim();
      templates.assertCanCreate(name, normalizeAppSettings);
      const { input, refused } = await templates.importTemplate(file);
      const template = templates.createTemplate({ ...input, name }, appSettings, normalizeAppSettings);
      await store.flush();
      return res.json({ ok: true, template, refused });
    } catch (error) {
      return templateError(res, error, sendError);
    }
  });

  router.put('/admin/templates/:id', requireAuth, async (req, res) => {
    try {
      const { appSettings } = loadSettingsFile();
      const template = templates.updateTemplate(req.params.id, req.body || {}, appSettings, normalizeAppSettings);
      await store.flush();
      return res.json({ ok: true, template });
    } catch (error) {
      return templateError(res, error, sendError);
    }
  });

  router.delete('/admin/templates/:id', requireAuth, async (req, res) => {
    try {
      const removed = templates.deleteTemplate(req.params.id, normalizeAppSettings);
      await store.flush();

      // Files only that template held are no longer needed by anything.
      const { appSettings } = loadSettingsFile();
      for (const ref of templates.assetRefs(removed.settings)) {
        // eslint-disable-next-line no-await-in-loop
        await templates.removeIfUnused(ref, appSettings, normalizeAppSettings);
      }
      return res.json({ ok: true });
    } catch (error) {
      return templateError(res, error, sendError);
    }
  });

  router.post('/admin/templates/:id/apply', requireAuth, async (req, res) => {
    try {
      const settingsFile = loadSettingsFile();
      const template = templates.findTemplate(req.params.id, normalizeAppSettings);
      const body = req.body || {};
      const applied = templates.applyTemplate(
        template,
        settingsFile.appSettings,
        { sections: body.sections, keepEventName: body.keepEventName !== false },
        normalizeAppSettings
      );
      const { appSettings, missing } = await templates.withoutMissingAssets(applied.appSettings, normalizeAppSettings);

      saveSettingsFile({ ...settingsFile, appSettings });
      await store.flush();
      return res.json({ ok: true, appSettings, sections: applied.sections, missing, droppedTracks: applied.droppedTracks });
    } catch (error) {
      return templateError(res, error, sendError);
    }
  });

  /* `current` exports the live configuration, every section, without saving
     it as a template first. */
  router.get('/admin/templates/:id/export', requireAuth, async (req, res) => {
    try {
      const { appSettings } = loadSettingsFile();
      const template =
        req.params.id === 'current'
          ? {
              name: appSettings.eventName,
              description: `Exported from ${appSettings.eventName}`,
              sections: templates.SECTION_NAMES,
              settings: templates.pickSections(appSettings, templates.SECTION_NAMES),
            }
          : templates.findTemplate(req.params.id, normalizeAppSettings);

      const payload = await templates.exportTemplate(template, { embed: req.query.embed === '1' });
      const slug = String(template.name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'template';

      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="pickora-${slug}.json"`);
      res.setHeader('Cache-Control', 'no-store');
      return res.send(JSON.stringify(payload, null, 2));
    } catch (error) {
      return templateError(res, error, sendError);
    }
  });
}

module.exports = { registerFeatureRoutes, publicDraw, resultsFingerprint, certificateReference };

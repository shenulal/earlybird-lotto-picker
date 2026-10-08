'use strict';

/**
 * "Reset event": clears the parts of an event the organiser chose, in one
 * step, so the same deployment is ready for the next event.
 *
 * What is cleared is decided by the scope the organiser ticked; nothing is
 * cleared that was not asked for. The organiser's sign-in is never touched,
 * and saved templates only when explicitly chosen. Uploaded files are deleted
 * only once nothing — the event or a remaining template — still uses them.
 */

const draw = require('./draw');
const live = require('./live');
const store = require('./store');
const templates = require('./templates');
const ticketStore = require('./tickets');

/** The parts that can be cleared, in the order they are reported. */
const SCOPES = Object.freeze([
  'results',
  'entries',
  'prizes',
  'welcome',
  'sponsors',
  'channels',
  'uploads',
  'sounds',
  'settings',
  'templates',
]);

function asScope(input) {
  const source = input && typeof input === 'object' ? input : {};
  return SCOPES.filter((name) => source[name] === true);
}

/**
 * The settings with the chosen parts set back to their defaults.
 *
 * "settings" returns everything to the built-in defaults, keeping only the
 * shape of the entry list (unless entries are cleared too, when that goes as
 * well) and the organiser's sign-in, which does not live in the settings.
 */
function clearedSettings(appSettings, scope, normalizeAppSettings) {
  const defaults = normalizeAppSettings({});
  const has = (name) => scope.includes(name);

  if (has('settings')) {
    return normalizeAppSettings({
      ...defaults,
      // The entry list's columns survive unless the entries go too.
      data: has('entries') ? defaults.data : { ...appSettings.data, sourceUrl: '', sourceSyncedAt: '' },
      display: has('entries') ? defaults.display : appSettings.display,
      // Kept, unless their own boxes were ticked: a settings reset is about
      // how the board behaves, not the content an organiser built.
      prizes: has('prizes') ? defaults.prizes : withoutUploads(appSettings, scope).prizes,
      welcome: has('welcome') ? defaults.welcome : withoutUploads(appSettings, scope).welcome,
      sponsors: has('sponsors') ? defaults.sponsors : withoutUploads(appSettings, scope).sponsors,
      social: has('channels') ? defaults.social : appSettings.social,
      sound: has('sounds') ? defaults.sound : { ...defaults.sound, library: appSettings.sound.library },
      // Artwork is content too: it goes with "uploads", not with the settings.
      branding: has('uploads') ? defaults.branding : appSettings.branding,
    });
  }

  const next = withoutUploads(appSettings, scope);
  return normalizeAppSettings({
    ...next,
    data: has('entries') ? { ...next.data, sourceUrl: '', sourceSyncedAt: '' } : next.data,
    prizes: has('prizes') ? defaults.prizes : next.prizes,
    welcome: has('welcome') ? defaults.welcome : next.welcome,
    sponsors: has('sponsors') ? defaults.sponsors : next.sponsors,
    social: has('channels') ? defaults.social : next.social,
    sound: has('sounds') ? { ...next.sound, library: [] } : next.sound,
  });
}

/** The settings with every uploaded image dropped, when "uploads" is chosen. */
function withoutUploads(appSettings, scope) {
  if (!scope.includes('uploads')) return appSettings;
  return {
    ...appSettings,
    branding: {
      logo: { ...appSettings.branding.logo, src: null, width: null, height: null },
      background: { ...appSettings.branding.background, src: null, width: null, height: null },
    },
    welcome: { ...appSettings.welcome, images: [] },
    prizes: { ...appSettings.prizes, items: appSettings.prizes.items.map((item) => ({ ...item, images: [] })) },
    sponsors: {
      ...appSettings.sponsors,
      items: appSettings.sponsors.items.map((sponsor) => ({ ...sponsor, logo: { src: '', width: null, height: null } })),
    },
  };
}

/**
 * Clears the chosen parts. Returns what was done, for the console to report.
 * `saveSettings` persists the new settings; flushing is the caller's job.
 */
async function resetEvent(scopeInput, appSettings, { normalizeAppSettings, saveSettings }) {
  const scope = asScope(scopeInput);
  if (scope.length === 0) return { ok: false, reason: 'empty-scope', message: 'Choose at least one thing to clear.' };

  const before = templates.assetRefs(appSettings);
  const done = [];

  if (scope.includes('results')) {
    draw.resetDraw(appSettings);
    done.push('results');
  }
  if (scope.includes('entries')) {
    ticketStore.saveTickets([]);
    done.push('entries');
  }

  const nextSettings = clearedSettings(appSettings, scope, normalizeAppSettings);
  // A new event gets a new pairing: an old phone link must not keep working.
  const settings = { ...nextSettings, remote: { ...nextSettings.remote, key: '', keyCreatedAt: '', keyExpiresAt: '' } };
  saveSettings(normalizeAppSettings(settings));
  done.push(...scope.filter((name) => !['results', 'entries', 'templates'].includes(name)));

  if (scope.includes('templates')) {
    store.writeDocument('templates', { templates: [] });
    done.push('templates');
  }

  live.clearRemote();
  live.appendEvent('reset', { scope });

  // Files nothing points at any more — not the event, not a template left.
  const after = templates.assetRefs(settings);
  const released = before.filter((ref) => !after.includes(ref));
  const removed = [];
  for (const ref of released) {
    // Sequential: a key-value store takes deletes more gracefully one by one.
    // eslint-disable-next-line no-await-in-loop
    if (await templates.removeIfUnused(ref, settings, normalizeAppSettings)) removed.push(ref);
  }

  return { ok: true, cleared: done, filesRemoved: removed.length, appSettings: normalizeAppSettings(settings) };
}

module.exports = { SCOPES, asScope, resetEvent };

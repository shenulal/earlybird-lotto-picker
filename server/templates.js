'use strict';

/**
 * Event templates: a saved configuration an organiser can start the next
 * event from, carry to another deployment as a file, or reuse in part.
 *
 * A template holds whole settings sections — branding, prizes, sound and so
 * on — so applying one replaces exactly the sections chosen and nothing else.
 * Everything going in is normalised with the same rules as the console, so a
 * template can never carry a value the board would not accept.
 */

const crypto = require('crypto');

const store = require('./store');
const images = require('./images');
const audio = require('./audio');
const { PATHS } = require('./paths');
const { asText, asOptionalText, asObject, asId } = require('./coerce');

const TEMPLATE_FORMAT = 'pickora-template';
const TEMPLATE_VERSION = 1;
const MAX_TEMPLATES = 50;
const TEMPLATE_ID = /^(tpl|builtin)-[a-z0-9-]{1,40}$/;
// Matches the sound library's own ceiling (features.js).
const MAX_TRACKS = 30;

/** Which settings keys each section a template can carry is made of. */
const SECTIONS = Object.freeze({
  event: ['eventName', 'organizationName', 'totalPrizes', 'locale', 'direction'],
  // Uploaded artwork travels on its own, so a style can be applied without
  // replacing the logo and backdrop an organiser has already put in place.
  branding: ['branding'],
  look: ['ui', 'text'],
  wording: ['copy'],
  prizes: ['prizes'],
  welcome: ['welcome'],
  channels: ['social'],
  animation: ['animation'],
  draw: ['draw', 'redraw'],
  sound: ['sound'],
  countdown: ['countdown'],
  certificate: ['certificate'],
  fields: ['data', 'display'],
});

const SECTION_NAMES = Object.freeze(Object.keys(SECTIONS));

// What a new template carries unless the organiser picks otherwise: the look
// and feel of the event, but not its name or the shape of its entry list,
// which belong to the event rather than the style.
const DEFAULT_SECTIONS = Object.freeze(
  SECTION_NAMES.filter((name) => name !== 'event' && name !== 'fields')
);

class TemplateError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = 'TemplateError';
    this.status = status;
  }
}

/* -------------------------------------------------------------- helpers */

function asSections(input, fallback) {
  const list = Array.isArray(input) ? input : fallback;
  return SECTION_NAMES.filter((name) => list.includes(name));
}

function pickSections(appSettings, sections) {
  return sections.reduce((picked, section) => {
    const keys = SECTIONS[section];
    return keys.reduce((accumulator, key) => {
      if (appSettings[key] === undefined) return accumulator;
      // Where the entry list came from belongs to the event, not the style.
      if (key === 'data') {
        const { sourceUrl: _url, sourceSyncedAt: _syncedAt, ...data } = appSettings.data;
        return { ...accumulator, data };
      }
      return { ...accumulator, [key]: appSettings[key] };
    }, picked);
  }, {});
}

function newId() {
  return `tpl-${Date.now().toString(36)}-${crypto.randomBytes(3).toString('hex')}`;
}

function asTimestamp(value) {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value)) ? value.slice(0, 40) : null;
}

/**
 * One template, made safe. `normalizeAppSettings` is passed in rather than
 * required, because settings.js depends on this module's neighbours and a
 * cycle would leave one of them half-loaded.
 */
function normalizeTemplate(input, normalizeAppSettings, { builtIn = false } = {}) {
  const source = asObject(input);
  const name = asText(source.name, '', 80);
  if (!name) return null;

  const sections = asSections(source.sections, DEFAULT_SECTIONS);
  const settings = pickSections(normalizeAppSettings(asObject(source.settings)), sections);

  return {
    id: asId(source.id, TEMPLATE_ID, newId()),
    name,
    description: asOptionalText(source.description, '', 300),
    sections,
    settings,
    builtIn,
    createdAt: asTimestamp(source.createdAt),
    updatedAt: asTimestamp(source.updatedAt),
  };
}

/* ------------------------------------------------------------- storage */

function readStored(normalizeAppSettings) {
  const document = store.readDocument('templates', { templates: [] }) || {};
  const raw = Array.isArray(document.templates) ? document.templates : [];
  return raw
    .map((entry) => normalizeTemplate(entry, normalizeAppSettings))
    .filter(Boolean)
    .filter((template) => !template.id.startsWith('builtin-'));
}

function writeStored(templates) {
  store.writeDocument('templates', {
    templates: templates.map(({ builtIn: _builtIn, ...template }) => template),
  });
}

/** The starting points that ship with the application. Read-only. */
function readBuiltIns(normalizeAppSettings) {
  const bundled = store.readBundledJson(PATHS.templatePresets, { templates: [] }) || {};
  const raw = Array.isArray(bundled.templates) ? bundled.templates : [];
  return raw
    .map((entry) => normalizeTemplate(entry, normalizeAppSettings, { builtIn: true }))
    .filter((template) => template && template.id.startsWith('builtin-'));
}

function listTemplates(normalizeAppSettings) {
  return [...readBuiltIns(normalizeAppSettings), ...readStored(normalizeAppSettings)];
}

function findTemplate(id, normalizeAppSettings) {
  const template = listTemplates(normalizeAppSettings).find((entry) => entry.id === id);
  if (!template) throw new TemplateError('That template no longer exists.', 404);
  return template;
}

/** Throws unless a template with this name could be saved right now. */
function assertCanCreate(name, normalizeAppSettings) {
  if (readStored(normalizeAppSettings).length >= MAX_TEMPLATES) {
    throw new TemplateError(`You can keep up to ${MAX_TEMPLATES} templates. Delete one to make room.`, 409);
  }
  if (!asText(name, '', 80)) throw new TemplateError('Give the template a name.');
}

function createTemplate(input, appSettings, normalizeAppSettings) {
  const stored = readStored(normalizeAppSettings);
  assertCanCreate(asObject(input).name, normalizeAppSettings);

  const source = asObject(input);
  const now = new Date().toISOString();
  const sections = asSections(source.sections, DEFAULT_SECTIONS);
  if (sections.length === 0) throw new TemplateError('Choose at least one part of the configuration to save.');

  const template = normalizeTemplate(
    {
      name: source.name,
      description: source.description,
      sections,
      // Built from the settings passed in, or — for an import — the ones
      // the file carried.
      settings: source.settings ? source.settings : pickSections(appSettings, sections),
      createdAt: now,
      updatedAt: now,
    },
    normalizeAppSettings
  );
  if (!template) throw new TemplateError('Give the template a name.');

  writeStored([...stored, template]);
  return template;
}

/**
 * Renames a template, or — with `refresh` — replaces what it holds with the
 * current configuration, keeping its name and the sections it was made of
 * unless new ones are given.
 */
function updateTemplate(id, input, appSettings, normalizeAppSettings) {
  const stored = readStored(normalizeAppSettings);
  const index = stored.findIndex((template) => template.id === id);
  if (index === -1) {
    if (String(id).startsWith('builtin-')) throw new TemplateError('Built-in templates cannot be changed. Save a copy instead.', 409);
    throw new TemplateError('That template no longer exists.', 404);
  }

  const source = asObject(input);
  const current = stored[index];
  const sections = asSections(source.sections, current.sections);
  if (sections.length === 0) throw new TemplateError('Choose at least one part of the configuration to keep.');

  const updated = normalizeTemplate(
    {
      ...current,
      name: source.name === undefined ? current.name : source.name,
      description: source.description === undefined ? current.description : source.description,
      sections,
      settings: source.refresh ? pickSections(appSettings, sections) : current.settings,
      updatedAt: new Date().toISOString(),
    },
    normalizeAppSettings
  );
  if (!updated) throw new TemplateError('Give the template a name.');

  writeStored(stored.map((template, position) => (position === index ? updated : template)));
  return updated;
}

function deleteTemplate(id, normalizeAppSettings) {
  if (String(id).startsWith('builtin-')) throw new TemplateError('Built-in templates cannot be deleted.', 409);
  const stored = readStored(normalizeAppSettings);
  const remaining = stored.filter((template) => template.id !== id);
  if (remaining.length === stored.length) throw new TemplateError('That template no longer exists.', 404);
  writeStored(remaining);
  return stored.find((template) => template.id === id);
}

/**
 * A template's sound settings over the event's own.
 *
 * The cues are the template's, but the track library is a collection of the
 * organiser's files rather than a style, so the two libraries are combined.
 * A template track whose id is already taken by a different file is given a
 * fresh one, and the template's cues follow it.
 */
function mergeSound(current, incoming) {
  const library = [...current.library];
  const renamed = {};
  const dropped = [];

  (incoming.library || []).forEach((track) => {
    // FIX: the library holds MAX_TRACKS; the event's own tracks come first,
    // and any of the template's that do not fit are reported, not lost quietly.
    if (library.length >= MAX_TRACKS && !library.some((existing) => existing.src === track.src)) {
      dropped.push(track.name);
      return;
    }
    if (library.some((existing) => existing.src === track.src)) {
      const existing = library.find((entry) => entry.src === track.src);
      renamed[track.id] = existing.id;
      return;
    }
    if (library.some((existing) => existing.id === track.id)) {
      const id = `track-${Date.now().toString(36)}-${crypto.randomBytes(2).toString('hex')}`;
      renamed[track.id] = id;
      library.push({ ...track, id });
      return;
    }
    library.push(track);
  });

  const cues = Object.fromEntries(
    Object.entries(incoming.cues || {}).map(([name, cue]) => [
      name,
      cue && renamed[cue.track] ? { ...cue, track: renamed[cue.track] } : cue,
    ])
  );

  return { sound: { ...incoming, library, cues }, dropped };
}

/**
 * The settings with a template's chosen sections laid over them.
 *
 * Sections replace whole: a template's prize list is the prize list, not a
 * merge of two. `keepEventName` holds on to the name and organisation of the
 * event being configured even when the template carries its own.
 */
function applyTemplate(template, appSettings, { sections, keepEventName = true } = {}, normalizeAppSettings) {
  const chosen = asSections(sections, template.sections).filter((name) => template.sections.includes(name));
  if (chosen.length === 0) throw new TemplateError('Choose at least one part of the template to apply.');

  const droppedTracks = [];
  const layered = chosen.reduce((next, section) => {
    return SECTIONS[section].reduce((accumulator, key) => {
      if (template.settings[key] === undefined) return accumulator;
      if (key === 'data') {
        return { ...accumulator, data: { ...template.settings.data, sourceUrl: appSettings.data.sourceUrl, sourceSyncedAt: appSettings.data.sourceSyncedAt } };
      }
      if (key === 'sound') {
        const merged = mergeSound(appSettings.sound, template.settings.sound);
        droppedTracks.push(...merged.dropped);
        return { ...accumulator, sound: merged.sound };
      }
      // When the draw starts, and whether the countdown is running, belong to
      // this event; a template brings the countdown's words and look.
      if (key === 'countdown') {
        return {
          ...accumulator,
          countdown: { ...template.settings.countdown, enabled: appSettings.countdown.enabled, targetAt: appSettings.countdown.targetAt },
        };
      }
      return { ...accumulator, [key]: template.settings[key] };
    }, next);
  }, { ...appSettings });

  const kept = keepEventName
    ? { ...layered, eventName: appSettings.eventName, organizationName: appSettings.organizationName }
    : layered;

  return { appSettings: normalizeAppSettings(kept), sections: chosen, droppedTracks };
}

/* -------------------------------------------------------------- assets */

/** Every uploaded file a configuration points at. */
function assetRefs(settings) {
  const source = asObject(settings);
  const branding = asObject(source.branding);
  const refs = [
    asObject(branding.logo).src,
    asObject(branding.background).src,
    ...(asObject(source.welcome).images || []).map((image) => image && image.src),
    ...((asObject(source.prizes).items || []).flatMap((item) => (item && item.images) || [])).map((image) => image && image.src),
    ...(asObject(source.sound).library || []).map((track) => track && track.src),
  ];
  return [...new Set(refs.filter((ref) => typeof ref === 'string' && ref.startsWith('assets/')))];
}

/**
 * Whether anything still needs a file — the live configuration or any saved
 * template. Nothing is deleted while a template holds it, or applying that
 * template later would bring back a broken image.
 */
function assetInUse(src, appSettings, normalizeAppSettings) {
  if (assetRefs(appSettings).includes(src)) return true;
  return readStored(normalizeAppSettings).some((template) => assetRefs(template.settings).includes(src));
}

/** Deletes an uploaded file once nothing refers to it any more. */
async function removeIfUnused(src, appSettings, normalizeAppSettings) {
  if (typeof src !== 'string' || !src.startsWith('assets/') || src.includes('..')) return false;
  if (assetInUse(src, appSettings, normalizeAppSettings)) return false;
  await images.removeImageAsset(src);
  return true;
}

/**
 * Drops references to files this deployment does not have, so applying a
 * template from elsewhere never leaves a broken image or a silent cue: a
 * missing logo falls back to the default, a missing photo or track is left out.
 */
async function withoutMissingAssets(appSettings, normalizeAppSettings) {
  const refs = assetRefs(appSettings);
  const present = new Set();
  await Promise.all(
    refs.map(async (ref) => {
      const data = await store.readBlob(ref.slice('assets/'.length));
      if (data) present.add(ref);
    })
  );

  const missing = refs.filter((ref) => !present.has(ref));
  if (missing.length === 0) return { appSettings, missing };

  const keep = (image) => !image || !missing.includes(image.src);
  const branding = appSettings.branding;
  const cleaned = {
    ...appSettings,
    branding: {
      ...branding,
      logo: missing.includes(branding.logo.src) ? { ...branding.logo, src: null, width: null, height: null } : branding.logo,
      background: missing.includes(branding.background.src)
        ? { ...branding.background, src: null, width: null, height: null }
        : branding.background,
    },
    welcome: { ...appSettings.welcome, images: appSettings.welcome.images.filter(keep) },
    prizes: {
      ...appSettings.prizes,
      items: appSettings.prizes.items.map((item) => ({ ...item, images: item.images.filter(keep) })),
    },
    sound: { ...appSettings.sound, library: appSettings.sound.library.filter(keep) },
  };

  return { appSettings: normalizeAppSettings(cleaned), missing };
}

/* ------------------------------------------------------ export / import */

/**
 * A template as a file. With `embed`, the images and audio it points at
 * travel inside it, so it works on a deployment that has never seen them.
 */
async function exportTemplate(template, { embed = false } = {}) {
  const assets = {};
  if (embed) {
    await Promise.all(
      assetRefs(template.settings).map(async (ref) => {
        const data = await store.readBlob(ref.slice('assets/'.length));
        if (data) assets[ref] = data.toString('base64');
      })
    );
  }

  return {
    format: TEMPLATE_FORMAT,
    version: TEMPLATE_VERSION,
    exportedAt: new Date().toISOString(),
    template: {
      name: template.name,
      description: template.description,
      sections: template.sections,
      settings: template.settings,
    },
    assets,
  };
}

const IMAGE_NAME = /^assets\/(logo|background|guest|prize)-[a-f0-9]{10}\.(png|jpg|gif|webp|svg)$/;
const IMAGE_EXTENSIONS = Object.freeze({ png: 'png', jpeg: 'jpg', gif: 'gif', webp: 'webp', svg: 'svg' });

/**
 * Whether an embedded file is what its name claims. Names carry a hash of the
 * content, so a file whose bytes do not hash to its own name — or are not the
 * kind of file the name says — is refused rather than trusted.
 */
function verifyEmbedded(ref, buffer) {
  const digest = crypto.createHash('sha1').update(buffer).digest('hex').slice(0, 10);

  const image = IMAGE_NAME.exec(ref);
  if (image) {
    const info = images.probeImage(buffer);
    if (!info || IMAGE_EXTENSIONS[info.format] !== image[2]) return false;
    if (buffer.length > images.maxBytesFor(image[1])) return false;
    return ref === `assets/${image[1]}-${digest}.${image[2]}`;
  }

  const format = audio.probeAudio(buffer);
  if (!format || buffer.length > store.maxBlobBytes) return false;
  return ref === `assets/${audio.audioFileName(buffer, format)}`;
}

/**
 * Reads a template file and stores whatever files it carries. Returns the
 * template input, ready for `createTemplate`, and which files were refused.
 */
async function importTemplate(payload) {
  const source = asObject(payload);
  if (source.format !== TEMPLATE_FORMAT) throw new TemplateError('That is not a Pickora template file.');
  if (Number(source.version) > TEMPLATE_VERSION) {
    throw new TemplateError('That template was made by a newer version of Pickora. Update this one first.');
  }

  const template = asObject(source.template);
  const embedded = asObject(source.assets);
  const refused = [];

  for (const [ref, encoded] of Object.entries(embedded)) {
    const buffer = typeof encoded === 'string' ? Buffer.from(encoded, 'base64') : null;
    if (!buffer || !verifyEmbedded(ref, buffer)) {
      refused.push(ref);
      continue;
    }
    // Sequential on purpose: a key-value store takes one large value at a time
    // more gracefully than a burst of them.
    // eslint-disable-next-line no-await-in-loop
    await store.saveBlob(ref.slice('assets/'.length), buffer);
  }

  return {
    input: {
      name: template.name,
      description: template.description,
      sections: template.sections,
      settings: asObject(template.settings),
    },
    refused,
  };
}

module.exports = {
  TemplateError,
  SECTIONS,
  SECTION_NAMES,
  DEFAULT_SECTIONS,
  MAX_TEMPLATES,
  assertCanCreate,
  pickSections,
  listTemplates,
  findTemplate,
  createTemplate,
  updateTemplate,
  deleteTemplate,
  applyTemplate,
  assetRefs,
  assetInUse,
  removeIfUnused,
  withoutMissingAssets,
  exportTemplate,
  importTemplate,
};

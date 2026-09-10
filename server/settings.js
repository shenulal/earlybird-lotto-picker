'use strict';

const { PATHS } = require('./paths');
const { readJson, writeJson, readBundledJson } = require('./store');
const { hashPassword } = require('./auth');
const schema = require('./schema');
const ticketStore = require('./tickets');

const DEFAULT_ADMIN_USERNAME = 'admin';
const DEFAULT_ADMIN_PASSWORD = 'pickora';

const BOARD_ALIGNMENTS = Object.freeze(['left', 'center', 'right']);
const DIRECTIONS = Object.freeze(['ltr', 'rtl']);
const LOGO_POSITIONS = Object.freeze([
  'top-left',
  'top-center',
  'top-right',
  'bottom-left',
  'bottom-center',
  'bottom-right',
  'hidden',
]);
const BACKGROUND_FITS = Object.freeze(['cover', 'contain', 'fill', 'tile']);
const DUPLICATE_POLICIES = Object.freeze(['skip', 'allow']);
const WELCOME_PLACEMENTS = Object.freeze(['overlay', 'panel']);

const MAX_WELCOME_IMAGES = 20;
const MAX_PRIZES = 20;
const MAX_PRIZE_IMAGES = 12;
const WELCOME_INTERVAL_LIMITS = Object.freeze([1500, 60000]);

// Used only when there is no configuration and no participant file to learn
// from — deliberately event-neutral.
const DEFAULT_FIELDS = Object.freeze([
  { key: 'ticket', label: 'Ticket', sensitive: false },
  { key: 'name', label: 'Name', sensitive: false },
  { key: 'details', label: 'Details', sensitive: false },
  { key: 'contact', label: 'Contact', sensitive: true },
]);

const DEFAULT_CONFETTI_PALETTE = Object.freeze(['#ffd54f', '#ff8a65', '#4dd0e1', '#f06292', '#aed581', '#ffffff']);

const DEFAULT_COPY = Object.freeze({
  readyTitle: 'Ready to draw',
  readyDetail: 'Press Start',
  winnerEyebrow: 'Winner',
  prizeLabel: 'Prize',
  lastWinnerEyebrow: 'Last winner',
  completeTitle: 'All prizes awarded',
  startButton: 'Start',
  stopButton: 'Stop',
  winnersHeading: 'Winners',
  winnersEmpty: 'No draws yet.',
  winnersToggle: 'Winners',
  fullscreenButton: 'Fullscreen',
  organiserLink: 'Organiser',
  welcomeToggle: 'Welcome',
  boardToggle: 'Draw board',
  prizesToggle: 'Prizes',
  prizesBack: 'Back to the draw',
  newDrawButton: 'New draw',
  newDrawConfirm: 'Clear the current draw and start over?',
  footer: 'Pickora · by Shenu',
  loading: 'Preparing the draw…',
});

const CLAMPS = Object.freeze({
  totalPrizes: [1, 10000],
  rollingSpeed: [10, 1000],
  confettiDuration: [0, 60000],
  confettiCount: [0, 600],
  winnerAnnouncementDelay: [0, 15000],
  confettiStartDelay: [0, 15000],
  minimumRollMs: [0, 30000],
  logoMaxHeight: [24, 480],
  overlayOpacity: [0, 100],
  welcomeIntervalMs: WELCOME_INTERVAL_LIMITS,
  prizeIntervalMs: WELCOME_INTERVAL_LIMITS,
});

function clamp(key, value, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  const [min, max] = CLAMPS[key];
  return Math.min(max, Math.max(min, Math.round(number)));
}

function asBoolean(value, fallback) {
  if (typeof value === 'boolean') return value;
  if (value === 'true') return true;
  if (value === 'false') return false;
  return fallback;
}

function asChoice(value, choices, fallback) {
  return choices.includes(value) ? value : fallback;
}

function asText(value, fallback, maxLength = 200) {
  if (typeof value !== 'string') return fallback;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, maxLength) : fallback;
}

function asAssetPath(value) {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  const isSafe = /^assets\/[A-Za-z0-9._-]+$/.test(trimmed) || /^[A-Za-z0-9._-]+\.(png|jpe?g|gif|webp|svg)$/i.test(trimmed);
  return isSafe ? trimmed : '';
}

function normalizeCopy(input) {
  const source = input && typeof input === 'object' ? input : {};
  return Object.keys(DEFAULT_COPY).reduce(
    (accumulator, key) => ({ ...accumulator, [key]: asText(source[key], DEFAULT_COPY[key], 160) }),
    {}
  );
}

function normalizePalette(input) {
  const list = Array.isArray(input) ? input : [];
  const colors = list
    .filter((color) => typeof color === 'string' && /^#[0-9a-f]{3,8}$/i.test(color.trim()))
    .map((color) => color.trim())
    .slice(0, 12);

  return colors.length > 0 ? colors : [...DEFAULT_CONFETTI_PALETTE];
}

/** Normalises a carousel image list, dropping anything unusable. */
function normalizeImages(input, limit) {
  const raw = Array.isArray(input) ? input : [];

  return raw
    .map((image) => {
      const entry = image && typeof image === 'object' ? image : { src: image };
      const src = asAssetPath(entry.src);
      if (!src) return null;
      return {
        src,
        caption: asText(entry.caption, '', 120),
        width: Number(entry.width) || null,
        height: Number(entry.height) || null,
      };
    })
    .filter(Boolean)
    .slice(0, limit);
}

/**
 * The prize list. Order is rank: the first entry is first prize, and it is
 * matched to a draw by position, so prize 1 goes with the first winner.
 */
function normalizePrizes(input) {
  const source = input && typeof input === 'object' ? input : {};
  const raw = Array.isArray(source.items) ? source.items : [];

  const items = raw
    .map((item, index) => {
      const entry = item && typeof item === 'object' ? item : {};
      const name = asText(entry.name, '', 140);
      if (!name) return null;

      return {
        // `.test()` stringifies, so an absent id would match as "undefined".
        id: typeof entry.id === 'string' && /^[a-z0-9-]{1,40}$/.test(entry.id) ? entry.id : `prize-${index + 1}`,
        // A default label follows the position, so reordering renumbers it.
        // A label the organiser actually wrote — "Grand prize" — is kept.
        label: isDefaultLabel(entry.label) ? ordinalLabel(index) : asText(entry.label, ordinalLabel(index), 60),
        name,
        description: asText(entry.description, '', 600),
        images: normalizeImages(entry.images, MAX_PRIZE_IMAGES),
      };
    })
    .filter(Boolean)
    .slice(0, MAX_PRIZES);

  // Ids must stay unique; a duplicate would make image uploads ambiguous.
  const seen = new Set();
  const unique = items.map((item, index) => {
    if (!seen.has(item.id)) {
      seen.add(item.id);
      return item;
    }
    const replacement = `prize-${index + 1}-${Math.random().toString(36).slice(2, 7)}`;
    seen.add(replacement);
    return { ...item, id: replacement };
  });

  return {
    enabled: asBoolean(source.enabled, false),
    heading: asText(source.heading, 'Prizes', 120),
    intro: asText(source.intro, '', 400),
    showOnWinner: asBoolean(source.showOnWinner, true),
    showCaptions: asBoolean(source.showCaptions, true),
    intervalMs: clamp('prizeIntervalMs', source.intervalMs, 5000),
    items: unique,
  };
}

const ORDINALS = Object.freeze([
  'First prize', 'Second prize', 'Third prize', 'Fourth prize', 'Fifth prize',
  'Sixth prize', 'Seventh prize', 'Eighth prize', 'Ninth prize', 'Tenth prize',
]);

function ordinalLabel(index) {
  return ORDINALS[index] || `Prize ${index + 1}`;
}

function isDefaultLabel(label) {
  if (typeof label !== 'string' || !label.trim()) return true;
  const trimmed = label.trim();
  return ORDINALS.includes(trimmed) || /^Prize \d+$/.test(trimmed);
}

/**
 * The guest welcome: a message plus a carousel of portraits, shown to greet a
 * special guest before or between draws.
 */
function normalizeWelcome(input) {
  const source = input && typeof input === 'object' ? input : {};
  const images = normalizeImages(source.images, MAX_WELCOME_IMAGES);

  return {
    enabled: asBoolean(source.enabled, false),
    showOnLoad: asBoolean(source.showOnLoad, true),
    placement: asChoice(source.placement, WELCOME_PLACEMENTS, 'overlay'),
    title: asText(source.title, 'Our special guest', 120),
    message: asText(source.message, '', 400),
    showCaptions: asBoolean(source.showCaptions, true),
    intervalMs: clamp('welcomeIntervalMs', source.intervalMs, 5000),
    images,
  };
}

function normalizeBranding(input) {
  const source = input && typeof input === 'object' ? input : {};
  const logo = source.logo || {};
  const background = source.background || {};

  return {
    logo: {
      src: asAssetPath(logo.src),
      position: asChoice(logo.position, LOGO_POSITIONS, 'top-left'),
      maxHeight: clamp('logoMaxHeight', logo.maxHeight, 96),
      width: Number(logo.width) || null,
      height: Number(logo.height) || null,
    },
    background: {
      // Defaults to the artwork the board has always shipped with, so an
      // existing deployment looks unchanged until a new file is uploaded.
      src: background.src === '' ? '' : asAssetPath(background.src) || 'Background.png',
      fit: asChoice(background.fit, BACKGROUND_FITS, 'cover'),
      overlayOpacity: clamp('overlayOpacity', background.overlayOpacity, 45),
      width: Number(background.width) || null,
      height: Number(background.height) || null,
    },
  };
}

/**
 * Rebuilds the participant schema.
 *
 * With no `data` block configured — a fresh install, or a file written before
 * the schema existed — the columns are read from the participant file itself
 * rather than assuming any particular event's shape.
 */
function normalizeData(input, legacyDisplay) {
  const source = input && typeof input === 'object' ? input : {};
  const duplicatePolicy = asChoice(source.duplicatePolicy, DUPLICATE_POLICIES, 'skip');
  const fields = schema.normalizeFields(source.fields);

  if (fields.length > 0) {
    return { identifier: schema.pickIdentifier(fields, source.identifier), fields, duplicatePolicy };
  }

  const inferred = ticketStore.inferSchemaFromFile();
  if (inferred) {
    // A board that previously displayed contact details keeps doing so.
    const adjusted =
      legacyDisplay.showMobileInWinner === true
        ? inferred.fields.map((field) => ({ ...field, sensitive: false }))
        : inferred.fields;
    return { identifier: inferred.identifier, fields: adjusted, duplicatePolicy };
  }

  return { identifier: DEFAULT_FIELDS[0].key, fields: schema.normalizeFields(DEFAULT_FIELDS), duplicatePolicy };
}

function normalizeAppSettings(input) {
  const source = input && typeof input === 'object' ? input : {};
  const animation = source.animation || {};
  const ui = source.ui || {};
  const draw = source.draw || {};
  const displaySource = source.display || {};

  const data = normalizeData(source.data, displaySource);
  const display = schema.normalizeDisplay(displaySource, data);

  return {
    totalPrizes: clamp('totalPrizes', source.totalPrizes, 10),
    eventName: asText(source.eventName, 'Pickora', 120),
    organizationName: asText(source.organizationName, '', 120),
    locale: asText(source.locale, 'en', 20),
    direction: asChoice(source.direction, DIRECTIONS, 'ltr'),

    data,
    display: {
      ...display,
      autoStopWhenPrizesExhausted: asBoolean(displaySource.autoStopWhenPrizesExhausted, true),
    },

    animation: {
      rollingSpeed: clamp('rollingSpeed', animation.rollingSpeed, 60),
      confettiDuration: clamp('confettiDuration', animation.confettiDuration, 8000),
      confettiCount: clamp('confettiCount', animation.confettiCount, 150),
      confettiPalette: normalizePalette(animation.confettiPalette),
      winnerAnnouncementDelay: clamp('winnerAnnouncementDelay', animation.winnerAnnouncementDelay, 2500),
      confettiStartDelay: clamp('confettiStartDelay', animation.confettiStartDelay, 500),
    },

    draw: {
      publicDrawEnabled: asBoolean(draw.publicDrawEnabled, true),
      requireAuthForDraw: asBoolean(draw.requireAuthForDraw, false),
      allowResetFromBoard: asBoolean(draw.allowResetFromBoard, false),
      minimumRollMs: clamp('minimumRollMs', draw.minimumRollMs, 1200),
    },

    branding: normalizeBranding(source.branding),
    welcome: normalizeWelcome(source.welcome),
    prizes: normalizePrizes(source.prizes),
    copy: normalizeCopy(source.copy),

    ui: {
      primaryColor: asText(ui.primaryColor, '#ffeb3b', 40),
      backgroundColor: asText(ui.backgroundColor, 'radial-gradient(circle at top, #1d2671, #c33764)', 400),
      showOrganizationName: asBoolean(ui.showOrganizationName, true),
      showWinnersPanel: asBoolean(ui.showWinnersPanel, false),
      showStats: asBoolean(ui.showStats, false),
      boardAlignment: asChoice(ui.boardAlignment, BOARD_ALIGNMENTS, 'center'),
    },
  };
}

function loadSettingsFile() {
  // Nothing stored yet — a first run, or a fresh deployment — starts from the
  // sample that ships with the application.
  const raw = readJson(PATHS.settings, null) || readBundledJson(PATHS.settingsSample, { appSettings: {} });
  return { appSettings: normalizeAppSettings(raw.appSettings), adminAuth: raw.adminAuth || null };
}

function saveSettingsFile(settingsFile) {
  writeJson(PATHS.settings, { appSettings: settingsFile.appSettings, adminAuth: settingsFile.adminAuth });
}

// Credentials live alongside the settings. Environment variables win when
// present so a deployment can override whatever is committed.
function ensureAdminCredentials() {
  const settingsFile = loadSettingsFile();
  const envUsername = process.env.ADMIN_USERNAME;
  const envPassword = process.env.ADMIN_PASSWORD;

  if (envUsername && envPassword) {
    return {
      settingsFile: {
        ...settingsFile,
        adminAuth: { ...hashPassword(envPassword), username: envUsername, source: 'environment', isDefaultPassword: false },
      },
      created: false,
      usingDefaults: false,
    };
  }

  if (settingsFile.adminAuth && settingsFile.adminAuth.hash) {
    return { settingsFile, created: false, usingDefaults: Boolean(settingsFile.adminAuth.isDefaultPassword) };
  }

  const bootstrapped = {
    ...settingsFile,
    adminAuth: {
      ...hashPassword(DEFAULT_ADMIN_PASSWORD),
      username: DEFAULT_ADMIN_USERNAME,
      source: 'file',
      isDefaultPassword: true,
      updatedAt: new Date().toISOString(),
    },
  };

  saveSettingsFile(bootstrapped);
  return { settingsFile: bootstrapped, created: true, usingDefaults: true };
}

module.exports = {
  DEFAULT_ADMIN_USERNAME,
  DEFAULT_ADMIN_PASSWORD,
  DEFAULT_COPY,
  BOARD_ALIGNMENTS,
  DIRECTIONS,
  LOGO_POSITIONS,
  BACKGROUND_FITS,
  DUPLICATE_POLICIES,
  WELCOME_PLACEMENTS,
  MAX_WELCOME_IMAGES,
  MAX_PRIZES,
  MAX_PRIZE_IMAGES,
  ordinalLabel,
  normalizeAppSettings,
  loadSettingsFile,
  saveSettingsFile,
  ensureAdminCredentials,
};

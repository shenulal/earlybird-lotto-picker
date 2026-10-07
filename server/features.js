'use strict';

/**
 * The settings behind the event features: sound, the "winner not present"
 * redraw, the countdown and the draw certificate.
 *
 * Every value an organiser can set is read through here, so whatever reaches
 * the board or the certificate has already been checked — a hand-edited
 * settings file, an imported template and the console all land on the same
 * rules. Absent values fall back to defaults that leave an event saved before
 * these features existed behaving exactly as it did: no sound, no countdown,
 * no redraw control on the board.
 */

const {
  clampNumber,
  asBoolean,
  asChoice,
  asText,
  asOptionalText,
  asColor,
  asObject,
  asId,
} = require('./coerce');

/* ================================================================= sound */

/**
 * The moments the board can mark with a sound, and the built-in sounds each
 * offers. The sounds themselves are synthesised in the browser (sound.js), so
 * nothing is downloaded, nothing is licensed, and they work offline.
 */
const SOUND_PRESETS = Object.freeze({
  ambient: ['lounge', 'gala', 'pulse', 'celesta'],
  spin: ['drumroll', 'ticker', 'riser', 'arcade', 'heartbeat'],
  land: ['cymbal', 'gong', 'chime', 'thud'],
  reveal: ['fanfare', 'tada', 'bells', 'arcade', 'applause'],
  absent: ['trombone', 'descend', 'buzz'],
  countdownTick: ['tick', 'beep', 'wood'],
  countdownEnd: ['horn', 'chime', 'gong'],
});

const SOUND_CUES = Object.freeze(Object.keys(SOUND_PRESETS));
const SOUND_SOURCES = Object.freeze(['preset', 'track']);

// What each cue does until an organiser says otherwise. Background music is
// off by default even once sound is on: it is the one cue that plays without
// anyone pressing anything.
const CUE_DEFAULTS = Object.freeze({
  ambient: { enabled: false, preset: 'lounge', volume: 35, loop: true },
  spin: { enabled: true, preset: 'drumroll', volume: 80, loop: true },
  land: { enabled: true, preset: 'cymbal', volume: 80, loop: false },
  reveal: { enabled: true, preset: 'fanfare', volume: 90, loop: false },
  absent: { enabled: true, preset: 'trombone', volume: 70, loop: false },
  countdownTick: { enabled: true, preset: 'tick', volume: 60, loop: false },
  countdownEnd: { enabled: true, preset: 'horn', volume: 90, loop: false },
});

const AMBIENT_SCREENS = Object.freeze(['board', 'welcome', 'prizes']);

const SOUND_LIMITS = Object.freeze({
  volume: [0, 100],
  // Ten minutes is longer than any sting and long enough for a walk-in track.
  durationMs: [0, 600000],
  fadeMs: [0, 10000],
  delayMs: [0, 10000],
  startAtMs: [0, 600000],
});

const MAX_TRACKS = 30;
const TRACK_ID = /^track-[a-z0-9-]{1,40}$/;
// Only files the audio upload itself wrote: its name carries the content hash.
const TRACK_SRC = /^assets\/audio-[a-f0-9]{10}\.(mp3|ogg|wav|m4a|aac|flac|webm)$/;
const TRACK_FORMATS = Object.freeze(['mp3', 'ogg', 'wav', 'm4a', 'aac', 'flac', 'webm']);

function normalizeTrack(input, index) {
  const source = asObject(input);
  const src = typeof source.src === 'string' && TRACK_SRC.test(source.src.trim()) ? source.src.trim() : '';
  if (!src) return null;

  return {
    id: asId(source.id, TRACK_ID, `track-${index + 1}`),
    name: asText(source.name, `Track ${index + 1}`, 80),
    src,
    format: asChoice(source.format, TRACK_FORMATS, src.split('.').pop()),
    bytes: clampNumber(source.bytes, [0, 1e9], 0),
  };
}

function normalizeLibrary(input) {
  const raw = Array.isArray(input) ? input : [];
  const seen = new Set();

  return raw
    .map(normalizeTrack)
    .filter(Boolean)
    .filter((track) => {
      if (seen.has(track.id)) return false;
      seen.add(track.id);
      return true;
    })
    .slice(0, MAX_TRACKS);
}

/**
 * One cue. A cue pointing at a track that is no longer in the library falls
 * back to its built-in sound rather than going silent at the event.
 */
function normalizeCue(name, input, library) {
  const source = asObject(input);
  const defaults = CUE_DEFAULTS[name];
  const trackIds = library.map((track) => track.id);
  const track = trackIds.includes(source.track) ? source.track : '';
  const wantsTrack = source.source === 'track';

  const cue = {
    enabled: asBoolean(source.enabled, defaults.enabled),
    source: wantsTrack && track ? 'track' : 'preset',
    preset: asChoice(source.preset, SOUND_PRESETS[name], defaults.preset),
    track,
    volume: clampNumber(source.volume, SOUND_LIMITS.volume, defaults.volume),
    // Zero is "as long as the sound is" — or, for a looping cue, until the
    // moment it belongs to is over.
    durationMs: clampNumber(source.durationMs, SOUND_LIMITS.durationMs, 0),
    fadeInMs: clampNumber(source.fadeInMs, SOUND_LIMITS.fadeMs, name === 'ambient' ? 1500 : 0),
    fadeOutMs: clampNumber(source.fadeOutMs, SOUND_LIMITS.fadeMs, name === 'ambient' || name === 'spin' ? 600 : 300),
    delayMs: clampNumber(source.delayMs, SOUND_LIMITS.delayMs, 0),
    // Where an uploaded track starts playing, so a song can begin on its hook.
    startAtMs: clampNumber(source.startAtMs, SOUND_LIMITS.startAtMs, 0),
    loop: asBoolean(source.loop, defaults.loop),
  };

  if (name !== 'ambient') return cue;

  const screens = asObject(source.screens);
  return {
    ...cue,
    screens: AMBIENT_SCREENS.reduce(
      (accumulator, screen) => ({ ...accumulator, [screen]: asBoolean(screens[screen], true) }),
      {}
    ),
    // The music steps aside for the draw itself, so the drumroll is heard.
    pauseDuringDraw: asBoolean(source.pauseDuringDraw, true),
  };
}

function normalizeSound(input) {
  const source = asObject(input);
  const library = normalizeLibrary(source.library);
  const cues = asObject(source.cues);

  return {
    // Off until the organiser turns it on: an event saved before sound
    // existed must not start making noise after an update.
    enabled: asBoolean(source.enabled, false),
    volume: clampNumber(source.volume, SOUND_LIMITS.volume, 80),
    // A speaker button on the public pages, for whoever is at the screen.
    showMuteButton: asBoolean(source.showMuteButton, true),
    library,
    cues: SOUND_CUES.reduce(
      (accumulator, name) => ({ ...accumulator, [name]: normalizeCue(name, cues[name], library) }),
      {}
    ),
  };
}

/* ================================================================ redraw */

const REDRAW_LIMITS = Object.freeze({
  maxPerPrize: [0, 50],
  noticeMs: [0, 15000],
});

function normalizeRedraw(input) {
  const source = asObject(input);

  return {
    // Off by default: until an organiser asks for it, a drawn winner stays drawn.
    enabled: asBoolean(source.enabled, false),
    // Whether the board's winner card offers the control at all.
    showOnBoard: asBoolean(source.showOnBoard, true),
    // Who may use it there. Signed-in by default — a guest at the screen must
    // not be able to strike a winner off.
    requireSignIn: asBoolean(source.requireSignIn, true),
    confirmOnBoard: asBoolean(source.confirmOnBoard, true),
    // Off by default: someone who was called and was not there does not get a
    // second chance at a later prize unless the organiser decides they do.
    returnToPool: asBoolean(source.returnToPool, false),
    // Spin again straight away, or go back to the prize and wait for Start.
    autoRedraw: asBoolean(source.autoRedraw, false),
    // How many times one prize may be redrawn. Zero is no limit.
    maxPerPrize: clampNumber(source.maxPerPrize, REDRAW_LIMITS.maxPerPrize, 0),
    noticeMs: clampNumber(source.noticeMs, REDRAW_LIMITS.noticeMs, 2500),
    showInPanel: asBoolean(source.showInPanel, true),
    includeInExport: asBoolean(source.includeInExport, true),
  };
}

/* ============================================================= countdown */

const COUNTDOWN_STYLES = Object.freeze(['overlay', 'banner']);
const COUNTDOWN_POSITIONS = Object.freeze(['top', 'bottom']);
const COUNTDOWN_UNITS = Object.freeze(['auto', 'dhms', 'hms', 'ms']);
const COUNTDOWN_SCREENS = Object.freeze(['board', 'welcome', 'prizes']);
const COUNTDOWN_LIMITS = Object.freeze({
  finalSeconds: [0, 60],
  completeHoldSeconds: [0, 3600],
});

/** A moment in time, kept as the ISO string it was given, or ''. */
function asInstant(value) {
  if (typeof value !== 'string' || !value.trim()) return '';
  const trimmed = value.trim().slice(0, 40);
  // Must carry its own offset: a bare local time means a different moment on
  // every screen that reads it, and in every timezone a server might be in.
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/.test(trimmed)) return '';
  return Number.isNaN(Date.parse(trimmed)) ? '' : trimmed;
}

function normalizeCountdown(input) {
  const source = asObject(input);
  const screens = asObject(source.screens);
  const labels = asObject(source.labels);

  return {
    enabled: asBoolean(source.enabled, false),
    targetAt: asInstant(source.targetAt),
    title: asText(source.title, 'The draw begins in', 120),
    subtitle: asOptionalText(source.subtitle, '', 200),
    completeMessage: asText(source.completeMessage, 'The draw is about to begin', 160),
    style: asChoice(source.style, COUNTDOWN_STYLES, 'overlay'),
    position: asChoice(source.position, COUNTDOWN_POSITIONS, 'top'),
    units: asChoice(source.units, COUNTDOWN_UNITS, 'auto'),
    screens: COUNTDOWN_SCREENS.reduce(
      (accumulator, screen) => ({ ...accumulator, [screen]: asBoolean(screens[screen], true) }),
      {}
    ),
    labels: {
      days: asText(labels.days, 'Days', 24),
      hours: asText(labels.hours, 'Hours', 24),
      minutes: asText(labels.minutes, 'Minutes', 24),
      seconds: asText(labels.seconds, 'Seconds', 24),
    },
    // Refuse draws from the board until the countdown is over. A signed-in
    // organiser can still draw early.
    lockDraw: asBoolean(source.lockDraw, true),
    // The last stretch is emphasised, and ticks if the tick sound is on.
    finalSeconds: clampNumber(source.finalSeconds, COUNTDOWN_LIMITS.finalSeconds, 10),
    // How long the closing message stays up. Zero leaves it until the next
    // draw starts.
    completeHoldSeconds: clampNumber(source.completeHoldSeconds, COUNTDOWN_LIMITS.completeHoldSeconds, 10),
  };
}

/** Whether a draw from the board must wait for the countdown, right now. */
function countdownLocksDraw(countdown, now = Date.now()) {
  if (!countdown.enabled || !countdown.lockDraw || !countdown.targetAt) return false;
  return now < Date.parse(countdown.targetAt);
}

/* =========================================================== certificate */

const PAPER_SIZES = Object.freeze(['A4', 'Letter']);
const ORIENTATIONS = Object.freeze(['portrait', 'landscape']);
const MAX_SIGNATORIES = 6;
const MAX_CERTIFICATE_FIELDS = 8;

const DEFAULT_STATEMENT =
  'This certifies that the prize draw for {event}, organised by {organization}, was conducted on {date}. ' +
  '{winners} winner(s) were drawn from {entries} eligible entries, as recorded below.';

const DEFAULT_METHOD =
  'Each winner was selected by the Pickora server using a cryptographically secure random number generator, ' +
  'with every remaining entry equally likely. Each result was recorded the moment it was drawn and cannot be ' +
  'changed from the public board.';

function normalizeSignatories(input) {
  const raw = Array.isArray(input) ? input : [
    { name: '', role: 'Organiser' },
    { name: '', role: 'Witness' },
  ];

  return raw
    .map((entry) => {
      const item = asObject(entry);
      const name = asOptionalText(item.name, '', 80);
      const role = asOptionalText(item.role, '', 80);
      return name || role ? { name, role } : null;
    })
    .filter(Boolean)
    .slice(0, MAX_SIGNATORIES);
}

/**
 * The participant columns printed against each winner. Only columns the event
 * actually has survive; with none chosen, the identifier and the next column
 * are used, which is usually a ticket number and a name.
 */
function normalizeCertificateFields(input, data) {
  const known = data.fields.map((field) => field.key);
  const chosen = (Array.isArray(input) ? input : []).filter(
    (key, index, list) => known.includes(key) && list.indexOf(key) === index
  );
  if (chosen.length > 0) return chosen.slice(0, MAX_CERTIFICATE_FIELDS);

  const fallback = [data.identifier, ...known.filter((key) => key !== data.identifier)];
  return fallback.slice(0, 2);
}

function normalizeCertificate(input, data) {
  const source = asObject(input);

  return {
    enabled: asBoolean(source.enabled, true),
    title: asText(source.title, 'Certificate of Draw', 120),
    subtitle: asOptionalText(source.subtitle, 'Official record of winners', 160),
    referencePrefix: asText(source.referencePrefix, 'PK', 12).replace(/[^A-Za-z0-9-]/g, '') || 'PK',
    statement: asText(source.statement, DEFAULT_STATEMENT, 1200),
    methodText: asText(source.methodText, DEFAULT_METHOD, 1200),
    venue: asOptionalText(source.venue, '', 160),
    footerNote: asOptionalText(source.footerNote, '', 400),
    showLogo: asBoolean(source.showLogo, true),
    showOrganization: asBoolean(source.showOrganization, true),
    showPrizes: asBoolean(source.showPrizes, true),
    showAbsent: asBoolean(source.showAbsent, true),
    showEntryCount: asBoolean(source.showEntryCount, true),
    showFingerprint: asBoolean(source.showFingerprint, true),
    showMethod: asBoolean(source.showMethod, true),
    showTimestamps: asBoolean(source.showTimestamps, true),
    // Contact details on a printed page are masked to their last digits
    // unless the organiser decides the document needs them whole.
    maskSensitive: asBoolean(source.maskSensitive, true),
    fields: normalizeCertificateFields(source.fields, data),
    signatories: normalizeSignatories(source.signatories),
    paper: asChoice(source.paper, PAPER_SIZES, 'A4'),
    orientation: asChoice(source.orientation, ORIENTATIONS, 'portrait'),
    // Empty is the certificate's own dark gold: a board's accent is chosen
    // for a dark screen and is usually too light to read on paper.
    accentColor: asColor(source.accentColor, ''),
  };
}

module.exports = {
  SOUND_PRESETS,
  SOUND_CUES,
  SOUND_SOURCES,
  AMBIENT_SCREENS,
  TRACK_FORMATS,
  MAX_TRACKS,
  COUNTDOWN_STYLES,
  COUNTDOWN_UNITS,
  PAPER_SIZES,
  ORIENTATIONS,
  MAX_SIGNATORIES,
  DEFAULT_STATEMENT,
  DEFAULT_METHOD,
  normalizeSound,
  normalizeRedraw,
  normalizeCountdown,
  normalizeCertificate,
  countdownLocksDraw,
};

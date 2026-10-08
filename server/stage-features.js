'use strict';

/**
 * The settings behind sponsors, the phone remote, live sync between screens
 * and the spin-the-wheel draw style.
 *
 * As with features.js, every value an organiser can set is read through here,
 * and an absent value falls back to a default that leaves an existing event
 * exactly as it was: no sponsors shown, no remote, no sync, the reel.
 */

const crypto = require('crypto');

const { clampNumber, asBoolean, asChoice, asText, asOptionalText, asColor, asObject, asId } = require('./coerce');

/* ============================================================== sponsors */

const MAX_SPONSORS = 30;
const SPONSOR_ID = /^sponsor-[a-z0-9-]{1,40}$/;
const PRIZE_ID = /^[a-z0-9-]{1,40}$/;
const SPONSOR_LOGO = /^assets\/sponsor-[a-f0-9]{10}\.(png|jpg|gif|webp|svg)$/;
const LOGO_SIZES = Object.freeze(['small', 'medium', 'large']);
const STRIP_POSITIONS = Object.freeze(['bottom', 'top']);
const SCREENS = Object.freeze(['board', 'welcome', 'prizes']);

/** An http(s) link, or ''. Anything else is not a link anyone should scan. */
function asLink(value) {
  if (typeof value !== 'string' || !value.trim()) return '';
  const trimmed = value.trim();
  const candidate = /^[a-z][a-z0-9+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const parsed = new URL(candidate);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return '';
    return parsed.host ? candidate.slice(0, 500) : '';
  } catch (_error) {
    return '';
  }
}

function screensFrom(input, defaults) {
  const source = asObject(input);
  return SCREENS.reduce((accumulator, screen) => ({ ...accumulator, [screen]: asBoolean(source[screen], defaults[screen]) }), {});
}

function normalizeSponsor(input, index) {
  const source = asObject(input);
  const name = asText(source.name, '', 80);
  if (!name) return null;
  const logo = asObject(source.logo);
  const src = typeof logo.src === 'string' && SPONSOR_LOGO.test(logo.src.trim()) ? logo.src.trim() : '';

  return {
    id: asId(source.id, SPONSOR_ID, `sponsor-${index + 1}`),
    name,
    // Free text, so a "Title sponsor" or "Official car partner" reads as the
    // contract says rather than one of a fixed few.
    tier: asOptionalText(source.tier, '', 40),
    tagline: asOptionalText(source.tagline, '', 140),
    url: asLink(source.url),
    logo: {
      src,
      width: src ? Number(logo.width) || null : null,
      height: src ? Number(logo.height) || null : null,
    },
  };
}

function normalizeSponsors(input) {
  const source = asObject(input);
  const seen = new Set();
  const items = (Array.isArray(source.items) ? source.items : [])
    .map(normalizeSponsor)
    .filter(Boolean)
    .filter((sponsor) => {
      if (seen.has(sponsor.id)) return false;
      seen.add(sponsor.id);
      return true;
    })
    .slice(0, MAX_SPONSORS);

  // Which sponsor stands behind which prize, by prize id. A link to a sponsor
  // that no longer exists is dropped rather than left dangling.
  const ids = new Set(items.map((sponsor) => sponsor.id));
  const prizeSponsors = Object.entries(asObject(source.prizeSponsors)).reduce((accumulator, [prizeId, sponsorId]) => {
    if (!PRIZE_ID.test(prizeId) || !ids.has(sponsorId)) return accumulator;
    return { ...accumulator, [prizeId]: sponsorId };
  }, {});

  const display = asObject(source.display);
  const strip = asObject(source.strip);

  return {
    // Off until the organiser turns it on.
    enabled: asBoolean(source.enabled, false),
    label: asText(source.label, 'Sponsored by', 60),
    items,
    prizeSponsors,
    display: {
      announcement: asBoolean(display.announcement, true),
      winnerCard: asBoolean(display.winnerCard, true),
      prizeScreen: asBoolean(display.prizeScreen, true),
      certificate: asBoolean(display.certificate, true),
      export: asBoolean(display.export, true),
      showTagline: asBoolean(display.showTagline, true),
      showName: asBoolean(display.showName, true),
      logoSize: asChoice(display.logoSize, LOGO_SIZES, 'medium'),
    },
    // A rotating strip of every sponsor's logo along an edge of the screen.
    strip: {
      enabled: asBoolean(strip.enabled, false),
      heading: asOptionalText(strip.heading, 'Our sponsors', 60),
      position: asChoice(strip.position, STRIP_POSITIONS, 'bottom'),
      screens: screensFrom(strip.screens, { board: false, welcome: true, prizes: true }),
      intervalMs: clampNumber(strip.intervalMs, [1500, 30000], 4000),
      logoHeight: clampNumber(strip.logoHeight, [24, 160], 48),
      perView: clampNumber(strip.perView, [1, 8], 4),
      showNames: asBoolean(strip.showNames, false),
      // Only sponsors at these tiers, or every sponsor when empty.
      tiers: (Array.isArray(strip.tiers) ? strip.tiers : [])
        .filter((tier) => typeof tier === 'string' && tier.trim())
        .map((tier) => tier.trim().slice(0, 40))
        .slice(0, 12),
    },
  };
}

/** The sponsor behind a prize, when sponsors are on and one is assigned. */
function sponsorForPrize(sponsors, prizeId) {
  if (!sponsors || !sponsors.enabled || !prizeId) return null;
  const id = sponsors.prizeSponsors[prizeId];
  return id ? sponsors.items.find((sponsor) => sponsor.id === id) || null : null;
}

/* ================================================================ remote */

const REMOTE_ACTIONS = Object.freeze(['draw', 'notPresent', 'screens', 'sound']);
const REMOTE_KEY = /^[A-Za-z0-9_-]{24,64}$/;

function asInstant(value) {
  if (typeof value !== 'string' || !value.trim()) return '';
  return Number.isNaN(Date.parse(value)) ? '' : value.trim().slice(0, 40);
}

function normalizeRemote(input) {
  const source = asObject(input);
  const actions = asObject(source.actions);
  const key = typeof source.key === 'string' && REMOTE_KEY.test(source.key) ? source.key : '';

  return {
    enabled: asBoolean(source.enabled, false),
    // The pairing secret the phone holds. Never sent to a public page.
    key,
    keyCreatedAt: key ? asInstant(source.keyCreatedAt) : '',
    keyExpiresAt: key ? asInstant(source.keyExpiresAt) : '',
    // How long a new pairing stays valid. Zero never expires.
    expiryHours: clampNumber(source.expiryHours, [0, 720], 12),
    // A phone signed in to the console can always use the remote; with this
    // off, the pairing link alone is enough.
    requireSignIn: asBoolean(source.requireSignIn, false),
    actions: REMOTE_ACTIONS.reduce(
      (accumulator, action) => ({ ...accumulator, [action]: asBoolean(actions[action], true) }),
      {}
    ),
    confirmNotPresent: asBoolean(source.confirmNotPresent, true),
    haptics: asBoolean(source.haptics, true),
    // How often the board checks for a command. Shorter is snappier and costs
    // more requests.
    pollMs: clampNumber(source.pollMs, [400, 5000], 1000),
    showStatusOnBoard: asBoolean(source.showStatusOnBoard, true),
  };
}

function newRemoteKey() {
  return crypto.randomBytes(24).toString('base64url');
}

/** Whether a key presented by a phone is the live pairing, compared safely. */
function remoteKeyMatches(remote, presented, now = Date.now()) {
  if (!remote.enabled || !remote.key || typeof presented !== 'string') return false;
  if (remote.keyExpiresAt && now > Date.parse(remote.keyExpiresAt)) return false;
  const expected = Buffer.from(remote.key);
  const actual = Buffer.from(presented);
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

/** The remote settings a public page may see: everything but the secret. */
function publicRemote(remote) {
  const { key: _key, keyCreatedAt: _created, ...rest } = remote;
  return { ...rest, paired: Boolean(remote.key) };
}

/* ============================================================= live sync */

const CONTROLLER_MODES = Object.freeze(['auto', 'main-only']);

function normalizeLiveSync(input) {
  const source = asObject(input);
  return {
    enabled: asBoolean(source.enabled, false),
    pollMs: clampNumber(source.pollMs, [500, 10000], 1500),
    // 'auto': the first draw board opened takes control. 'main-only': only a
    // board opened at /?role=main may.
    controllerMode: asChoice(source.controllerMode, CONTROLLER_MODES, 'auto'),
    // Taking control needs an organiser sign-in on that browser. Off lets any
    // board take control — convenient, but anyone on the network could then
    // demote the main board.
    claimRequiresSignIn: asBoolean(source.claimRequiresSignIn, true),
    // How long a board keeps control after it stops checking in.
    leaseSeconds: clampNumber(source.leaseSeconds, [5, 120], 15),
    mirrorDraws: asBoolean(source.mirrorDraws, true),
    followNavigation: asBoolean(source.followNavigation, true),
    // Followers usually just watch: two boards able to draw is two draws.
    followersCanDraw: asBoolean(source.followersCanDraw, false),
    soundOnFollowers: asBoolean(source.soundOnFollowers, false),
    celebrateOnFollowers: asBoolean(source.celebrateOnFollowers, true),
    screens: screensFrom(source.screens, { board: true, welcome: true, prizes: true }),
    showStatus: asBoolean(source.showStatus, true),
  };
}

/* ================================================================= wheel */

const POINTER_SIDES = Object.freeze(['top', 'right', 'bottom', 'left']);
const DRAW_STYLES = Object.freeze(['reel', 'wheel']);

function normalizeWheel(input) {
  const source = asObject(input);
  const palette = (Array.isArray(source.palette) ? source.palette : [])
    .map((color) => asColor(color, ''))
    .filter(Boolean)
    .slice(0, 12);

  return {
    // 'reel' is what every board has always done.
    style: asChoice(source.style, DRAW_STYLES, 'reel'),
    segments: clampNumber(source.segments, [4, 48], 16),
    // Empty uses the celebration palette, so a wheel matches its confetti.
    palette,
    // Empty picks dark or light text per segment, whichever reads.
    textColor: asColor(source.textColor, ''),
    borderColor: asColor(source.borderColor, ''),
    // Zero sizes the wheel to the screen.
    size: clampNumber(source.size, [0, 1400], 0),
    fontSize: clampNumber(source.fontSize, [0, 60], 0),
    // Turns per second at full speed, in tenths.
    speed: clampNumber(source.speed, [3, 40], 12),
    // How long the wheel takes to come to rest once the winner is known.
    settleMs: clampNumber(source.settleMs, [1500, 15000], 5000),
    pointer: asChoice(source.pointer, POINTER_SIDES, 'top'),
    showLabels: asBoolean(source.showLabels, true),
    centerLogo: asBoolean(source.centerLogo, true),
    centerText: asOptionalText(source.centerText, '', 24),
    // The participant field written on the segments; empty uses the first
    // field the reel shows.
    labelField: typeof source.labelField === 'string' ? source.labelField.trim().slice(0, 64) : '',
  };
}

module.exports = {
  MAX_SPONSORS,
  SCREENS,
  REMOTE_ACTIONS,
  CONTROLLER_MODES,
  DRAW_STYLES,
  normalizeSponsors,
  sponsorForPrize,
  normalizeRemote,
  newRemoteKey,
  remoteKeyMatches,
  publicRemote,
  normalizeLiveSync,
  normalizeWheel,
};

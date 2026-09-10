'use strict';

const crypto = require('crypto');

const PBKDF2_ITERATIONS = 120000;
const PBKDF2_KEYLEN = 32;
const PBKDF2_DIGEST = 'sha256';
const SALT_BYTES = 16;

const SESSION_COOKIE = 'eb_session';

// Long enough to cover setting up days before an event and still be signed in
// on the night. Override with SESSION_TTL_HOURS.
const SESSION_TTL_HOURS = Math.min(Math.max(Number(process.env.SESSION_TTL_HOURS) || 24 * 14, 1), 24 * 90);
const SESSION_TTL_MS = SESSION_TTL_HOURS * 60 * 60 * 1000;

const MAX_LOGIN_ATTEMPTS = 8;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;

// Last resort only: a process-local secret means a second instance rejects
// this one's cookies, so it is used solely when there is no credential to
// derive from yet.
const EPHEMERAL_SECRET = crypto.randomBytes(32).toString('hex');

/**
 * The key that signs session cookies.
 *
 * Derived from the stored credential when SESSION_SECRET is not configured, so
 * every instance of a horizontally-scaled deployment agrees without any setup —
 * a per-process random key made sessions fail as soon as a second instance
 * served a request. Changing the password rotates the key, which correctly
 * signs out anyone holding an older cookie.
 */
function sessionSecret(credential) {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
  if (credential && credential.hash && credential.salt) {
    return crypto.createHash('sha256').update(`pickora:${credential.salt}:${credential.hash}`).digest('hex');
  }
  return EPHEMERAL_SECRET;
}

function hashPassword(password, salt = crypto.randomBytes(SALT_BYTES).toString('hex')) {
  const derived = crypto
    .pbkdf2Sync(password, salt, PBKDF2_ITERATIONS, PBKDF2_KEYLEN, PBKDF2_DIGEST)
    .toString('hex');

  return { algorithm: 'pbkdf2-sha256', iterations: PBKDF2_ITERATIONS, salt, hash: derived };
}

function verifyPassword(password, credential) {
  if (!credential || !credential.salt || !credential.hash) return false;

  const iterations = Number(credential.iterations) || PBKDF2_ITERATIONS;
  const expected = Buffer.from(credential.hash, 'hex');
  const actual = crypto.pbkdf2Sync(
    password,
    credential.salt,
    iterations,
    expected.length || PBKDF2_KEYLEN,
    PBKDF2_DIGEST
  );

  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

function sign(value, credential) {
  return crypto.createHmac('sha256', sessionSecret(credential)).update(value).digest('base64url');
}

function createSessionToken(username, credential) {
  const payload = Buffer.from(
    JSON.stringify({ username, expiresAt: Date.now() + SESSION_TTL_MS })
  ).toString('base64url');

  return `${payload}.${sign(payload, credential)}`;
}

function readSessionToken(token, credential) {
  if (typeof token !== 'string' || !token.includes('.')) return null;

  const [payload, signature] = token.split('.');
  const expected = sign(payload, credential);

  if (
    signature.length !== expected.length ||
    !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))
  ) {
    return null;
  }

  try {
    const session = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (!session.expiresAt || session.expiresAt < Date.now()) return null;
    return session;
  } catch (_error) {
    return null;
  }
}

function parseCookies(header) {
  return String(header || '')
    .split(';')
    .reduce((cookies, part) => {
      const index = part.indexOf('=');
      if (index < 1) return cookies;
      cookies[part.slice(0, index).trim()] = decodeURIComponent(part.slice(index + 1).trim());
      return cookies;
    }, {});
}

// In-memory throttle. Resets on restart, which is fine for a tool that runs on
// a single instance for the duration of an event.
const attemptsByClient = new Map();

function registerFailedLogin(clientKey) {
  const now = Date.now();
  const entry = attemptsByClient.get(clientKey);

  if (!entry || now - entry.firstAttemptAt > LOGIN_WINDOW_MS) {
    attemptsByClient.set(clientKey, { count: 1, firstAttemptAt: now });
    return;
  }

  attemptsByClient.set(clientKey, { ...entry, count: entry.count + 1 });
}

function clearFailedLogins(clientKey) {
  attemptsByClient.delete(clientKey);
}

function isLockedOut(clientKey) {
  const entry = attemptsByClient.get(clientKey);
  if (!entry) return false;
  if (Date.now() - entry.firstAttemptAt > LOGIN_WINDOW_MS) {
    attemptsByClient.delete(clientKey);
    return false;
  }
  return entry.count >= MAX_LOGIN_ATTEMPTS;
}

module.exports = {
  SESSION_COOKIE,
  SESSION_TTL_MS,
  SESSION_TTL_HOURS,
  sessionSecret,
  MAX_LOGIN_ATTEMPTS,
  hashPassword,
  verifyPassword,
  createSessionToken,
  readSessionToken,
  parseCookies,
  registerFailedLogin,
  clearFailedLogins,
  isLockedOut,
};

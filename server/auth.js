'use strict';

const crypto = require('crypto');

const PBKDF2_ITERATIONS = 120000;
const PBKDF2_KEYLEN = 32;
const PBKDF2_DIGEST = 'sha256';
const SALT_BYTES = 16;

const SESSION_COOKIE = 'eb_session';
const SESSION_TTL_MS = 8 * 60 * 60 * 1000; // one long event day

const MAX_LOGIN_ATTEMPTS = 8;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;

// Regenerated on restart unless pinned via env, which logs everyone out on
// redeploy — acceptable for a single-operator event tool.
const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');

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

function sign(value) {
  return crypto.createHmac('sha256', SESSION_SECRET).update(value).digest('base64url');
}

function createSessionToken(username) {
  const payload = Buffer.from(
    JSON.stringify({ username, expiresAt: Date.now() + SESSION_TTL_MS })
  ).toString('base64url');

  return `${payload}.${sign(payload)}`;
}

function readSessionToken(token) {
  if (typeof token !== 'string' || !token.includes('.')) return null;

  const [payload, signature] = token.split('.');
  const expected = sign(payload);

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

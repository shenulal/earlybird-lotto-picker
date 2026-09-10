'use strict';

const path = require('path');

const ROOT_DIR = path.resolve(__dirname, '..');

const PATHS = Object.freeze({
  root: ROOT_DIR,
  settings: path.join(ROOT_DIR, 'appsettings.json'),
  settingsSample: path.join(ROOT_DIR, 'appsettings.sample.json'),
  tickets: path.join(ROOT_DIR, 'tickets.json'),
  drawState: path.join(ROOT_DIR, 'winners.json'),
});

// Files that must never be reachable through the static file middleware.
// appsettings.json carries the hashed admin credentials; winners.json carries
// participant contact details of everyone already drawn, and tickets.json those
// of everyone entered.
const PROTECTED_FILES = Object.freeze([
  'appsettings.json',
  'winners.json',
  // FIX: tickets.json was served as a static file, so the whole entry list —
  // names, companies and the columns marked sensitive, such as phone numbers —
  // could be downloaded by anyone who guessed the URL. The board never needs
  // it: it reads entries through /api/pool, which strips non-display fields.
  'tickets.json',
  'package.json',
  'package-lock.json',
  'requirements.txt',
]);

const PROTECTED_DIRS = Object.freeze(['server', 'pyserver', 'windows', '.git', 'node_modules', '.playwright-mcp']);

function isProtectedPath(requestPath) {
  const normalized = String(requestPath || '')
    .replace(/^\/+/, '')
    .split('?')[0]
    .toLowerCase();

  if (!normalized) return false;
  if (PROTECTED_FILES.some((file) => normalized === file.toLowerCase())) return true;

  const firstSegment = normalized.split('/')[0];
  return PROTECTED_DIRS.includes(firstSegment);
}

module.exports = { PATHS, PROTECTED_FILES, PROTECTED_DIRS, isProtectedPath };

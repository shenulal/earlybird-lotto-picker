'use strict';

const fs = require('fs');
const path = require('path');

class StorageError extends Error {
  constructor(message, cause) {
    super(message);
    this.name = 'StorageError';
    this.cause = cause;
  }
}

function readJson(filePath, fallback = null) {
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(raw);
  } catch (error) {
    if (error.code === 'ENOENT' && fallback !== null) return fallback;
    if (error instanceof SyntaxError) {
      throw new StorageError(`${path.basename(filePath)} is not valid JSON`, error);
    }
    if (fallback !== null) return fallback;
    throw new StorageError(`Unable to read ${path.basename(filePath)}`, error);
  }
}

// Write through a temp file in the same directory so a crash mid-write can
// never leave a half-written settings or winners file behind.
function writeJson(filePath, data) {
  const tempPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  const payload = `${JSON.stringify(data, null, 2)}\n`;

  try {
    fs.writeFileSync(tempPath, payload, 'utf8');
    fs.renameSync(tempPath, filePath);
  } catch (error) {
    try {
      fs.unlinkSync(tempPath);
    } catch (_cleanupError) {
      /* the temp file may never have been created */
    }
    if (error.code === 'EROFS' || error.code === 'EACCES' || error.code === 'EPERM') {
      throw new StorageError(
        `Cannot write ${path.basename(filePath)} — the application directory is read-only. ` +
          'Deploy to a host with a writable filesystem or mount a persistent volume.',
        error
      );
    }
    throw new StorageError(`Unable to save ${path.basename(filePath)}`, error);
  }
}

function fileExists(filePath) {
  return fs.existsSync(filePath);
}

module.exports = { readJson, writeJson, fileExists, StorageError };

'use strict';

/**
 * Document and blob storage.
 *
 * Pickora keeps its state in a handful of JSON documents plus uploaded images.
 * Locally those are files. On a serverless host the application directory is
 * read-only and instances are ephemeral, so the same documents live in a
 * key-value store reached over HTTP.
 *
 * Both drivers are dependency-free, so the offline install still needs nothing
 * but Node itself. The rest of the application keeps its synchronous reads and
 * writes: a request hydrates the snapshot once, works against it in memory,
 * and flushes whatever changed before responding.
 */

const fs = require('fs');
const path = require('path');

const { PATHS } = require('./paths');

class StorageError extends Error {
  constructor(message, cause) {
    super(message);
    this.name = 'StorageError';
    this.cause = cause;
  }
}

const DOCUMENTS = Object.freeze({
  settings: 'appsettings.json',
  tickets: 'tickets.json',
  draw: 'winners.json',
});

const DOCUMENT_BY_FILE = Object.freeze(
  Object.fromEntries(Object.entries(DOCUMENTS).map(([key, file]) => [file, key]))
);

/* ============================ filesystem driver ========================== */

const fsDriver = {
  name: 'filesystem',
  // Blobs are ordinary files under assets/, so the static handler serves them.
  servesBlobsAsFiles: true,
  // A backdrop chosen from a camera roll is the largest thing here.
  maxBlobBytes: 10 * 1024 * 1024,

  async loadDocuments() {
    return Object.fromEntries(
      Object.entries(DOCUMENTS).map(([key, file]) => {
        const target = path.join(PATHS.root, file);
        try {
          return [key, JSON.parse(fs.readFileSync(target, 'utf8'))];
        } catch (error) {
          if (error instanceof SyntaxError) {
            throw new StorageError(`${file} is not valid JSON`, error);
          }
          return [key, null];
        }
      })
    );
  },

  async saveDocument(key, value) {
    const target = path.join(PATHS.root, DOCUMENTS[key]);
    const temp = `${target}.tmp-${process.pid}-${Date.now()}`;

    try {
      // Written through a temp file in the same directory so a crash mid-write
      // cannot leave a half-written document behind.
      fs.writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
      fs.renameSync(temp, target);
    } catch (error) {
      try {
        fs.unlinkSync(temp);
      } catch (_cleanup) {
        /* the temp file may never have been created */
      }
      throw describeWriteFailure(DOCUMENTS[key], error);
    }
  },

  async saveBlob(name, buffer) {
    const directory = path.join(PATHS.root, 'assets');
    try {
      fs.mkdirSync(directory, { recursive: true });
      fs.writeFileSync(path.join(directory, name), buffer);
    } catch (error) {
      throw describeWriteFailure(name, error);
    }
  },

  async readBlob(name) {
    try {
      return fs.readFileSync(path.join(PATHS.root, 'assets', name));
    } catch (_error) {
      return null;
    }
  },

  async deleteBlob(name) {
    try {
      fs.unlinkSync(path.join(PATHS.root, 'assets', name));
    } catch (_error) {
      /* already gone */
    }
  },
};

function describeWriteFailure(file, error) {
  if (['EROFS', 'EACCES', 'EPERM'].includes(error.code)) {
    return new StorageError(
      `Cannot write ${file} — the application directory is read-only. ` +
        'Set KV_REST_API_URL and KV_REST_API_TOKEN to store data in a key-value store instead, ' +
        'or run Pickora on a host with a writable filesystem.',
      error
    );
  }
  return new StorageError(`Unable to save ${file}`, error);
}

/* =============================== KV driver =============================== */

const KV_PREFIX = 'pickora';

/**
 * Speaks the Upstash REST dialect, which Vercel KV also serves. Plain HTTP,
 * so no client library is required.
 */
function createKvDriver(baseUrl, token) {
  const endpoint = baseUrl.replace(/\/+$/, '');

  async function command(body) {
    let response;
    try {
      response = await fetch(`${endpoint}/pipeline`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    } catch (error) {
      throw new StorageError('Cannot reach the key-value store.', error);
    }

    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new StorageError(`The key-value store rejected the request (${response.status}). ${detail}`.trim());
    }

    const payload = await response.json();
    return Array.isArray(payload) ? payload.map((entry) => entry.result) : [payload.result];
  }

  return {
    name: 'key-value store',
    servesBlobsAsFiles: false,
    // Values travel as base64 inside a JSON request, so large uploads are
    // refused rather than silently failing at the store's own limit.
    maxBlobBytes: 2 * 1024 * 1024,

    async loadDocuments() {
      const keys = Object.keys(DOCUMENTS);
      const results = await command(keys.map((key) => ['GET', `${KV_PREFIX}:doc:${key}`]));

      return Object.fromEntries(
        keys.map((key, index) => {
          const raw = results[index];
          if (raw === null || raw === undefined) return [key, null];
          try {
            return [key, typeof raw === 'string' ? JSON.parse(raw) : raw];
          } catch (error) {
            throw new StorageError(`Stored ${DOCUMENTS[key]} is not valid JSON`, error);
          }
        })
      );
    },

    async saveDocument(key, value) {
      await command([['SET', `${KV_PREFIX}:doc:${key}`, JSON.stringify(value)]]);
    },

    async saveBlob(name, buffer) {
      await command([['SET', `${KV_PREFIX}:blob:${name}`, buffer.toString('base64')]]);
    },

    async readBlob(name) {
      const [raw] = await command([['GET', `${KV_PREFIX}:blob:${name}`]]);
      return raw ? Buffer.from(String(raw), 'base64') : null;
    },

    async deleteBlob(name) {
      await command([['DEL', `${KV_PREFIX}:blob:${name}`]]);
    },
  };
}

/* ============================== the store =============================== */

function resolveDriver() {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  return url && token ? createKvDriver(url, token) : fsDriver;
}

const driver = resolveDriver();

const snapshot = { loaded: false, documents: {}, dirty: new Set() };
let hydration = null;

/**
 * Documents the store has never seen fall back to the copies that ship with
 * the application, so a fresh deployment starts with the committed event data
 * rather than empty. They are seeded in memory only: once the organiser saves
 * anything, the stored copy takes over permanently — including an empty list,
 * which must not be re-seeded.
 */
function seedFromBundle(documents) {
  return Object.fromEntries(
    Object.entries(DOCUMENTS).map(([key, file]) => {
      const stored = documents[key];
      if (stored !== null && stored !== undefined) return [key, stored];
      return [key, readBundledJson(path.join(PATHS.root, file), null)];
    })
  );
}

/**
 * Loads the current documents. Called once per request, and deliberately not
 * cached across requests: a file edited by hand must be picked up without a
 * restart, and two serverless instances must not drift apart while both are
 * serving the same event. Concurrent callers share one load.
 */
async function hydrate({ force = false } = {}) {
  // Never discard writes that have not reached the store yet.
  if (snapshot.dirty.size > 0 && !force) return;
  if (hydration) {
    await hydration;
    return;
  }

  hydration = driver
    .loadDocuments()
    .then((documents) => {
      snapshot.documents = driver.servesBlobsAsFiles ? documents : seedFromBundle(documents);
      snapshot.loaded = true;
      snapshot.dirty.clear();
    })
    .finally(() => {
      hydration = null;
    });

  await hydration;
}

function assertHydrated() {
  if (!snapshot.loaded) {
    throw new StorageError('Storage was read before it was loaded.');
  }
}

function readDocument(key, fallback = null) {
  assertHydrated();
  const value = snapshot.documents[key];
  return value === null || value === undefined ? fallback : value;
}

function writeDocument(key, value) {
  assertHydrated();
  snapshot.documents[key] = value;
  snapshot.dirty.add(key);
}

/** Persists everything changed during this request. */
async function flush() {
  if (snapshot.dirty.size === 0) return;
  const pending = [...snapshot.dirty];
  snapshot.dirty.clear();

  try {
    await Promise.all(pending.map((key) => driver.saveDocument(key, snapshot.documents[key])));
  } catch (error) {
    pending.forEach((key) => snapshot.dirty.add(key));
    throw error;
  }
}

/**
 * Reads a file that ships with the application and is never written — the
 * sample configuration. Always on disk, even where the store is remote.
 */
function readBundledJson(filePath, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (_error) {
    return fallback;
  }
}

/**
 * Confirms the configured storage can actually accept a write, without
 * disturbing any real document. Used by the health check so a misconfigured
 * deployment reports the problem before the first draw rather than during it.
 */
async function probeWritable() {
  if (driver === fsDriver) {
    const probe = path.join(PATHS.root, '.pickora-write-probe');
    try {
      fs.writeFileSync(probe, 'ok');
      fs.unlinkSync(probe);
    } catch (error) {
      throw describeWriteFailure('winners.json', error);
    }
    return;
  }

  await driver.saveBlob('.write-probe', Buffer.from('ok'));
  await driver.deleteBlob('.write-probe');
}

/* Legacy file-named helpers, so callers keep reading like a file store. */
function readJson(filePath, fallback = null) {
  const key = DOCUMENT_BY_FILE[path.basename(String(filePath))];
  if (!key) throw new StorageError(`Unknown document ${filePath}`);
  return readDocument(key, fallback);
}

function writeJson(filePath, data) {
  const key = DOCUMENT_BY_FILE[path.basename(String(filePath))];
  if (!key) throw new StorageError(`Unknown document ${filePath}`);
  writeDocument(key, data);
}

function fileExists(filePath) {
  const key = DOCUMENT_BY_FILE[path.basename(String(filePath))];
  return key ? readDocument(key) !== null : false;
}

module.exports = {
  StorageError,
  DOCUMENTS,
  driver,
  hydrate,
  flush,
  probeWritable,
  readJson,
  writeJson,
  fileExists,
  readBundledJson,
  readDocument,
  writeDocument,
  saveBlob: (name, buffer) => driver.saveBlob(name, buffer),
  readBlob: (name) => driver.readBlob(name),
  deleteBlob: (name) => driver.deleteBlob(name),
  maxBlobBytes: driver.maxBlobBytes,
  servesBlobsAsFiles: driver.servesBlobsAsFiles,
};

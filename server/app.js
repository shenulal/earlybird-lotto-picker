'use strict';

/**
 * Builds the Pickora request handler.
 *
 * Kept separate from the local listener so the same application can be mounted
 * by a serverless entry point, where there is no long-lived process to own a
 * port.
 */

const express = require('./micro');
const fs = require('node:fs');
const path = require('path');

const store = require('./store');
const { PATHS, isProtectedPath } = require('./paths');
const { createApiRouter } = require('./routes');
const { BUILD, VERSION_PARAM, stampHtml } = require('./build');

const ASSET_NAME = /^[A-Za-z0-9._-]+$/;

/* Pages are rewritten once per build, not once per request. */
const pageCache = new Map();

/**
 * NEW: sends a page with its asset URLs carrying the current build.
 *
 * The page itself must never be cached — it is what tells the browser which
 * build's assets to fetch — so it revalidates every time, cheaply, against an
 * entity tag.
 */
function sendPage(req, res, fileName) {
  let html = pageCache.get(fileName);
  if (html === undefined) {
    try {
      html = stampHtml(fs.readFileSync(path.join(PATHS.root, fileName), 'utf8'));
    } catch (_error) {
      res.status(404).send('Not found');
      return;
    }
    pageCache.set(fileName, html);
  }

  const etag = `"${BUILD}-${fileName}"`;
  res.setHeader('ETag', etag);
  res.setHeader('Cache-Control', 'no-cache');
  if (req.headers['if-none-match'] === etag) {
    res.statusCode = 304;
    res.end();
    return;
  }

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(html);
}

function createApp() {
  const app = express();

  app.set('trust proxy', true);
  app.disable('x-powered-by');

  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    next();
  });

  app.use('/api', createApiRouter());

  // The credential store and the drawn-winner file sit next to the static
  // assets, so they are refused before express.static can hand them out.
  app.use((req, res, next) => {
    if (isProtectedPath(req.path)) {
      return res.status(404).send('Not found');
    }
    return next();
  });

  /* Uploaded images live in the store. With the filesystem driver they are
     ordinary files under assets/ and the static handler below serves them;
     otherwise they are fetched from the key-value store. */
  app.get('/assets/:name', async (req, res, next) => {
    if (store.servesBlobsAsFiles) return next();

    const name = String(req.params.name || '');
    if (!ASSET_NAME.test(name)) return res.status(404).send('Not found');

    try {
      const data = await store.readBlob(name);
      if (!data) return res.status(404).send('Not found');

      res.setHeader('Content-Type', express.contentTypeFor(name));
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      return res.send(data);
    } catch (error) {
      return next(error);
    }
  });

  /* Extensionless routes for the screens an organiser links to or projects. */
  app.get('/admin', (req, res) => sendPage(req, res, 'admin.html'));
  app.get('/welcome', (req, res) => sendPage(req, res, 'welcome.html'));
  app.get('/prizes', (req, res) => sendPage(req, res, 'prizes.html'));

  // CHANGED: pages go through the stamper rather than the static handler, so
  // the markup they serve always points at this build's assets.
  app.use((req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    if (!/^\/[A-Za-z0-9._-]+\.html$/.test(req.path)) return next();

    const fileName = req.path.replace(/^\//, '');
    if (isProtectedPath(fileName)) return next();
    return sendPage(req, res, fileName);
  });

  app.use(
    express.static(PATHS.root, {
      // CHANGED: the directory index is handled by the stamper below, not
      // here, or "/" would be served without its versioned asset URLs.
      index: false,
      // Within a build a file cannot change, so its tag is the build and its
      // size. Across a build the tag changes, and the browser is told so.
      etagFor: (filePath, stats) => `"${BUILD}-${stats.size}"`,
      setHeaders: (res, filePath, stats, req) => {
        /* CHANGED: a request carrying this build's version may be kept for as
           long as the browser likes — a new build asks for a different URL, so
           the old entry can never be served in its place. Anything asked for
           without one has to be revalidated, because there is no way to know
           which build the asker had in mind. */
        const versioned = req && req.query && req.query[VERSION_PARAM] === BUILD;

        if (versioned) {
          res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        } else if (/\.(html|json|css|js)$/i.test(filePath)) {
          res.setHeader('Cache-Control', 'no-cache');
        } else if (/\.(woff2?|png|jpe?g|gif|webp|svg|ico)$/i.test(filePath)) {
          res.setHeader('Cache-Control', 'public, max-age=604800');
        }
      },
    })
  );

  app.get('*', (req, res) => sendPage(req, res, 'index.html'));

  return app;
}

module.exports = { createApp };

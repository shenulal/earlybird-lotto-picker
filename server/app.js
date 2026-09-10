'use strict';

/**
 * Builds the Pickora request handler.
 *
 * Kept separate from the local listener so the same application can be mounted
 * by a serverless entry point, where there is no long-lived process to own a
 * port.
 */

const express = require('./micro');
const path = require('path');

const store = require('./store');
const { PATHS, isProtectedPath } = require('./paths');
const { createApiRouter } = require('./routes');

const ASSET_NAME = /^[A-Za-z0-9._-]+$/;

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
  app.get('/admin', (_req, res) => res.sendFile(path.join(PATHS.root, 'admin.html')));
  app.get('/welcome', (_req, res) => res.sendFile(path.join(PATHS.root, 'welcome.html')));
  app.get('/prizes', (_req, res) => res.sendFile(path.join(PATHS.root, 'prizes.html')));

  app.use(
    express.static(PATHS.root, {
      index: 'index.html',
      setHeaders: (res, filePath) => {
        // Markup, styles and scripts are revalidated every time. They are
        // small, and a stale one after a fix reaches the event PC is far worse
        // than the request. Fonts and images are stable, so they may be kept.
        if (/\.(html|json|css|js)$/i.test(filePath)) {
          res.setHeader('Cache-Control', 'no-cache');
        } else if (/\.(woff2?|png|jpe?g|gif|webp|svg|ico)$/i.test(filePath)) {
          res.setHeader('Cache-Control', 'public, max-age=604800');
        }
      },
    })
  );

  app.get('*', (_req, res) => res.sendFile(path.join(PATHS.root, 'index.html')));

  return app;
}

module.exports = { createApp };

'use strict';

/**
 * NEW: an identifier that changes whenever the served code changes.
 *
 * Everything about not serving people stale code hangs off this: asset URLs
 * carry it, so a new build cannot reuse an old cache entry; entity tags are
 * derived from it, so revalidation answers honestly; and a page left open on a
 * projector compares it against the running build to know it should reload.
 *
 * On Vercel the commit is free and exact. Elsewhere the files themselves are
 * hashed once at start-up — mtimes cannot be trusted, because a deployment
 * platform may well normalise them, which is the bug this whole module exists
 * to prevent.
 */

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const { PATHS } = require('./paths');

// The files a browser caches and would otherwise keep across a deployment.
const HASHED = [
  'index.html',
  'admin.html',
  'welcome.html',
  'prizes.html',
  'styles.css',
  'admin.css',
  'api.js',
  'theme.js',
  'script.js',
  'confetti.js',
  'reel.js',
  'qr.js',
  'social.js',
  'carousel.js',
  'feature-page.js',
  'admin.js',
  'admin-config.js',
];

function hashFiles() {
  const digest = crypto.createHash('sha1');

  HASHED.forEach((name) => {
    try {
      digest.update(name);
      digest.update(fs.readFileSync(path.join(PATHS.root, name)));
    } catch (_error) {
      // A file that is not there contributes its absence and nothing else.
      digest.update('missing');
    }
  });

  return digest.digest('hex').slice(0, 12);
}

function resolveBuild() {
  const commit = process.env.VERCEL_GIT_COMMIT_SHA || process.env.PICKORA_BUILD || '';
  if (commit) return String(commit).slice(0, 12);
  return hashFiles();
}

const BUILD = resolveBuild();

/** The query a versioned asset URL carries. */
const VERSION_PARAM = 'v';

/**
 * Rewrites a page so that every script, stylesheet and icon it pulls in is
 * requested at a URL carrying this build.
 *
 * A new deployment therefore asks for different URLs, and no cache anywhere —
 * the browser's, a corporate proxy's, or a CDN edge's — can answer with the
 * previous build's file, whatever it believes about freshness.
 */
function stampHtml(html) {
  const stamped = html.replace(
    /\b(src|href)="((?!https?:|\/\/|data:|mailto:|#)[^"?#]+\.(?:js|css|png|jpe?g|svg|ico))"/g,
    (match, attribute, url) => `${attribute}="${url}?${VERSION_PARAM}=${BUILD}"`
  );

  // The page also states its own build, so one left open can tell when it has
  // been superseded.
  return stamped.replace(
    /<head>/i,
    `<head>\n  <meta name="pickora-build" content="${BUILD}">`
  );
}

module.exports = { BUILD, VERSION_PARAM, stampHtml };

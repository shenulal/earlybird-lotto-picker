'use strict';

/**
 * A very small Express-compatible layer over Node's built-in http module.
 *
 * Pickora has to install and run on a machine with no internet access, so the
 * application ships with zero npm dependencies. This implements only the
 * surface the routes actually use — enough that `server/routes.js` reads
 * exactly as it would against Express.
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const DEFAULT_JSON_LIMIT = 25 * 1024 * 1024;

const MIME_TYPES = Object.freeze({
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  '.csv': 'text/csv; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.pdf': 'application/pdf',
});

function contentTypeFor(filePath) {
  return MIME_TYPES[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
}

/**
 * Compiles an Express-style path into a matcher.
 * Supports `:name` segments and a trailing `*` catch-all.
 */
function compile(pattern) {
  if (pattern === '*' || pattern === undefined) {
    return { test: () => ({}), prefix: null };
  }

  const names = [];
  const source = pattern
    .split('/')
    .map((segment) => {
      if (segment.startsWith(':')) {
        names.push(segment.slice(1));
        return '([^/]+)';
      }
      if (segment === '*') return '.*';
      return segment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    })
    .join('/');

  const regex = new RegExp(`^${source}/?$`);

  return {
    test(pathname) {
      const match = regex.exec(pathname);
      if (!match) return null;
      return names.reduce((params, name, index) => ({ ...params, [name]: decodeURIComponent(match[index + 1]) }), {});
    },
    prefix: pattern,
  };
}

/* -------------------------------------------------------------- response */

function decorateResponse(res) {
  res.statusCode = 200;

  res.status = (code) => {
    res.statusCode = code;
    return res;
  };

  res.set = res.setHeader.bind(res);

  res.json = (payload) => {
    if (!res.getHeader('Content-Type')) res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify(payload));
    return res;
  };

  res.send = (payload) => {
    if (Buffer.isBuffer(payload)) {
      res.end(payload);
      return res;
    }
    if (typeof payload === 'object' && payload !== null) return res.json(payload);
    if (!res.getHeader('Content-Type')) res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end(String(payload));
    return res;
  };

  res.sendFile = (filePath) => {
    fs.readFile(filePath, (error, data) => {
      if (error) {
        res.statusCode = error.code === 'ENOENT' ? 404 : 500;
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        res.end(error.code === 'ENOENT' ? 'Not found' : 'Unable to read file');
        return;
      }
      if (!res.getHeader('Content-Type')) res.setHeader('Content-Type', contentTypeFor(filePath));
      res.end(data);
    });
    return res;
  };

  // Cookies are appended, so several may be set on one response.
  res.cookie = (name, value, options = {}) => {
    const parts = [`${name}=${encodeURIComponent(value)}`, `Path=${options.path || '/'}`];
    if (options.maxAge) parts.push(`Max-Age=${Math.floor(options.maxAge / 1000)}`);
    if (options.httpOnly) parts.push('HttpOnly');
    if (options.secure) parts.push('Secure');
    if (options.sameSite) parts.push(`SameSite=${options.sameSite.replace(/^\w/, (c) => c.toUpperCase())}`);

    const existing = res.getHeader('Set-Cookie');
    const cookie = parts.join('; ');
    res.setHeader('Set-Cookie', existing ? [].concat(existing, cookie) : [cookie]);
    return res;
  };

  res.clearCookie = (name, options = {}) =>
    res.cookie(name, '', { ...options, maxAge: 0 });

  return res;
}

/* --------------------------------------------------------------- request */

function decorateRequest(req, trustProxy) {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  req.path = url.pathname;
  req.query = Object.fromEntries(url.searchParams);
  req.params = {};

  const forwardedFor = trustProxy ? String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() : '';
  req.ip = forwardedFor || (req.socket && req.socket.remoteAddress) || '';
  req.secure = trustProxy && req.headers['x-forwarded-proto'] === 'https';

  return req;
}

/* ------------------------------------------------------------ middleware */

function jsonBodyParser(options = {}) {
  const limit = typeof options.limit === 'string' ? parseSize(options.limit) : options.limit || DEFAULT_JSON_LIMIT;

  return function parseJson(req, res, next) {
    const type = String(req.headers['content-type'] || '');
    if (!type.includes('application/json') || req.method === 'GET' || req.method === 'HEAD') {
      req.body = req.body || {};
      return next();
    }

    let size = 0;
    const chunks = [];
    let aborted = false;

    req.on('data', (chunk) => {
      if (aborted) return;
      size += chunk.length;
      if (size > limit) {
        aborted = true;
        res.status(413).json({ ok: false, error: 'That upload is too large.' });
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });

    req.on('end', () => {
      if (aborted) return;
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) {
        req.body = {};
        return next();
      }
      try {
        req.body = JSON.parse(raw);
      } catch (_error) {
        return res.status(400).json({ ok: false, error: 'The request body is not valid JSON.' });
      }
      return next();
    });

    return undefined;
  };
}

function parseSize(value) {
  const match = /^(\d+(?:\.\d+)?)\s*(b|kb|mb|gb)?$/i.exec(String(value).trim());
  if (!match) return DEFAULT_JSON_LIMIT;
  const units = { b: 1, kb: 1024, mb: 1024 ** 2, gb: 1024 ** 3 };
  return Math.round(Number(match[1]) * (units[(match[2] || 'b').toLowerCase()] || 1));
}

function staticMiddleware(root, options = {}) {
  return function serveStatic(req, res, next) {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();

    const decoded = decodeURIComponent(req.path);
    // Resolve first, then confirm the result is still inside the root, so
    // `..` and encoded traversal cannot escape.
    const target = path.resolve(root, `.${decoded}`);
    if (target !== root && !target.startsWith(root + path.sep)) return next();

    fs.stat(target, (error, stats) => {
      if (error) return next();

      // FIX: `index: false` was read as falsy and fell through to the default,
      // so a caller that wanted to serve the directory index itself could not.
      if (stats.isDirectory() && options.index === false) return next();
      const filePath = stats.isDirectory() ? path.join(target, options.index || 'index.html') : target;
      fs.stat(filePath, (indexError, fileStats) => {
        if (indexError || !fileStats.isFile()) return next();

        res.setHeader('Content-Type', contentTypeFor(filePath));
        res.setHeader('Content-Length', fileStats.size);

        /* FIX: this used to send Last-Modified from the file's mtime, and a
           deployment platform may stamp every build with the same fixed date —
           Vercel uses 2018-10-20 for all of them. A browser then revalidated
           with that date, the edge compared it against an identical one and
           answered 304, and the old file was kept for good. Nothing short of a
           hard refresh could dislodge it.

           An entity tag built from the running build says what is actually
           meant: unchanged within a build, different across one. */
        if (typeof options.etagFor === 'function') {
          const etag = options.etagFor(filePath, fileStats);
          if (etag) {
            res.setHeader('ETag', etag);
            if (req.headers['if-none-match'] === etag) {
              res.statusCode = 304;
              res.removeHeader('Content-Length');
              res.end();
              return undefined;
            }
          }
        }

        if (typeof options.setHeaders === 'function') options.setHeaders(res, filePath, fileStats, req);

        if (req.method === 'HEAD') {
          res.end();
          return undefined;
        }

        fs.createReadStream(filePath).pipe(res);
        return undefined;
      });

      return undefined;
    });

    return undefined;
  };
}

/* ------------------------------------------------------------ app/router */

function createLayerHost() {
  const layers = [];

  function add(method, pattern, handlers) {
    handlers.forEach((handler) => layers.push({ method, matcher: compile(pattern), handler }));
  }

  const host = {
    layers,
    use(...args) {
      const [first, ...rest] = args;
      const pattern = typeof first === 'string' ? first : null;
      const targets = typeof first === 'string' ? rest : args;

      targets.forEach((target) => {
        const handler = typeof target === 'function' ? target : target.handle;
        layers.push({ method: null, matcher: pattern ? compile(pattern) : null, handler, mount: pattern });
      });

      return host;
    },
  };

  ['get', 'post', 'put', 'delete', 'patch', 'all'].forEach((method) => {
    host[method] = (pattern, ...handlers) => {
      add(method === 'all' ? null : method.toUpperCase(), pattern, handlers);
      return host;
    };
  });

  return host;
}

/** Walks the layer stack, honouring mount prefixes and `next()`. */
function runLayers(layers, req, res, done) {
  let index = 0;

  function next(error) {
    if (error) return done(error);
    if (index >= layers.length) return done();

    const layer = layers[index++];
    const originalPath = req.path;

    if (layer.method && layer.method !== req.method) return next();

    let params = {};
    if (layer.matcher) {
      if (layer.mount) {
        // Mounted middleware matches on prefix and hides it from the child.
        if (!(req.path === layer.mount || req.path.startsWith(`${layer.mount}/`))) return next();
        req.path = req.path.slice(layer.mount.length) || '/';
      } else {
        const matched = layer.matcher.test(req.path);
        if (!matched) return next();
        params = matched;
      }
    }

    req.params = { ...req.params, ...params };

    const restore = (err) => {
      req.path = originalPath;
      next(err);
    };

    try {
      const result = layer.handler(req, res, restore);
      if (result && typeof result.catch === 'function') result.catch(restore);
    } catch (handlerError) {
      restore(handlerError);
    }

    return undefined;
  }

  next();
}

function createApp() {
  const host = createLayerHost();
  const settings = { 'trust proxy': false };

  const app = (req, res) => app.handle(req, res);

  Object.assign(app, host, {
    set(key, value) {
      settings[key] = value;
      return app;
    },
    disable(key) {
      settings[key] = false;
      return app;
    },
    enabled: (key) => Boolean(settings[key]),

    handle(req, res, fallthrough) {
      decorateRequest(req, Boolean(settings['trust proxy']));
      decorateResponse(res);

      runLayers(host.layers, req, res, (error) => {
        if (fallthrough) return fallthrough(error);
        if (error) {
          console.error('Request failed:', error);
          if (!res.headersSent) res.status(500).json({ ok: false, error: 'Unexpected server error.' });
          return undefined;
        }
        if (!res.headersSent) {
          res.status(404).setHeader('Content-Type', 'text/plain; charset=utf-8');
          res.end('Not found');
        }
        return undefined;
      });
    },

    listen(port, callback) {
      const server = http.createServer(app);
      return server.listen(port, callback);
    },
  });

  return app;
}

function createRouter() {
  const host = createLayerHost();

  const router = {
    ...host,
    handle(req, res, next) {
      runLayers(host.layers, req, res, next);
    },
  };

  // `use`/verb helpers must return the router itself, not the bare host.
  ['use', 'get', 'post', 'put', 'delete', 'patch', 'all'].forEach((method) => {
    router[method] = (...args) => {
      host[method](...args);
      return router;
    };
  });

  return router;
}

const micro = (...args) => createApp(...args);
micro.Router = createRouter;
micro.json = jsonBodyParser;
micro.static = staticMiddleware;
micro.contentTypeFor = contentTypeFor;

module.exports = micro;

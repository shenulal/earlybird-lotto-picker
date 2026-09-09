'use strict';

const express = require('./server/micro');
const path = require('path');

const { PATHS, isProtectedPath } = require('./server/paths');
const { createApiRouter } = require('./server/routes');
const { ensureAdminCredentials, DEFAULT_ADMIN_USERNAME, DEFAULT_ADMIN_PASSWORD } = require('./server/settings');

const PORT = process.env.PORT || 3000;
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

// The credential store and the drawn-winner file sit next to the static assets,
// so they are refused before express.static can ever hand them out.
app.use((req, res, next) => {
  if (isProtectedPath(req.path)) {
    return res.status(404).send('Not found');
  }
  return next();
});

app.get('/admin', (_req, res) => res.sendFile(path.join(PATHS.root, 'admin.html')));

app.use(
  express.static(PATHS.root, {
    index: 'index.html',
    setHeaders: (res, filePath) => {
      if (/\.(html|json)$/i.test(filePath)) {
        res.setHeader('Cache-Control', 'no-cache');
      }
    },
  })
);

app.get('*', (_req, res) => res.sendFile(path.join(PATHS.root, 'index.html')));

function reportCredentialStatus() {
  try {
    const { created, usingDefaults } = ensureAdminCredentials();
    if (created) {
      console.log(`🔐 Admin account created: ${DEFAULT_ADMIN_USERNAME} / ${DEFAULT_ADMIN_PASSWORD}`);
    }
    if (usingDefaults) {
      console.warn('⚠️  The admin console is still using the default password. Change it at /admin.');
    }
  } catch (error) {
    console.error('⚠️  Could not prepare admin credentials:', error.message);
  }
}

const server = app.listen(PORT, () => {
  console.log(`🎰 Pickora is running on port ${PORT}`);
  console.log(`🌐 Public board:   http://localhost:${PORT}/`);
  console.log(`🛠️  Organiser console: http://localhost:${PORT}/admin`);
  reportCredentialStatus();
});

function shutdown() {
  console.log('👋 Server shutting down gracefully...');
  server.close(() => process.exit(0));
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

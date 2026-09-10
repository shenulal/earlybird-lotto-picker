'use strict';

/**
 * Local entry point: owns a port and reports where things are.
 * The application itself is built in server/app.js.
 */

const { createApp } = require('./server/app');
const store = require('./server/store');
const { ensureAdminCredentials, DEFAULT_ADMIN_USERNAME, DEFAULT_ADMIN_PASSWORD } = require('./server/settings');

const PORT = process.env.PORT || 3000;

async function reportCredentialStatus() {
  try {
    await store.hydrate();
    const { created, usingDefaults } = ensureAdminCredentials();
    if (created) {
      await store.flush();
      console.log(`🔐 Admin account created: ${DEFAULT_ADMIN_USERNAME} / ${DEFAULT_ADMIN_PASSWORD}`);
    }
    if (usingDefaults) {
      console.warn('⚠️  The admin console is still using the default password. Change it at /admin.');
    }
  } catch (error) {
    console.error('⚠️  Could not prepare admin credentials:', error.message);
  }
}

const server = createApp().listen(PORT, () => {
  console.log(`🎰 Pickora is running on port ${PORT}`);
  console.log(`🌐 Public board:   http://localhost:${PORT}/`);
  console.log(`🛠️  Organiser console: http://localhost:${PORT}/admin`);
  console.log(`💾 Storage: ${store.driver.name}`);
  reportCredentialStatus();
});

function shutdown() {
  console.log('👋 Server shutting down gracefully...');
  server.close(() => process.exit(0));
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

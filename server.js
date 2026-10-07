'use strict';

/**
 * Local entry point: owns a port and reports where things are.
 * The application itself is built in server/app.js.
 */

const { createApp } = require('./server/app');
const store = require('./server/store');
const { PATHS } = require('./server/paths');
const {
  ensureAdminCredentials,
  loadSettingsFile,
  DEFAULT_ADMIN_USERNAME,
  DEFAULT_ADMIN_PASSWORD,
} = require('./server/settings');

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

/**
 * NEW: a hosted tenant must never come up on the published default password.
 * The Docker image sets PICKORA_REQUIRE_ADMIN_CREDENTIALS, so a container
 * whose environment lost ADMIN_USERNAME / ADMIN_PASSWORD refuses to start
 * rather than serve a domain anyone can sign in to. A volume that already holds
 * a password the organiser chose is fine on its own.
 */
async function assertAdminCredentialsConfigured() {
  if (process.env.PICKORA_REQUIRE_ADMIN_CREDENTIALS !== '1') return;
  if (process.env.ADMIN_USERNAME && process.env.ADMIN_PASSWORD) return;

  await store.hydrate();
  const { adminAuth } = loadSettingsFile();
  if (adminAuth && adminAuth.hash && !adminAuth.isDefaultPassword) return;

  console.error(
    '⛔ No organiser password is configured. Set ADMIN_USERNAME and ADMIN_PASSWORD for this tenant ' +
      '— Pickora will not start on the default password.'
  );
  process.exit(1);
}

let server = null;

function listen() {
  server = createApp().listen(PORT, () => {
    console.log(`🎰 Pickora is running on port ${PORT}`);
    console.log(`🌐 Public board:   http://localhost:${PORT}/`);
    console.log(`🛠️  Organiser console: http://localhost:${PORT}/admin`);
    console.log(`💾 Storage: ${store.driver.name}`);
    if (process.env.PICKORA_TENANT) console.log(`🏷️  Tenant: ${process.env.PICKORA_TENANT}`);
    if (!store.driver.remote) console.log(`📁 Data: ${PATHS.data}`);
    reportCredentialStatus();
  });
}

assertAdminCredentialsConfigured()
  .then(listen)
  .catch((error) => {
    console.error('⛔ Could not check the organiser password:', error.message);
    process.exit(1);
  });

function shutdown() {
  console.log('👋 Server shutting down gracefully...');
  if (!server) process.exit(0);
  server.close(() => process.exit(0));
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

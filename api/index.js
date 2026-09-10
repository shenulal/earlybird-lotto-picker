'use strict';

/**
 * Serverless entry point (Vercel).
 *
 * Every request reaches the same application the local server runs; there is
 * no port to bind and no process to keep alive, so the handler is exported
 * directly. State lives in the key-value store configured by
 * KV_REST_API_URL / KV_REST_API_TOKEN, because the deployment filesystem is
 * read-only.
 */

const { createApp } = require('../server/app');
const store = require('../server/store');

const app = createApp();

// One line per cold start, so the Vercel function log shows which storage the
// deployment actually picked up.
console.log(`Pickora storage: ${store.driver.name}`);

module.exports = (req, res) => app.handle(req, res);

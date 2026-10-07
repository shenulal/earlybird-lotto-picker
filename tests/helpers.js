'use strict';

/**
 * Shared set-up for the server tests.
 *
 * Each test file runs in its own process (node --test), so pointing
 * PICKORA_DATA_DIR at a fresh temporary directory before anything from
 * server/ is loaded gives every file an empty, isolated event.
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function useTemporaryDataDir() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'pickora-test-'));
  process.env.PICKORA_DATA_DIR = directory;
  delete process.env.KV_REST_API_URL;
  delete process.env.KV_REST_API_TOKEN;
  delete process.env.UPSTASH_REDIS_REST_URL;
  delete process.env.UPSTASH_REDIS_REST_TOKEN;
  return directory;
}

/** A small entry list with a ticket and a name. */
function sampleTickets(count) {
  return Array.from({ length: count }, (_unused, index) => ({
    ticket: `T-${String(index + 1).padStart(3, '0')}`,
    name: `Guest ${index + 1}`,
  }));
}

const TICKET_DATA = Object.freeze({
  identifier: 'ticket',
  fields: [
    { key: 'ticket', label: 'Ticket', sensitive: false, includeInExport: true },
    { key: 'name', label: 'Name', sensitive: false, includeInExport: true },
  ],
});

module.exports = { useTemporaryDataDir, sampleTickets, TICKET_DATA };

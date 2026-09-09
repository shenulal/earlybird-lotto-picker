'use strict';

const { PATHS } = require('./paths');
const { readJson, writeJson } = require('./store');
const schema = require('./schema');

const MAX_TICKETS = 100000;
const FIELD_LIMIT = 300;

function trimField(value) {
  if (value === null || value === undefined) return '';
  return String(value).trim().slice(0, FIELD_LIMIT);
}

// Minimal RFC 4180 reader: quoted fields, escaped quotes, CRLF or LF rows.
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];

    if (inQuotes) {
      if (char === '"') {
        if (text[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
    } else if (char === ',') {
      row.push(field);
      field = '';
    } else if (char === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (char !== '\r') {
      field += char;
    }
  }

  row.push(field);
  rows.push(row);

  return rows.filter((entry) => entry.some((cell) => cell.trim() !== ''));
}

/** CSV keeps whatever columns the file declares; the header row names them. */
function readCsv(text) {
  const rows = parseCsv(text);
  if (rows.length === 0) return { columns: [], records: [] };

  const columns = rows[0].map((cell, index) => cell.trim() || `Column ${index + 1}`);
  const keys = columns.map((column, index) => schema.toKey(column, index));

  const records = rows.slice(1).map((cells) =>
    keys.reduce((record, key, index) => ({ ...record, [key]: trimField(cells[index]) }), {})
  );

  return { columns, records };
}

/** JSON keeps the union of every key present, in first-seen order. */
function readJsonUpload(text) {
  const parsed = JSON.parse(text);
  const list = Array.isArray(parsed) ? parsed : parsed && Array.isArray(parsed.tickets) ? parsed.tickets : null;
  if (!list) throw new Error('JSON must be an array of records or an object with a "tickets" array');

  const columns = [];
  const records = list.map((entry) => {
    if (!entry || typeof entry !== 'object') return {};
    return Object.keys(entry).reduce((record, rawKey) => {
      if (rawKey === 'processed') return record;
      const key = schema.toKey(rawKey, columns.length);
      if (!columns.includes(key)) columns.push(key);
      return { ...record, [key]: trimField(entry[rawKey]) };
    }, {});
  });

  return { columns, records };
}

/**
 * Coerces raw records against a schema, reporting what had to be dropped
 * rather than quietly shrinking the pool.
 */
function normalizeRecords(records, ticketSchema, duplicatePolicy = 'skip') {
  const keys = ticketSchema.fields.map((field) => field.key);
  const identifier = ticketSchema.identifier;
  const seen = new Set();
  const accepted = [];
  const issues = { missingIdentifier: 0, duplicates: 0, truncated: false };

  records.forEach((entry) => {
    if (!entry || typeof entry !== 'object') {
      issues.missingIdentifier += 1;
      return;
    }

    const id = trimField(entry[identifier]);
    if (!id) {
      issues.missingIdentifier += 1;
      return;
    }

    const seenKey = id.toLowerCase();
    if (seen.has(seenKey)) {
      issues.duplicates += 1;
      if (duplicatePolicy === 'skip') return;
    }

    if (accepted.length >= MAX_TICKETS) {
      issues.truncated = true;
      return;
    }

    seen.add(seenKey);
    accepted.push(keys.reduce((record, key) => ({ ...record, [key]: trimField(entry[key]) }), {}));
  });

  return { tickets: accepted, issues };
}

/**
 * Parses an uploaded file and derives the schema its columns imply. The
 * caller decides whether to adopt that schema or keep the configured one.
 */
function parseUpload(content, format, previousSchema) {
  const text = String(content || '').trim();
  if (!text) throw new Error('The uploaded file is empty');

  const looksLikeJson = text.startsWith('{') || text.startsWith('[');
  const resolvedFormat = format === 'csv' || format === 'json' ? format : looksLikeJson ? 'json' : 'csv';
  const { columns, records } = resolvedFormat === 'json' ? readJsonUpload(text) : readCsv(text);

  if (columns.length === 0) throw new Error('No columns were found in that file.');

  return { format: resolvedFormat, columns, records, schema: schema.schemaFromColumns(columns, previousSchema) };
}

/**
 * Reads the column names actually present in the participant file, in
 * first-seen order. Used to derive a schema when none is configured yet, so a
 * fresh install adopts whatever shape the organiser's data already has.
 */
function inferSchemaFromFile() {
  const data = readJson(PATHS.tickets, { tickets: [] }) || {};
  const records = Array.isArray(data) ? data : data.tickets || [];
  const columns = [];

  records.slice(0, 50).forEach((record) => {
    if (!record || typeof record !== 'object') return;
    Object.keys(record).forEach((key) => {
      if (key !== 'processed' && !columns.includes(key)) columns.push(key);
    });
  });

  return columns.length > 0 ? schema.schemaFromColumns(columns) : null;
}

function loadTicketSource(ticketSchema, duplicatePolicy = 'skip') {
  const data = readJson(PATHS.tickets, { tickets: [] }) || {};
  const records = Array.isArray(data) ? data : data.tickets || [];
  const { tickets, issues } = normalizeRecords(records, ticketSchema, duplicatePolicy);
  return { tickets, issues, rawCount: records.length };
}

function saveTickets(tickets) {
  writeJson(PATHS.tickets, { tickets });
}

function toCsv(rows, columns) {
  const escape = (value) => {
    const text = value === null || value === undefined ? '' : String(value);
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };

  return [
    columns.map((column) => escape(column.label)).join(','),
    ...rows.map((row) => columns.map((column) => escape(row[column.key])).join(',')),
  ].join('\n');
}

module.exports = {
  MAX_TICKETS,
  parseCsv,
  parseUpload,
  normalizeRecords,
  inferSchemaFromFile,
  loadTicketSource,
  saveTickets,
  toCsv,
};

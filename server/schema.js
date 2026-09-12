'use strict';

/**
 * Field schema and display slots.
 *
 * Participants have no fixed shape. The
 * columns come from whatever file the organiser uploads, and the board decides
 * what to paint from display slots that reference those columns by key.
 */

const MAX_FIELDS = 30;
const KEY_PATTERN = /^[a-z0-9_]{1,40}$/;

const EMPHASIS = Object.freeze(['primary', 'secondary', 'meta', 'eyebrow']);
const SLOTS = Object.freeze(['reel', 'call', 'card', 'panel']);

const MAX_LINES_PER_SLOT = 6;
const PANEL_ENTRY_LIMITS = Object.freeze([1, 500]);

/** Turns an arbitrary column heading into a stable, safe object key. */
function toKey(label, fallbackIndex = 0) {
  const slug = String(label || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40);

  return KEY_PATTERN.test(slug) ? slug : `field_${fallbackIndex + 1}`;
}

function toLabel(key) {
  return String(key)
    .split('_')
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

// Columns that usually carry personal contact details. Only used to pre-tick
// "sensitive" on import — the organiser stays in control of the final answer.
const SENSITIVE_HINTS = /mobile|phone|contact|email|whatsapp|passport|emirates|id_number|address/i;

// Columns that usually identify the physical ticket, tried in order. A
// sensitive column is never chosen automatically — a phone number happens to
// be unique, but it is not the thing being drawn.
const IDENTIFIER_HINTS = [
  /ticket/,
  /badge|entry|registration|booking|coupon|invoice|voucher/,
  /^id$|_id$|^no$|_no$|_number$|_code$|_ref$|serial/,
];

function normalizeField(input, index) {
  const source = input && typeof input === 'object' ? input : { key: input };
  const key = KEY_PATTERN.test(source.key) ? source.key : toKey(source.key || source.label, index);

  return {
    key,
    label: typeof source.label === 'string' && source.label.trim() ? source.label.trim().slice(0, 60) : toLabel(key),
    sensitive: source.sensitive === true || (source.sensitive === undefined && SENSITIVE_HINTS.test(key)),
    includeInExport: source.includeInExport !== false,
  };
}

function normalizeFields(input) {
  const list = Array.isArray(input) ? input : [];
  const seen = new Set();
  const fields = [];

  list.forEach((entry, index) => {
    const field = normalizeField(entry, index);
    if (seen.has(field.key) || fields.length >= MAX_FIELDS) return;
    seen.add(field.key);
    fields.push(field);
  });

  return fields;
}

function pickIdentifier(fields, preferred) {
  const keys = fields.map((field) => field.key);
  if (preferred && keys.includes(preferred)) return preferred;

  const safeKeys = fields.filter((field) => !field.sensitive).map((field) => field.key);
  for (const pattern of IDENTIFIER_HINTS) {
    const match = safeKeys.find((key) => pattern.test(key));
    if (match) return match;
  }

  return safeKeys[0] || keys[0] || 'ticket';
}

/** Builds a schema from the column headings of an uploaded file. */
function schemaFromColumns(columns, previous = {}) {
  const previousByKey = new Map((previous.fields || []).map((field) => [field.key, field]));

  const fields = normalizeFields(
    columns.map((column, index) => {
      const key = toKey(column, index);
      const previousField = previousByKey.get(key);
      // Keep the organiser's own label and sensitivity choices across
      // re-imports; otherwise use the heading exactly as the file wrote it.
      return {
        ...(previousField || {}),
        key,
        label: (previousField && previousField.label) || String(column).trim() || toLabel(key),
      };
    })
  );

  return { identifier: pickIdentifier(fields, previous.identifier), fields };
}

function normalizeLine(input, validKeys, index) {
  const source = input && typeof input === 'object' ? input : { field: input };
  if (!validKeys.includes(source.field)) return null;

  return {
    field: source.field,
    emphasis: EMPHASIS.includes(source.emphasis) ? source.emphasis : index === 0 ? 'primary' : 'meta',
    showLabel: source.showLabel === true,
  };
}

function normalizeLines(input, validKeys) {
  const list = Array.isArray(input) ? input : [];
  const seen = new Set();
  const lines = [];

  list.forEach((entry, index) => {
    const line = normalizeLine(entry, validKeys, index);
    if (!line || seen.has(line.field) || lines.length >= MAX_LINES_PER_SLOT) return;
    seen.add(line.field);
    lines.push(line);
  });

  return lines;
}

/** Sensible slots for a freshly imported schema, used when none are configured. */
function defaultDisplay(schema) {
  const { identifier, fields } = schema;
  const others = fields.filter((field) => field.key !== identifier);
  const visible = others.filter((field) => !field.sensitive);
  const [headline, ...rest] = visible;

  const line = (field, emphasis) => (field ? [{ field: field.key, emphasis, showLabel: false }] : []);

  return {
    reel: { lines: line({ key: identifier }, 'primary') },
    call: { lines: line({ key: identifier }, 'primary') },
    card: {
      lines: [
        ...line(headline, 'primary'),
        ...line({ key: identifier }, 'secondary'),
        ...rest.slice(0, 2).map((field) => ({ field: field.key, emphasis: 'meta', showLabel: false })),
      ],
    },
    panel: {
      lines: [
        ...line({ key: identifier }, 'eyebrow'),
        ...line(headline, 'primary'),
        ...rest.slice(0, 1).map((field) => ({ field: field.key, emphasis: 'meta', showLabel: false })),
      ],
      maxEntries: 50,
    },
  };
}

function clampEntries(value, fallback) {
  // FIX: as in settings.js — null, '' and [] are not numbers anybody gave us,
  // and Number() turning them into 0 disagreed with the Python side.
  const numeric =
    typeof value === 'number' ||
    typeof value === 'boolean' ||
    (typeof value === 'string' && value.trim() !== '');
  if (!numeric) return fallback;

  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  const [min, max] = PANEL_ENTRY_LIMITS;
  return Math.min(max, Math.max(min, Math.round(number)));
}

function normalizeDisplay(input, schema) {
  const source = input && typeof input === 'object' ? input : {};
  const validKeys = schema.fields.map((field) => field.key);
  const defaults = defaultDisplay(schema);

  const display = SLOTS.reduce((accumulator, slot) => {
    const configured = normalizeLines((source[slot] || {}).lines, validKeys);
    // An empty slot would leave a blank screen on stage, so fall back.
    return { ...accumulator, [slot]: { lines: configured.length > 0 ? configured : defaults[slot].lines } };
  }, {});

  display.panel.maxEntries = clampEntries((source.panel || {}).maxEntries, defaults.panel.maxEntries);
  return display;
}

/** Every field key the public board is allowed to receive. */
function publicFieldKeys(display) {
  return [...new Set(SLOTS.flatMap((slot) => display[slot].lines.map((line) => line.field)))];
}

function projectRecord(record, keys) {
  return keys.reduce((accumulator, key) => {
    if (record[key] === undefined) return accumulator;
    return { ...accumulator, [key]: record[key] };
  }, {});
}

module.exports = {
  EMPHASIS,
  SLOTS,
  MAX_FIELDS,
  MAX_LINES_PER_SLOT,
  toKey,
  toLabel,
  normalizeFields,
  pickIdentifier,
  schemaFromColumns,
  normalizeDisplay,
  defaultDisplay,
  publicFieldKeys,
  projectRecord,
};

'use strict';

/**
 * The small coercions every settings normaliser leans on.
 *
 * Shared so the board's settings and the event features built on top of them
 * read stored values the same way — and so the Python mirror has one set of
 * rules to match rather than several that drift.
 */

/**
 * A whole number inside [min, max], or `fallback` when the value is not a
 * number at all.
 *
 * Number() turns null, '' and [] into 0, where Python's float() refuses them
 * and falls back. The two backends have to agree, and zero is often a real
 * instruction ("no delay", "no limit"), so a missing value must never read as
 * one.
 */
function clampNumber(value, [min, max], fallback) {
  const numeric =
    typeof value === 'number' ||
    typeof value === 'boolean' ||
    (typeof value === 'string' && value.trim() !== '');
  if (!numeric) return fallback;

  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, Math.round(number)));
}

function asBoolean(value, fallback) {
  if (typeof value === 'boolean') return value;
  if (value === 'true') return true;
  if (value === 'false') return false;
  return fallback;
}

function asChoice(value, choices, fallback) {
  return choices.includes(value) ? value : fallback;
}

function asText(value, fallback, maxLength = 200) {
  if (typeof value !== 'string') return fallback;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, maxLength) : fallback;
}

/** Text that may legitimately be empty: '' is kept rather than defaulted. */
function asOptionalText(value, fallback, maxLength = 200) {
  if (typeof value !== 'string') return fallback;
  return value.trim().slice(0, maxLength);
}

/** A hex colour, or `fallback` — empty usually means "the screen's own". */
function asColor(value, fallback) {
  if (typeof value !== 'string') return fallback;
  const trimmed = value.trim();
  return /^#[0-9a-f]{3,8}$/i.test(trimmed) ? trimmed : fallback;
}

/** An object to read from, whatever was stored. */
function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

/** A stable id: lower-case letters, digits and hyphens. */
function asId(value, pattern, fallback) {
  return typeof value === 'string' && pattern.test(value) ? value : fallback;
}

module.exports = {
  clampNumber,
  asBoolean,
  asChoice,
  asText,
  asOptionalText,
  asColor,
  asObject,
  asId,
};

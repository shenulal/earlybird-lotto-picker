'use strict';

/**
 * Reads an entry list straight out of a Google Sheet.
 *
 * The sheet is fetched as CSV and handed to the same parser a file upload
 * goes through, so a linked sheet and an uploaded file behave identically:
 * the first row names the columns, and one of them identifies the entry.
 *
 * Only a URL built here is ever requested — the address the organiser pasted
 * is mined for a spreadsheet id and then discarded, so this cannot be pointed
 * at anything but Google's own export endpoint.
 */

const https = require('node:https');

const MAX_BYTES = 8 * 1024 * 1024;
const TIMEOUT_MS = 20000;
const MAX_REDIRECTS = 5;

// Google answers an export with a redirect to its own file hosts.
const ALLOWED_HOSTS = /(^|\.)(google\.com|googleusercontent\.com)$/;

/* A normal sheet: /spreadsheets/d/<id>/edit#gid=0 */
const SHEET_ID = /\/spreadsheets\/d\/([A-Za-z0-9_-]{16,})/;
/* One published to the web: /spreadsheets/d/e/<token>/pubhtml */
const PUBLISHED_ID = /\/spreadsheets\/d\/e\/([A-Za-z0-9_-]{16,})/;
/* The tab, which appears in the fragment as often as in the query. */
const TAB_ID = /[#?&]gid=([0-9]+)/;
/* Someone may paste the id on its own rather than the whole address. */
const BARE_ID = /^[A-Za-z0-9_-]{16,}$/;

class SheetError extends Error {
  constructor(message, { status = 400 } = {}) {
    super(message);
    this.name = 'SheetError';
    this.status = status;
  }
}

/**
 * Turns whatever the organiser pasted into Google's CSV export address.
 *
 * Accepts an edit link, a sharing link, a published-to-web link or a bare
 * spreadsheet id, with or without a tab.
 */
function exportUrlFor(input) {
  const value = String(input || '').trim();
  if (!value) throw new SheetError('Paste the link to your Google Sheet.');

  const tab = value.match(TAB_ID);
  const gid = tab ? `&gid=${tab[1]}` : '';

  const published = value.match(PUBLISHED_ID);
  if (published) {
    return `https://docs.google.com/spreadsheets/d/e/${published[1]}/pub?output=csv${gid}`;
  }

  const sheet = value.match(SHEET_ID);
  if (sheet) {
    return `https://docs.google.com/spreadsheets/d/${sheet[1]}/export?format=csv${gid}`;
  }

  if (BARE_ID.test(value)) {
    return `https://docs.google.com/spreadsheets/d/${value}/export?format=csv${gid}`;
  }

  throw new SheetError(
    'That does not look like a Google Sheets link. Copy the address from the browser while the sheet is open.'
  );
}

/** Follows Google's redirects, refusing to leave its own hosts. */
function get(url, redirectsLeft) {
  return new Promise((resolve, reject) => {
    let target;
    try {
      target = new URL(url);
    } catch (error) {
      reject(new SheetError('That link could not be read.'));
      return;
    }

    if (target.protocol !== 'https:' || !ALLOWED_HOSTS.test(target.hostname)) {
      reject(new SheetError('Entry data is only ever fetched from Google Sheets.'));
      return;
    }

    const request = https.get(
      target,
      { headers: { Accept: 'text/csv,*/*', 'User-Agent': 'Pickora' }, timeout: TIMEOUT_MS },
      (response) => {
        const { statusCode, headers } = response;

        if (statusCode >= 300 && statusCode < 400 && headers.location) {
          response.resume();
          if (redirectsLeft <= 0) {
            reject(new SheetError('Google redirected too many times.'));
            return;
          }
          resolve(get(new URL(headers.location, target).toString(), redirectsLeft - 1));
          return;
        }

        if (statusCode === 401 || statusCode === 403) {
          response.resume();
          reject(
            new SheetError(
              'That sheet is private. In Google Sheets choose Share → General access → Anyone with the link → Viewer, then try again.'
            )
          );
          return;
        }

        if (statusCode === 404) {
          response.resume();
          reject(new SheetError('No sheet was found at that link. Check the address, and the tab it points at.'));
          return;
        }

        if (statusCode !== 200) {
          response.resume();
          reject(new SheetError(`Google Sheets answered with ${statusCode}.`, { status: 502 }));
          return;
        }

        const chunks = [];
        let bytes = 0;
        response.on('data', (chunk) => {
          bytes += chunk.length;
          if (bytes > MAX_BYTES) {
            request.destroy();
            reject(new SheetError('That sheet is larger than 8 MB.'));
            return;
          }
          chunks.push(chunk);
        });
        response.on('end', () => {
          resolve({
            body: Buffer.concat(chunks).toString('utf8'),
            contentType: String(headers['content-type'] || ''),
          });
        });
      }
    );

    request.on('timeout', () => {
      request.destroy();
      reject(new SheetError('Google Sheets did not answer in time.', { status: 504 }));
    });

    request.on('error', () => {
      reject(
        new SheetError(
          'Google Sheets could not be reached. Check the connection — on an offline machine, import a CSV file instead.',
          { status: 502 }
        )
      );
    });
  });
}

/**
 * Fetches a sheet and returns it as CSV text, ready for the upload parser.
 *
 * Returns the canonical export address alongside it, which is what gets
 * remembered so the list can be pulled again without pasting the link twice.
 */
async function fetchSheetCsv(input) {
  const url = exportUrlFor(input);
  const { body, contentType } = await get(url, MAX_REDIRECTS);

  // A sheet that is not shared answers 200 with the sign-in page rather than
  // an error, so the body has to be checked as well as the status.
  if (/text\/html/i.test(contentType) || /^\s*<(!doctype|html)/i.test(body)) {
    throw new SheetError(
      'That sheet is private. In Google Sheets choose Share → General access → Anyone with the link → Viewer, then try again.'
    );
  }

  if (!body.trim()) {
    throw new SheetError('That sheet is empty. The first row must name the columns.');
  }

  return { content: body, url };
}

module.exports = { SheetError, exportUrlFor, fetchSheetCsv, MAX_BYTES };

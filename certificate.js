/**
 * The draw certificate.
 *
 * A print-ready record of the draw, built in the browser from one call to
 * /api/admin/certificate, which only a signed-in organiser can make. What it
 * says and shows is the organiser's own configuration; the facts — who won,
 * when, from how many entries, and the fingerprints — come from the server.
 *
 * Opened inside the console with ?preview, it also listens for unsaved edits
 * from the console, so the preview follows the form as it is typed in.
 */
(function certificatePage(global, document) {
  'use strict';

  const DEFAULT_ACCENT = '#b08d3c';
  const isPreview = new URLSearchParams(global.location.search).has('preview');
  const mount = document.getElementById('certificate');
  let data = null;
  let draft = null;

  function escapeHtml(value) {
    return String(value === null || value === undefined ? '' : value).replace(
      /[&<>"']/g,
      (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]
    );
  }

  function formatter(locale, options) {
    try {
      return new Intl.DateTimeFormat(locale || undefined, options);
    } catch (_error) {
      return new Intl.DateTimeFormat(undefined, options);
    }
  }

  function formatDate(value, locale) {
    if (!value) return '—';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? '—' : formatter(locale, { dateStyle: 'long' }).format(date);
  }

  function formatDateTime(value, locale) {
    if (!value) return '—';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? '—' : formatter(locale, { dateStyle: 'medium', timeStyle: 'medium' }).format(date);
  }

  /** The last four characters stay; the rest become dots. */
  function mask(value) {
    const text = String(value || '');
    if (text.length <= 4) return '•'.repeat(text.length);
    return `${'•'.repeat(Math.min(text.length - 4, 8))}${text.slice(-4)}`;
  }

  function fill(template, values) {
    return String(template).replace(/\{(\w+)\}/g, (match, key) => (key in values ? values[key] : match));
  }

  /* ---------------------------------------------------------------- render */

  function prizeCell(entry, settings, certificate) {
    const prize = settings.prizes.items[entry.prizeNumber - 1];
    const label = prize ? prize.label : `${settings.copy.prizeLabel} ${entry.prizeNumber}`;
    const name = certificate.showPrizes && prize ? `<small>${escapeHtml(prize.name)}</small>` : '';
    // NEW: the sponsor behind the prize, when the organiser wants it on record.
    const sponsors = settings.sponsors;
    const sponsorId = sponsors && sponsors.enabled && sponsors.display.certificate && prize ? sponsors.prizeSponsors[prize.id] : null;
    const sponsor = sponsorId ? sponsors.items.find((item) => item.id === sponsorId) : null;
    const credit = sponsor ? `<small>${escapeHtml(sponsors.label)} ${escapeHtml(sponsor.name)}</small>` : '';
    return `<td class="rank">${escapeHtml(label)}${name}${credit}</td>`;
  }

  function fieldCells(entry, settings, certificate) {
    return certificate.fields
      .map((key) => {
        const field = settings.data.fields.find((candidate) => candidate.key === key);
        const raw = (entry.record || {})[key];
        const value = certificate.maskSensitive && field && field.sensitive ? mask(raw) : raw;
        return `<td>${escapeHtml(value) || '—'}</td>`;
      })
      .join('');
  }

  function table(entries, settings, certificate, { absent = false } = {}) {
    const labels = certificate.fields.map((key) => {
      const field = settings.data.fields.find((candidate) => candidate.key === key);
      return `<th>${escapeHtml(field ? field.label : key)}</th>`;
    });
    const head = `<tr><th>${escapeHtml(settings.copy.prizeLabel)}</th>${labels.join('')}${
      certificate.showTimestamps ? '<th>Drawn</th>' : ''
    }${absent ? '<th>Marked not present</th>' : ''}</tr>`;

    const rows = entries
      .map(
        (entry) => `
        <tr${absent ? ' class="absent"' : ''}>
          ${prizeCell(entry, settings, certificate)}
          ${fieldCells(entry, settings, certificate)}
          ${certificate.showTimestamps ? `<td>${escapeHtml(formatDateTime(entry.drawnAt, settings.locale))}</td>` : ''}
          ${absent ? `<td>${escapeHtml(formatDateTime(entry.absentAt, settings.locale))}</td>` : ''}
        </tr>`
      )
      .join('');

    return `<table><thead>${head}</thead><tbody>${rows}</tbody></table>`;
  }

  function render() {
    if (!data) return;
    const settings = data.appSettings;
    const certificate = { ...settings.certificate, ...(draft || {}) };
    const locale = settings.locale;

    document.documentElement.lang = locale || 'en';
    document.documentElement.dir = settings.direction || 'ltr';
    document.title = `${certificate.title} — ${settings.eventName}`;

    // A board's accent is chosen for a dark screen and is often too light to
    // read on paper, so the page keeps its own unless one is set for it.
    const accent = certificate.accentColor || DEFAULT_ACCENT;
    document.documentElement.style.setProperty('--accent', accent);
    setPage(certificate);

    const winners = [...data.winners].sort((a, b) => a.prizeNumber - b.prizeNumber);
    const absent = [...data.absent].sort((a, b) => a.drawIndex - b.drawIndex);
    const entries = data.poolSize !== null && data.poolSize !== undefined ? data.poolSize : data.stats.totalTickets;
    const values = {
      event: escapeHtml(settings.eventName),
      organization: escapeHtml(settings.organizationName || settings.eventName),
      date: escapeHtml(formatDate(data.startedAt || data.generatedAt, locale)),
      venue: escapeHtml(certificate.venue || ''),
      winners: escapeHtml(String(winners.length)),
      entries: escapeHtml(String(entries)),
      prizes: escapeHtml(String(settings.totalPrizes)),
    };

    const logo =
      certificate.showLogo && settings.branding.logo.src
        ? `<img src="/${escapeHtml(settings.branding.logo.src)}" alt="">`
        : '';
    const listChanged =
      data.poolFingerprint && data.currentPoolFingerprint && data.poolFingerprint !== data.currentPoolFingerprint;

    const meta = [
      ['Certificate no.', data.reference],
      ['Date of draw', formatDate(data.startedAt, locale)],
      certificate.venue ? ['Venue', certificate.venue] : null,
      certificate.showEntryCount ? ['Eligible entries', entries] : null,
      ['Winners drawn', `${winners.length} of ${settings.totalPrizes}`],
      ['Issued', formatDateTime(data.generatedAt, locale)],
    ].filter(Boolean);

    mount.innerHTML = `
      <article class="sheet" data-paper="${escapeHtml(certificate.paper)}" data-orientation="${escapeHtml(certificate.orientation)}">
        <header class="head">
          ${logo}
          ${certificate.showOrganization && settings.organizationName ? `<p class="organisation">${escapeHtml(settings.organizationName)}</p>` : ''}
          <h1>${escapeHtml(certificate.title)}</h1>
          ${certificate.subtitle ? `<p class="subtitle">${escapeHtml(certificate.subtitle)} · ${escapeHtml(settings.eventName)}</p>` : `<p class="subtitle">${escapeHtml(settings.eventName)}</p>`}
        </header>

        <dl class="meta">
          ${meta.map(([label, value]) => `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`).join('')}
        </dl>

        <p class="statement">${fill(escapeHtml(certificate.statement), values)}</p>

        <h2>Winners</h2>
        ${winners.length > 0 ? table(winners, settings, certificate) : '<p class="empty">No winners have been drawn yet.</p>'}

        ${certificate.showAbsent && absent.length > 0 ? `<h2>Not present — prize drawn again</h2>${table(absent, settings, certificate, { absent: true })}` : ''}

        ${certificate.showMethod ? `<h2>Method</h2><p class="method">${escapeHtml(certificate.methodText)}</p>` : ''}

        ${
          certificate.showFingerprint
            ? `<h2>Verification</h2>
               <div class="hashes">
                 <div>Entry list (SHA-256, recorded at the first draw)<code>${escapeHtml(data.poolFingerprint || 'Recorded when the first winner is drawn.')}</code>
                   ${listChanged ? '<span class="warning">The entry list has changed since the draw began.</span>' : ''}</div>
                 <div>Results (SHA-256)<code>${escapeHtml(data.resultsFingerprint)}</code></div>
               </div>`
            : ''
        }

        ${
          certificate.signatories.length > 0
            ? `<section class="signatures">${certificate.signatories
                .map(
                  (person) => `
                  <div class="signature"><span class="signature-line"></span><p><strong>${escapeHtml(person.name) || '&nbsp;'}</strong>${escapeHtml(person.role)}</p></div>`
                )
                .join('')}</section>`
            : ''
        }

        ${certificate.footerNote ? `<p class="footnote">${escapeHtml(certificate.footerNote)}</p>` : ''}
      </article>`;
  }

  /** The printed page size, which only a stylesheet can set. */
  function setPage(certificate) {
    let style = document.getElementById('pageSize');
    if (!style) {
      style = document.createElement('style');
      style.id = 'pageSize';
      document.head.appendChild(style);
    }
    style.textContent = `@page { size: ${certificate.paper} ${certificate.orientation}; margin: 10mm; }`;
  }

  function showNotice(html) {
    mount.innerHTML = `<p class="notice">${html}</p>`;
  }

  /* ----------------------------------------------------------------- load */

  async function load() {
    try {
      const response = await fetch('/api/admin/certificate', { credentials: 'same-origin', headers: { Accept: 'application/json' } });
      if (response.status === 401) {
        showNotice('Sign in on the <a href="/admin">organiser console</a> to see the certificate.');
        return;
      }
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || `Request failed (${response.status})`);
      data = payload;
      if (!data.appSettings.certificate.enabled && !isPreview) {
        showNotice('The certificate is switched off. Turn it on under <a href="/admin">Certificate</a> in the console.');
        return;
      }
      render();
    } catch (error) {
      showNotice(escapeHtml(error.message || 'The certificate could not be loaded.'));
    }
  }

  document.getElementById('printBtn').addEventListener('click', () => global.print());
  document.getElementById('refreshBtn').addEventListener('click', load);

  if (isPreview) {
    document.body.classList.add('is-preview');
    // Only the console on this same site may send a draft.
    global.addEventListener('message', (event) => {
      if (event.origin !== global.location.origin) return;
      const message = event.data || {};
      if (message.type === 'pickora-certificate-draft') {
        draft = message.certificate || null;
        render();
      }
      if (message.type === 'pickora-certificate-reload') load();
    });
  }

  load();
})(window, document);

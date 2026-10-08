/**
 * Sponsors on the public screens: the "Sponsored by" line beside a prize, and
 * a strip of every sponsor's logo along an edge of the screen.
 *
 * What appears, where, how large and how fast all comes from the organiser's
 * sponsor settings; this file only draws it.
 */
(function sponsorsModule(global, document) {
  'use strict';

  function escapeHtml(value) {
    return String(value === null || value === undefined ? '' : value).replace(
      /[&<>"']/g,
      (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]
    );
  }

  /** The sponsor behind a prize, when sponsors are on and one is assigned. */
  function sponsorFor(settings, prize) {
    const sponsors = settings && settings.sponsors;
    if (!sponsors || !sponsors.enabled || !prize) return null;
    const id = sponsors.prizeSponsors[prize.id];
    return id ? sponsors.items.find((sponsor) => sponsor.id === id) || null : null;
  }

  /**
   * The "Sponsored by" line for a prize, as markup — or '' when there is no
   * sponsor, or the organiser does not show sponsors at `place`
   * ('announcement', 'winnerCard' or 'prizeScreen').
   */
  function badge(settings, prize, place) {
    const sponsor = sponsorFor(settings, prize);
    if (!sponsor || !settings.sponsors.display[place]) return '';
    const { display, label } = settings.sponsors;

    const logo = sponsor.logo.src
      ? `<img class="sponsor-logo" src="${escapeHtml(sponsor.logo.src)}" alt="${escapeHtml(sponsor.name)}"
          ${sponsor.logo.width && sponsor.logo.height ? `width="${sponsor.logo.width}" height="${sponsor.logo.height}"` : ''}>`
      : '';
    // With no logo the name is the sponsor, whatever the setting says.
    const name = display.showName || !logo ? `<span class="sponsor-name">${escapeHtml(sponsor.name)}</span>` : '';
    const tagline = display.showTagline && sponsor.tagline ? `<span class="sponsor-tagline">${escapeHtml(sponsor.tagline)}</span>` : '';

    return `
      <p class="sponsor-badge" data-size="${escapeHtml(display.logoSize)}" data-place="${escapeHtml(place)}">
        <span class="sponsor-label">${escapeHtml(label)}</span>
        ${logo}${name}${tagline}
      </p>`;
  }

  /* --------------------------------------------------------------- the strip */

  let strip = null;
  let rotation = null;
  let observer = null;
  // What the strip on screen was built from. The settings are re-read every
  // few seconds; the strip is rebuilt only when they actually change, or it
  // would jump back to its first logo each time.
  let builtFrom = '';

  function teardown() {
    global.clearInterval(rotation);
    rotation = null;
    if (observer) observer.disconnect();
    observer = null;
    if (strip) strip.remove();
    strip = null;
    document.body.classList.remove('has-sponsor-strip-top', 'has-sponsor-strip-bottom');
  }

  /**
   * Shows, updates or removes the logo strip for `page`. Logos turn one step
   * every interval; a screen that asks for reduced motion gets them still.
   */
  function renderStrip(settings, page) {
    const sponsors = settings && settings.sponsors;
    const config = sponsors && sponsors.strip;
    const tiers = config ? config.tiers : [];
    const shown = sponsors
      ? sponsors.items.filter((sponsor) => sponsor.logo.src || config.showNames).filter((sponsor) => !tiers.length || tiers.includes(sponsor.tier))
      : [];

    if (!sponsors || !sponsors.enabled || !config.enabled || !config.screens[page] || shown.length === 0) {
      builtFrom = '';
      teardown();
      return;
    }

    const key = JSON.stringify([config, shown]);
    if (strip && key === builtFrom) return;
    builtFrom = key;
    teardown();
    strip = document.createElement('aside');
    strip.className = 'sponsor-strip';
    strip.dataset.position = config.position;
    strip.setAttribute('aria-label', config.heading || 'Sponsors');
    strip.style.setProperty('--sponsor-logo-height', `${config.logoHeight}px`);
    strip.style.setProperty('--sponsor-per-view', String(Math.min(config.perView, shown.length)));

    const item = (sponsor) => `
      <li class="sponsor-strip-item">
        ${sponsor.logo.src ? `<img src="${escapeHtml(sponsor.logo.src)}" alt="${escapeHtml(sponsor.name)}">` : ''}
        ${config.showNames || !sponsor.logo.src ? `<span>${escapeHtml(sponsor.name)}</span>` : ''}
      </li>`;
    // Doubled, so the strip can turn past its end without a visible jump.
    const rotates = shown.length > config.perView && !global.matchMedia('(prefers-reduced-motion: reduce)').matches;
    strip.innerHTML = `
      ${config.heading ? `<p class="sponsor-strip-heading">${escapeHtml(config.heading)}</p>` : ''}
      <div class="sponsor-strip-window"><ul class="sponsor-strip-track">${shown.map(item).join('')}${rotates ? shown.map(item).join('') : ''}</ul></div>`;
    document.body.appendChild(strip);
    document.body.classList.add(`has-sponsor-strip-${config.position}`);

    // Whatever sits on that edge — the footer, a QR block — moves clear by
    // the strip's measured height.
    if (global.ResizeObserver) {
      observer = new global.ResizeObserver(() => {
        if (strip) document.body.style.setProperty('--sponsor-strip-height', `${Math.ceil(strip.getBoundingClientRect().height)}px`);
      });
      observer.observe(strip);
    }

    if (!rotates) return;
    const track = strip.querySelector('.sponsor-strip-track');
    let step = 0;
    rotation = global.setInterval(() => {
      step += 1;
      const first = track.children[0];
      const width = first ? first.getBoundingClientRect().width : 0;
      track.style.transition = 'transform 700ms cubic-bezier(0.16, 1, 0.3, 1)';
      track.style.transform = `translateX(${-step * width}px)`;
      if (step >= shown.length) {
        // Back to the start under cover of the doubled list.
        global.setTimeout(() => {
          track.style.transition = 'none';
          track.style.transform = 'translateX(0)';
          step = 0;
        }, 720);
      }
    }, config.intervalMs);
  }

  global.pickoraSponsors = { sponsorFor, badge, renderStrip };
})(window, document);

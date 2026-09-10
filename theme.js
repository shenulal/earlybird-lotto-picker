/**
 * Applies the configured look to any Pickora page.
 *
 * The board, the welcome screen and the prize screen share one identity, so
 * the accent, backdrop, logo and wording are set from one place rather than
 * being repeated per page.
 */
(function attachTheme(global, document) {
  'use strict';

  function applyTheme(settings, elements = {}) {
    const { ui, branding } = settings;
    const root = document.documentElement;

    root.style.setProperty('--accent', ui.primaryColor);
    root.style.setProperty('--stage-backdrop', ui.backgroundColor || 'none');
    root.style.setProperty('--backdrop-image', branding.background.src ? `url('${encodeURI(branding.background.src)}')` : 'none');
    root.style.setProperty('--backdrop-fit', branding.background.fit === 'tile' ? 'auto' : branding.background.fit);
    root.style.setProperty('--backdrop-repeat', branding.background.fit === 'tile' ? 'repeat' : 'no-repeat');
    root.style.setProperty('--backdrop-overlay', String(branding.background.overlayOpacity / 100));
    root.style.setProperty('--logo-max-height', `${branding.logo.maxHeight}px`);
    /* A wide logo needs more room beside the event name than a square one, so
       the header reserves its rendered width — bounded by the same cap the
       image itself is bounded by. */
    const aspect = branding.logo.width && branding.logo.height ? branding.logo.width / branding.logo.height : 1;
    root.style.setProperty(
      '--logo-reserve',
      `min(calc(var(--logo-max-height) * ${aspect.toFixed(3)}), 38vw, 420px)`
    );

    root.lang = settings.locale || 'en';
    root.dir = settings.direction;

    const logo = elements.logo || document.getElementById('boardLogo');
    const hasLogo = Boolean(branding.logo.src) && branding.logo.position !== 'hidden';
    if (logo) {
      logo.hidden = !hasLogo;
      if (hasLogo) {
        logo.src = branding.logo.src;
        logo.alt = settings.organizationName || settings.eventName;
        document.body.dataset.logoPosition = branding.logo.position;
        // Explicit dimensions keep the logo from shifting the layout as it loads.
        if (branding.logo.width && branding.logo.height) {
          logo.width = branding.logo.width;
          logo.height = branding.logo.height;
        }
      }
    }

    const eventName = elements.eventName || document.getElementById('eventName');
    if (eventName) eventName.textContent = settings.eventName;

    const organizationName = elements.organizationName || document.getElementById('organizationName');
    if (organizationName) {
      organizationName.textContent = settings.organizationName || '';
      organizationName.hidden = !(ui.showOrganizationName && settings.organizationName);
    }

    // FIX: copy.prizesBack ("Back to the draw") was defined in every settings
    // file and rendered nowhere. The welcome and prize screens now carry a
    // back control, and this is its label.
    const backLink = document.getElementById('backToBoard');
    if (backLink) backLink.textContent = settings.copy.prizesBack;

    const footer = elements.footer || document.getElementById('boardFooter');
    if (footer) {
      footer.textContent = settings.copy.footer;
      footer.hidden = !settings.copy.footer;
    }
  }

  const SCREENS = [
    { key: 'board', href: '/', copyKey: 'boardToggle' },
    { key: 'welcome', href: '/welcome', copyKey: 'welcomeToggle' },
    { key: 'prizes', href: '/prizes', copyKey: 'prizesToggle' },
  ];

  function escapeHtml(value) {
    return String(value === null || value === undefined ? '' : value).replace(
      /[&<>"']/g,
      (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]
    );
  }

  /**
   * Whether the organiser has asked for this screen at all.
   *
   * These are the "Show the welcome screen" and "Show the prize screen"
   * switches in the console, ticked by default. Unticking one is a deliberate
   * choice about what the audience sees, so the link goes rather than dims.
   */
  function isOffered(key, settings) {
    if (key === 'welcome') return settings.welcome.enabled;
    if (key === 'prizes') return settings.prizes.enabled;
    return true;
  }

  /** True when an offered screen actually has something on it. */
  function hasContent(key, settings) {
    if (key === 'welcome') {
      return settings.welcome.images.length > 0 || Boolean(settings.welcome.message);
    }
    if (key === 'prizes') {
      return settings.prizes.items.length > 0;
    }
    return true;
  }

  /**
   * The screens the organiser has switched on, with the current one marked.
   *
   * A screen that is switched on but not filled in yet is dimmed rather than
   * dropped: the operator still needs a way in to see that there is nothing
   * there. The screen being viewed always appears, even if it was switched
   * off, so nobody who followed a link ends up with no way back.
   */
  function renderScreenNav(current, settings) {
    const mount = document.getElementById('screenNav');
    if (!mount) return;

    const visible = SCREENS.filter(
      (screen) => screen.key === current || isOffered(screen.key, settings)
    );

    mount.innerHTML = visible
      .map((screen) => {
        const label = settings.copy[screen.copyKey];
        const isCurrent = screen.key === current;
        const empty = !hasContent(screen.key, settings);

        return `<a class="screen-link" href="${screen.href}"
        ${isCurrent ? 'aria-current="page"' : ''}
        ${empty ? 'data-empty="true" title="Nothing set up for this screen yet"' : ''}
      >${escapeHtml(label)}</a>`;
      })
      .join('');

    // With only the board left there is nothing to navigate between.
    mount.hidden = visible.length < 2;
  }

  global.applyPickoraTheme = applyTheme;
  global.renderPickoraNav = renderScreenNav;
})(window, document);

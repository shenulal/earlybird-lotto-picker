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

  /** True when a screen has something to show; drives the dimmed state. */
  function hasContent(key, settings) {
    if (key === 'welcome') {
      return settings.welcome.enabled && (settings.welcome.images.length > 0 || Boolean(settings.welcome.message));
    }
    if (key === 'prizes') {
      return settings.prizes.enabled && settings.prizes.items.length > 0;
    }
    return true;
  }

  /**
   * The same three screens on every page, with the current one marked.
   *
   * A screen that is not set up yet is dimmed rather than hidden: hiding it
   * makes the feature look absent, and the operator still needs a way in to
   * see that there is nothing there.
   */
  function renderScreenNav(current, settings) {
    const mount = document.getElementById('screenNav');
    if (!mount) return;

    mount.innerHTML = SCREENS.map((screen) => {
      const label = settings.copy[screen.copyKey];
      const isCurrent = screen.key === current;
      const empty = !hasContent(screen.key, settings);

      return `<a class="screen-link" href="${screen.href}"
        ${isCurrent ? 'aria-current="page"' : ''}
        ${empty ? 'data-empty="true" title="Nothing set up for this screen yet"' : ''}
      >${escapeHtml(label)}</a>`;
    }).join('');
  }

  global.applyPickoraTheme = applyTheme;
  global.renderPickoraNav = renderScreenNav;
})(window, document);

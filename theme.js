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

  global.applyPickoraTheme = applyTheme;
})(window, document);

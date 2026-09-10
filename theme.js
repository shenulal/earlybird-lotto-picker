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

    // CHANGED: the event name is now optional. Hiding it has to take its
    // space with it, or the header keeps a gap where it used to be.
    const eventName = elements.eventName || document.getElementById('eventName');
    const showEventName = ui.showEventName !== false && Boolean(settings.eventName);
    if (eventName) {
      eventName.textContent = settings.eventName;
      eventName.hidden = !showEventName;
    }

    const organizationName = elements.organizationName || document.getElementById('organizationName');
    const showOrganization = Boolean(ui.showOrganizationName && settings.organizationName);
    if (organizationName) {
      organizationName.textContent = settings.organizationName || '';
      organizationName.hidden = !showOrganization;
    }

    // With neither line left there is nothing to lay out, so the block goes
    // rather than sitting there as an empty column.
    const identity = document.querySelector('.board-identity');
    if (identity) identity.hidden = !showEventName && !showOrganization;

    // FIX: copy.prizesBack ("Back to the draw") was defined in every settings
    // file and rendered nowhere. The welcome and prize screens now carry a
    // back control, and this is its label.
    const backLink = document.getElementById('backToBoard');
    if (backLink) backLink.textContent = settings.copy.prizesBack;

    // NEW: the organiser's channels, on whichever screen this is.
    if (global.pickoraSocial) global.pickoraSocial.render('socialBlock', settings);

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

  /* One console, however many times the link is pressed. */
  const CONSOLE_WINDOW = 'pickora-console';

  /**
   * Sends every organiser link to the same tab.
   *
   * The named target alone reuses the tab, but it also re-navigates it, which
   * would throw away whatever the organiser was part-way through typing. So
   * the tab is claimed empty first: a console already open is simply brought
   * forward untouched, and only a freshly created one is pointed at /admin.
   *
   * If the browser refuses to open a window at all, nothing is prevented and
   * the link's own named target still does the reuse.
   */
  function bindConsoleLinks() {
    document.addEventListener('click', (event) => {
      const link = event.target.closest && event.target.closest('a[data-console-link]');
      if (!link) return;
      // Leave the modified clicks alone: those are the reader asking for a new
      // tab, a new window or a background tab on purpose.
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;

      let consoleWindow = null;
      try {
        consoleWindow = global.open('', CONSOLE_WINDOW);
      } catch (_error) {
        consoleWindow = null;
      }
      if (!consoleWindow) return;

      event.preventDefault();
      try {
        // A tab that is already showing the console keeps its state.
        if (consoleWindow.location.href === 'about:blank') consoleWindow.location.href = link.href;
      } catch (_error) {
        // Reading across origins is refused; sending it to the console is safe.
        consoleWindow.location.href = link.href;
      }
      consoleWindow.focus();
    });
  }

  bindConsoleLinks();

  /* ------------------------------------------------------- NEW: the drawer */

  const DRAWER_KEY = 'pickora.drawer';

  /**
   * The screen menu, behind a toggle.
   *
   * Closed by default, because the whole point is that a projected board or a
   * prize photo is not covered by navigation nobody is using. The preference
   * is remembered per browser, so an operator who wants it open all evening
   * only says so once.
   */
  function bindDrawer() {
    const toggle = document.getElementById('menuToggle');
    const drawer = document.getElementById('boardDrawer');
    const scrim = document.getElementById('drawerScrim');
    if (!toggle || !drawer) return;

    const setOpen = (open, remember = true) => {
      // Unhide first so the panel has a box to animate from, and hide only
      // after it has left, so it never traps focus while off-screen.
      if (open) drawer.hidden = false;
      if (scrim && open) scrim.hidden = false;

      global.requestAnimationFrame(() => {
        drawer.classList.toggle('is-open', open);
        if (scrim) scrim.classList.toggle('is-open', open);
      });

      toggle.setAttribute('aria-expanded', String(open));

      if (!open) {
        const settle = () => {
          if (!drawer.classList.contains('is-open')) {
            drawer.hidden = true;
            if (scrim) scrim.hidden = true;
          }
        };
        drawer.addEventListener('transitionend', settle, { once: true });
        // A browser that skips the transition still needs the panel put away.
        global.setTimeout(settle, 400);
      }

      if (remember) {
        try {
          global.localStorage.setItem(DRAWER_KEY, open ? 'open' : 'closed');
        } catch (_error) {
          // Private browsing refuses storage; the drawer still works.
        }
      }
    };

    const isOpen = () => drawer.classList.contains('is-open');

    toggle.addEventListener('click', () => setOpen(!isOpen()));
    if (scrim) scrim.addEventListener('click', () => setOpen(false));

    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && isOpen()) {
        setOpen(false);
        toggle.focus();
        return;
      }
      // A shortcut of its own, kept clear of the board's existing keys.
      if (event.key && event.key.toLowerCase() === 'm' && !event.metaKey && !event.ctrlKey && !event.altKey) {
        if (/^(INPUT|TEXTAREA|SELECT)$/.test(event.target.tagName)) return;
        setOpen(!isOpen());
      }
    });

    // Following a link out of the drawer should not leave it open behind you.
    drawer.addEventListener('click', (event) => {
      if (event.target.closest('a')) setOpen(false);
    });

    let remembered = null;
    try {
      remembered = global.localStorage.getItem(DRAWER_KEY);
    } catch (_error) {
      remembered = null;
    }
    if (remembered === 'open') setOpen(true, false);
  }

  document.addEventListener('DOMContentLoaded', bindDrawer);

  global.applyPickoraTheme = applyTheme;
  global.renderPickoraNav = renderScreenNav;
})(window, document);

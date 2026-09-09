/**
 * Guest welcome carousel.
 *
 * Greets a special guest with a message and a rotating set of portraits. The
 * rotation interval, the photos, the wording and the placement all come from
 * configuration; this module only plays what it is given.
 */
(function attachWelcome(global, document) {
  'use strict';

  function escapeHtml(value) {
    return String(value === null || value === undefined ? '' : value).replace(
      /[&<>"']/g,
      (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]
    );
  }

  function createWelcome(elements, options = {}) {
    const state = { config: null, index: 0, timerId: null, isOpen: false };
    const prefersReducedMotion = global.matchMedia('(prefers-reduced-motion: reduce)');

    function slides() {
      return Array.from(elements.track.querySelectorAll('.welcome-slide'));
    }

    function paint() {
      const images = state.config.images;
      if (images.length === 0) return;

      slides().forEach((slide, position) => slide.classList.toggle('is-active', position === state.index));
      Array.from(elements.dots.children).forEach((dot, position) => {
        const isActive = position === state.index;
        dot.classList.toggle('is-active', isActive);
        dot.setAttribute('aria-selected', String(isActive));
      });

      const caption = images[state.index].caption;
      elements.caption.textContent = state.config.showCaptions ? caption : '';
    }

    function goTo(index) {
      const count = state.config.images.length;
      if (count === 0) return;
      state.index = ((index % count) + count) % count;
      paint();
    }

    function next() {
      goTo(state.index + 1);
    }

    function stopRotation() {
      if (state.timerId) {
        clearInterval(state.timerId);
        state.timerId = null;
      }
    }

    /** Restarts the timer so a manual step gives a full interval to read. */
    function startRotation() {
      stopRotation();
      if (!state.isOpen || state.config.images.length < 2) return;
      state.timerId = setInterval(next, state.config.intervalMs);
    }

    function render(config) {
      state.config = config;
      state.index = 0;

      elements.title.textContent = config.title;
      elements.title.hidden = !config.title;
      elements.message.textContent = config.message;
      elements.message.hidden = !config.message;

      elements.track.innerHTML = config.images
        .map(
          (image, position) => `
          <li class="welcome-slide${position === 0 ? ' is-active' : ''}">
            <img src="${escapeHtml(image.src)}" alt="${escapeHtml(image.caption) || 'Guest photo'}"
              ${image.width && image.height ? `width="${image.width}" height="${image.height}"` : ''}
              ${position === 0 ? 'fetchpriority="high"' : 'loading="lazy"'}>
          </li>`
        )
        .join('');

      elements.dots.innerHTML = config.images
        .map(
          (image, position) =>
            `<button type="button" class="welcome-dot${position === 0 ? ' is-active' : ''}" role="tab" aria-selected="${position === 0}" aria-label="Photo ${position + 1}"></button>`
        )
        .join('');

      const hasCarousel = config.images.length > 1;
      elements.figure.hidden = config.images.length === 0;
      elements.prev.hidden = !hasCarousel;
      elements.next.hidden = !hasCarousel;
      elements.dots.hidden = !hasCarousel;

      paint();
    }

    function open() {
      if (!state.config || !state.config.enabled) return;
      state.isOpen = true;
      elements.panel.hidden = false;
      elements.toggle.setAttribute('aria-expanded', 'true');
      startRotation();
    }

    function close() {
      state.isOpen = false;
      elements.panel.hidden = true;
      elements.toggle.setAttribute('aria-expanded', 'false');
      stopRotation();
    }

    function toggle() {
      if (state.isOpen) close();
      else open();
    }

    function step(delta) {
      goTo(state.index + delta);
      startRotation();
    }

    elements.close.addEventListener('click', close);
    elements.prev.addEventListener('click', () => step(-1));
    elements.next.addEventListener('click', () => step(1));
    elements.toggle.addEventListener('click', toggle);

    elements.dots.addEventListener('click', (event) => {
      const dot = event.target.closest('.welcome-dot');
      if (!dot) return;
      goTo(Array.from(elements.dots.children).indexOf(dot));
      startRotation();
    });

    // Clicking the scrim dismisses an overlay, but never a docked panel.
    elements.panel.addEventListener('click', (event) => {
      if (event.target === elements.panel && state.config.placement === 'overlay') close();
    });

    prefersReducedMotion.addEventListener('change', () => {
      if (prefersReducedMotion.matches) stopRotation();
      else startRotation();
    });

    return {
      apply(config) {
        const wasOpen = state.isOpen;
        render(config);

        elements.toggle.hidden = !config.enabled || config.images.length === 0 && !config.message;
        document.body.dataset.welcome = config.placement;

        if (!config.enabled) {
          close();
          return;
        }
        if (wasOpen || (config.showOnLoad && options.autoOpen !== false)) open();
      },
      open,
      close,
      toggle,
      isOpen: () => state.isOpen,
    };
  }

  global.createWelcome = createWelcome;
})(window, document);

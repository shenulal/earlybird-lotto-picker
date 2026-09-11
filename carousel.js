/**
 * Image carousel shared by the welcome screen and the prize pages.
 *
 * Slides are stacked and cross-faded, so only opacity animates and the
 * transition stays on the compositor. The rotation interval, the photos and
 * the captions all come from configuration.
 */
(function attachCarousel(global, document) {
  'use strict';

  function escapeHtml(value) {
    return String(value === null || value === undefined ? '' : value).replace(
      /[&<>"']/g,
      (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]
    );
  }

  /**
   * Renders a carousel into `mount` and returns a handle that owns its timer.
   * `options.intervalMs` of 0, or a single image, leaves it static.
   */
  function createCarousel(mount, images, options = {}) {
    const prefersReducedMotion = global.matchMedia('(prefers-reduced-motion: reduce)');
    const showCaptions = options.showCaptions !== false;
    // NEW: the welcome screen shows its photographs and nothing else, so the
    // arrows are optional. The dots stay: they say how many there are.
    const showArrows = options.showArrows !== false;
    const interval = Number(options.intervalMs) || 0;

    let index = 0;
    let timerId = null;

    if (!images || images.length === 0) {
      mount.innerHTML = '';
      mount.hidden = true;
      return { destroy() {}, isEmpty: true };
    }

    mount.hidden = false;
    mount.innerHTML = `
      <div class="carousel" data-count="${images.length}">
        <ol class="carousel-track">
          ${images
            .map(
              (image, position) => `
              <li class="carousel-slide${position === 0 ? ' is-active' : ''}">
                <img src="${escapeHtml(image.src)}" alt="${escapeHtml(image.caption) || escapeHtml(options.altFallback || '')}"
                  ${image.width && image.height ? `width="${image.width}" height="${image.height}"` : ''}
                  ${position === 0 ? 'fetchpriority="high"' : 'loading="lazy"'}>
              </li>`
            )
            .join('')}
        </ol>
        ${images.length > 1 ? `
          ${showArrows ? `
            <button type="button" class="carousel-nav carousel-prev" aria-label="Previous photo">&#8249;</button>
            <button type="button" class="carousel-nav carousel-next" aria-label="Next photo">&#8250;</button>` : ''}
          <div class="carousel-dots" role="tablist" aria-label="Choose a photo">
            ${images.map((_, position) => `<button type="button" class="carousel-dot${position === 0 ? ' is-active' : ''}" role="tab" aria-selected="${position === 0}" aria-label="Photo ${position + 1}"></button>`).join('')}
          </div>` : ''}
      </div>
      ${showCaptions ? '<p class="carousel-caption"></p>' : ''}`;

    const root = mount.querySelector('.carousel');
    const slides = Array.from(root.querySelectorAll('.carousel-slide'));
    const dots = Array.from(root.querySelectorAll('.carousel-dot'));
    const caption = mount.querySelector('.carousel-caption');

    function paint() {
      slides.forEach((slide, position) => slide.classList.toggle('is-active', position === index));
      dots.forEach((dot, position) => {
        dot.classList.toggle('is-active', position === index);
        dot.setAttribute('aria-selected', String(position === index));
      });
      if (caption) caption.textContent = images[index].caption || '';
    }

    function goTo(next) {
      index = ((next % images.length) + images.length) % images.length;
      paint();
    }

    function stop() {
      if (timerId) {
        clearInterval(timerId);
        timerId = null;
      }
    }

    /** Restarted on a manual step, so each photo gets a full interval to read. */
    function start() {
      stop();
      if (images.length < 2 || interval <= 0 || prefersReducedMotion.matches) return;
      timerId = setInterval(() => goTo(index + 1), interval);
    }

    root.addEventListener('click', (event) => {
      if (event.target.closest('.carousel-prev')) {
        goTo(index - 1);
        start();
      } else if (event.target.closest('.carousel-next')) {
        goTo(index + 1);
        start();
      } else {
        const dot = event.target.closest('.carousel-dot');
        if (dot) {
          goTo(dots.indexOf(dot));
          start();
        }
      }
    });

    // A carousel nobody can see should not keep waking the page.
    const visibility = () => (document.hidden ? stop() : start());
    document.addEventListener('visibilitychange', visibility);

    paint();
    start();

    return {
      isEmpty: false,
      goTo,
      start,
      stop,
      destroy() {
        stop();
        document.removeEventListener('visibilitychange', visibility);
      },
    };
  }

  global.createCarousel = createCarousel;
})(window, document);

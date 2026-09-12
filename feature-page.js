/**
 * The welcome and prize screens.
 *
 * Both are ordinary pages rather than overlays on the draw board, so they can
 * be opened on a second screen, linked to, or projected on their own. They
 * share this controller because they differ only in what they render.
 */
(function featurePage(global, document) {
  'use strict';

  const api = global.lotteryApi;
  const page = global.PICKORA_PAGE;

  function escapeHtml(value) {
    return String(value === null || value === undefined ? '' : value).replace(
      /[&<>"']/g,
      (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]
    );
  }

  const carousels = [];

  function renderWelcome(settings) {
    const { welcome } = settings;
    const card = document.getElementById('welcomeCard');
    const empty = document.getElementById('welcomeEmpty');

    if (!welcome.enabled || (welcome.images.length === 0 && !welcome.message)) {
      card.hidden = true;
      empty.hidden = false;
      return;
    }

    // CHANGED: a small label above the heading, in the organiser's own word for
    // this screen. It gives the title something to sit against rather than
    // starting the page cold.
    const eyebrow = document.getElementById('welcomeEyebrow');
    const label = settings.copy.welcomeToggle;
    eyebrow.textContent = label;
    eyebrow.hidden = !label;

    document.getElementById('featureHeading').textContent = welcome.title;
    document.getElementById('featureHeading').hidden = !welcome.title;

    const message = document.getElementById('welcomeMessage');
    message.textContent = welcome.message;
    message.hidden = !welcome.message;

    // NEW: the frame the photographs are cut to, and where they sit against
    // the words. Moving the element rather than reordering it with CSS keeps
    // the reading order and the visual order the same thing, which is what a
    // screen reader and a projector both need.
    const media = document.getElementById('welcomeMedia');
    placeCarousel(media, welcome.carousel, {
      container: card,
      text: document.querySelector('.welcome-intro'),
      centreBefore: document.getElementById('welcomeMessage'),
    });

    carousels.push(
      global.createCarousel(media, welcome.images, {
        intervalMs: welcome.intervalMs,
        showCaptions: welcome.showCaptions,
        altFallback: welcome.title,
        // CHANGED: nothing is laid over the photographs here. The dots sit
        // below the frame, and the carousel advances on its own.
        showArrows: false,
      })
    );

    // With no photo the message takes the full width rather than leaving a
    // gap where the carousel would have been.
    card.classList.toggle('is-textonly', welcome.images.length === 0);
  }

  /**
   * NEW: puts one carousel where the organiser asked for it.
   *
   * Top and bottom are the two ends of the block it shares with the text.
   * Centre drops it into the middle of that text, before whichever element is
   * named. Left and right leave it a sibling and hand the arrangement to CSS,
   * which is the only one of the five that has to change again on a phone.
   */
  function placeCarousel(media, carousel, where) {
    const { container, text, centreBefore } = where;
    const placement = (carousel && carousel.placement) || 'top';

    container.dataset.carouselPlacement = placement;
    media.dataset.shape = (carousel && carousel.shape) || 'rectangle';
    media.dataset.aspect = (carousel && carousel.aspect) || 'standard';
    media.style.setProperty('--carousel-radius', `${(carousel && carousel.radius) || 0}px`);

    if (placement === 'center' && centreBefore && centreBefore.parentElement) {
      centreBefore.parentElement.insertBefore(media, centreBefore);
      return;
    }

    if (placement === 'bottom') container.appendChild(media);
    else container.insertBefore(media, text);
  }

  function renderPrizes(settings) {
    const { prizes } = settings;
    const list = document.getElementById('prizeList');
    const empty = document.getElementById('prizesEmpty');

    document.title = prizes.heading;
    document.getElementById('featureHeading').textContent = prizes.heading;

    const intro = document.getElementById('prizesIntro');
    intro.textContent = prizes.intro;
    intro.hidden = !prizes.intro;

    if (!prizes.enabled || prizes.items.length === 0) {
      list.hidden = true;
      empty.hidden = false;
      return;
    }

    list.innerHTML = prizes.items
      .map(
        (prize, index) => `
        <li class="prize" data-rank="${index + 1}">
          <div class="prize-media" id="prize-media-${escapeHtml(prize.id)}"></div>
          <div class="prize-body">
            <p class="prize-label"><span class="prize-rank">${index + 1}</span>${escapeHtml(prize.label)}</p>
            <h3 class="prize-name">${escapeHtml(prize.name)}</h3>
            ${prize.description ? `<p class="prize-description">${escapeHtml(prize.description)}</p>` : ''}
          </div>
        </li>`
      )
      .join('');

    prizes.items.forEach((prize) => {
      const mount = document.getElementById(`prize-media-${prize.id}`);
      if (!mount) return;

      const card = mount.closest('.prize');
      if (prize.images.length === 0) card.classList.add('is-textonly');

      // NEW: the same frame and placement question as the welcome screen, asked
      // once per card. Centre means between the prize's name and what it is.
      placeCarousel(mount, prizes.carousel, {
        container: card,
        text: card.querySelector('.prize-body'),
        centreBefore: card.querySelector('.prize-description'),
      });

      carousels.push(
        global.createCarousel(mount, prize.images, {
          intervalMs: prizes.intervalMs,
          showCaptions: prizes.showCaptions,
          altFallback: prize.name,
        })
      );
    });
  }

  async function init() {
    try {
      const { appSettings } = await api.getSettings();
      global.applyPickoraTheme(appSettings);
      global.renderPickoraNav(page, appSettings);

      if (page === 'welcome') renderWelcome(appSettings);
      else renderPrizes(appSettings);
    } catch (error) {
      const empty = document.getElementById(page === 'welcome' ? 'welcomeEmpty' : 'prizesEmpty');
      if (empty) {
        empty.textContent = error.message;
        empty.hidden = false;
      }
    }
  }

  global.addEventListener('pagehide', () => carousels.forEach((carousel) => carousel.destroy()));
  document.addEventListener('DOMContentLoaded', init);
})(window, document);

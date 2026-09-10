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

    document.getElementById('featureHeading').textContent = welcome.title;
    document.getElementById('featureHeading').hidden = !welcome.title;

    const message = document.getElementById('welcomeMessage');
    message.textContent = welcome.message;
    message.hidden = !welcome.message;

    carousels.push(
      global.createCarousel(document.getElementById('welcomeMedia'), welcome.images, {
        intervalMs: welcome.intervalMs,
        showCaptions: welcome.showCaptions,
        altFallback: welcome.title,
      })
    );

    // With no photo the message should use the full width rather than leaving
    // an empty column beside it.
    card.classList.toggle('is-textonly', welcome.images.length === 0);
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
      if (prize.images.length === 0) mount.closest('.prize').classList.add('is-textonly');
      carousels.push(
        global.createCarousel(mount, prize.images, {
          intervalMs: prizes.intervalMs,
          showCaptions: prizes.showCaptions,
          altFallback: prize.name,
        })
      );
    });
  }

  /** Each screen links to the other only when there is something to see. */
  function renderCrossLinks(settings) {
    const welcomeLink = document.getElementById('welcomeLink');
    const prizesLink = document.getElementById('prizesLink');
    const back = document.getElementById('backLabel');

    if (back) back.textContent = settings.copy.prizesBack;

    if (welcomeLink) {
      welcomeLink.hidden = !(settings.welcome.enabled && (settings.welcome.images.length > 0 || settings.welcome.message));
      welcomeLink.querySelector('.tool-label').textContent = settings.copy.welcomeToggle;
    }
    if (prizesLink) {
      prizesLink.hidden = !(settings.prizes.enabled && settings.prizes.items.length > 0);
      prizesLink.querySelector('.tool-label').textContent = settings.copy.prizesToggle;
    }
  }

  async function init() {
    try {
      const { appSettings } = await api.getSettings();
      global.applyPickoraTheme(appSettings);
      renderCrossLinks(appSettings);

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

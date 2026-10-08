/**
 * Console: the Sponsors panel.
 *
 * The sponsor list (name, tier, link, tagline, logo), which sponsor stands
 * behind which prize, where sponsors are credited, and the logo strip.
 */
(function sponsorsPanel(global, document) {
  'use strict';

  const features = global.PickoraConsoleFeatures;
  if (!features) return;

  const MAX_SPONSORS = 30;
  const LOGO_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/svg+xml'];

  features.register(function createSponsorsPanel(context, helpers) {
    const api = global.lotteryApi;
    const { escapeHtml, readAsDataUrl, numberFrom, busy } = helpers;
    const $ = (id) => document.getElementById(id);

    const elements = {
      enabled: $('sponsorsEnabled'),
      label: $('sponsorLabel'),
      logoSize: $('sponsorLogoSize'),
      count: $('sponsorCountPill'),
      add: $('addSponsorBtn'),
      editor: $('sponsorEditor'),
      prizeBody: $('prizeSponsorBody'),
      save: $('saveSponsorsBtn'),
      revert: $('revertSponsorsBtn'),
    };

    const DISPLAY = {
      announcement: 'sponsorShowAnnouncement',
      winnerCard: 'sponsorShowWinnerCard',
      prizeScreen: 'sponsorShowPrizeScreen',
      certificate: 'sponsorShowCertificate',
      export: 'sponsorShowExport',
      showName: 'sponsorShowName',
      showTagline: 'sponsorShowTagline',
    };

    function sponsors() {
      return context.getSettings().sponsors;
    }

    /* --------------------------------------------------------------- render */

    function sponsorRow(sponsor, index, total) {
      const logo = sponsor.logo.src
        ? `<img src="/${escapeHtml(sponsor.logo.src)}" alt="">`
        : '<span class="sponsor-logo-empty">No logo</span>';
      return `
        <div class="sponsor-row" data-id="${escapeHtml(sponsor.id)}">
          <div class="sponsor-logo-box">${logo}</div>
          <label class="field"><span class="field-label">Name</span>
            <input type="text" class="sponsor-name" maxlength="80" value="${escapeHtml(sponsor.name)}" placeholder="Company name"></label>
          <label class="field"><span class="field-label">Tier</span>
            <input type="text" class="sponsor-tier" maxlength="40" value="${escapeHtml(sponsor.tier)}" placeholder="Title, Gold, Partner…"></label>
          <label class="field"><span class="field-label">Website</span>
            <input type="url" class="sponsor-url" maxlength="500" value="${escapeHtml(sponsor.url)}" placeholder="https://" spellcheck="false"></label>
          <label class="field sponsor-tagline-field"><span class="field-label">Tagline</span>
            <input type="text" class="sponsor-tagline" maxlength="140" value="${escapeHtml(sponsor.tagline)}" placeholder="Optional"></label>
          <div class="sponsor-actions">
            <label class="btn btn-ghost btn-small" for="sponsorLogo-${escapeHtml(sponsor.id)}">${sponsor.logo.src ? 'Replace logo' : 'Upload logo'}</label>
            <input type="file" id="sponsorLogo-${escapeHtml(sponsor.id)}" class="sr-only sponsor-logo-input" accept="image/png,image/jpeg,image/gif,image/webp,image/svg+xml">
            ${sponsor.logo.src ? '<button type="button" class="btn btn-ghost btn-small sponsor-logo-remove">Remove logo</button>' : ''}
            <button type="button" class="btn btn-ghost btn-small sponsor-move" data-direction="-1" ${index === 0 ? 'disabled' : ''} aria-label="Move up">↑</button>
            <button type="button" class="btn btn-ghost btn-small sponsor-move" data-direction="1" ${index === total - 1 ? 'disabled' : ''} aria-label="Move down">↓</button>
            <button type="button" class="btn btn-danger btn-small sponsor-remove">Remove</button>
          </div>
        </div>`;
    }

    function renderList(list) {
      elements.count.textContent = `${list.length} sponsor${list.length === 1 ? '' : 's'}`;
      elements.add.disabled = list.length >= MAX_SPONSORS;
      elements.editor.innerHTML = list.length
        ? list.map((sponsor, index) => sponsorRow(sponsor, index, list.length)).join('')
        : '<p class="slot-empty">No sponsors yet. Add the first one above.</p>';
    }

    function renderAssignments(settings) {
      const { items } = settings.prizes;
      const list = settings.sponsors.items;
      if (items.length === 0) {
        elements.prizeBody.innerHTML = '<tr class="table-empty"><td colspan="2">No prizes yet — add them under Prizes.</td></tr>';
        return;
      }
      elements.prizeBody.innerHTML = items
        .map((prize) => {
          const chosen = settings.sponsors.prizeSponsors[prize.id] || '';
          return `
            <tr>
              <td><strong>${escapeHtml(prize.label)}</strong> — ${escapeHtml(prize.name)}</td>
              <td>
                <select class="prize-sponsor" data-prize="${escapeHtml(prize.id)}">
                  <option value="">No sponsor</option>
                  ${list.map((sponsor) => `<option value="${escapeHtml(sponsor.id)}"${sponsor.id === chosen ? ' selected' : ''}>${escapeHtml(sponsor.name)}</option>`).join('')}
                </select>
              </td>
            </tr>`;
        })
        .join('');
    }

    function render() {
      const settings = context.getSettings();
      const current = settings.sponsors;
      elements.enabled.checked = current.enabled;
      elements.label.value = current.label;
      elements.logoSize.value = current.display.logoSize;
      Object.entries(DISPLAY).forEach(([key, id]) => {
        $(id).checked = Boolean(current.display[key]);
      });

      const { strip } = current;
      $('stripEnabled').checked = strip.enabled;
      $('stripShowNames').checked = strip.showNames;
      $('stripHeading').value = strip.heading;
      $('stripPosition').value = strip.position;
      $('stripLogoHeight').value = strip.logoHeight;
      $('stripPerView').value = strip.perView;
      $('stripInterval').value = strip.intervalMs;
      $('stripTiers').value = strip.tiers.join(', ');
      $('stripOnBoard').checked = strip.screens.board;
      $('stripOnWelcome').checked = strip.screens.welcome;
      $('stripOnPrizes').checked = strip.screens.prizes;

      renderList(current.items);
      renderAssignments(settings);
    }

    /* -------------------------------------------------------------- collect */

    function readList() {
      const saved = sponsors().items;
      return Array.from(elements.editor.querySelectorAll('.sponsor-row')).map((row) => {
        const previous = saved.find((sponsor) => sponsor.id === row.dataset.id);
        return {
          id: row.dataset.id,
          name: row.querySelector('.sponsor-name').value.trim(),
          tier: row.querySelector('.sponsor-tier').value.trim(),
          url: row.querySelector('.sponsor-url').value.trim(),
          tagline: row.querySelector('.sponsor-tagline').value.trim(),
          logo: previous ? previous.logo : { src: '', width: null, height: null },
        };
      });
    }

    function collect() {
      const current = sponsors();
      const prizeSponsors = Array.from(elements.prizeBody.querySelectorAll('.prize-sponsor')).reduce(
        (map, select) => (select.value ? { ...map, [select.dataset.prize]: select.value } : map),
        {}
      );
      return {
        ...current,
        enabled: elements.enabled.checked,
        label: elements.label.value.trim(),
        items: readList(),
        prizeSponsors,
        display: {
          ...Object.fromEntries(Object.entries(DISPLAY).map(([key, id]) => [key, $(id).checked])),
          logoSize: elements.logoSize.value,
        },
        strip: {
          ...current.strip,
          enabled: $('stripEnabled').checked,
          showNames: $('stripShowNames').checked,
          heading: $('stripHeading').value.trim(),
          position: $('stripPosition').value,
          logoHeight: numberFrom($('stripLogoHeight'), current.strip.logoHeight),
          perView: numberFrom($('stripPerView'), current.strip.perView),
          intervalMs: numberFrom($('stripInterval'), current.strip.intervalMs),
          tiers: $('stripTiers').value.split(',').map((tier) => tier.trim()).filter(Boolean),
          screens: { board: $('stripOnBoard').checked, welcome: $('stripOnWelcome').checked, prizes: $('stripOnPrizes').checked },
        },
      };
    }

    function draft() {
      return { ...context.getSettings(), sponsors: collect() };
    }

    /* -------------------------------------------------------------- actions */

    function addSponsor() {
      const next = collect();
      if (next.items.length >= MAX_SPONSORS) return;
      const id = `sponsor-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
      context.applySettings({
        ...context.getSettings(),
        sponsors: { ...next, items: [...next.items, { id, name: 'New sponsor', tier: '', url: '', tagline: '', logo: { src: '', width: null, height: null } }] },
      });
    }

    function removeSponsor(id) {
      if (!global.confirm('Remove this sponsor? Prizes it sponsored will have none.')) return;
      const next = collect();
      context.applySettings({ ...context.getSettings(), sponsors: { ...next, items: next.items.filter((sponsor) => sponsor.id !== id) } });
    }

    function moveSponsor(id, direction) {
      const next = collect();
      const items = [...next.items];
      const from = items.findIndex((sponsor) => sponsor.id === id);
      const to = from + direction;
      if (from < 0 || to < 0 || to >= items.length) return;
      [items[from], items[to]] = [items[to], items[from]];
      context.applySettings({ ...context.getSettings(), sponsors: { ...next, items } });
    }

    /** A logo can only be attached to a saved sponsor, so a new one is saved first, quietly. */
    async function uploadLogo(id, file) {
      if (!file) return;
      if (file.type && !LOGO_TYPES.includes(file.type)) {
        context.toast('Choose a PNG, JPEG, GIF, WebP or SVG image.', 'error');
        return;
      }
      const limit = (context.getLimits() || {}).maxUploadBytes || 8 * 1024 * 1024;
      if (file.size > limit) {
        context.toast(`That image is too large — the limit here is ${Math.round(limit / 1048576)} MB.`, 'error');
        return;
      }
      try {
        // The draft holds unsaved edits as well as saved ones, so there is no
        // telling a new sponsor from a saved one here: save it, quietly.
        await context.save(draft(), '', { quiet: true });
        const result = await api.uploadSponsorLogo(id, { content: await readAsDataUrl(file), name: file.name });
        const keep = collect();
        context.applySettings({
          ...result.appSettings,
          sponsors: { ...keep, items: keep.items.map((sponsor) => (sponsor.id === id ? result.appSettings.sponsors.items.find((item) => item.id === id) || sponsor : sponsor)) },
        });
        context.toast('Logo added.');
      } catch (error) {
        context.toast(error.message, 'error');
      }
    }

    async function removeLogo(id) {
      try {
        const result = await api.removeSponsorLogo(id);
        const keep = collect();
        context.applySettings({
          ...result.appSettings,
          sponsors: { ...keep, items: keep.items.map((sponsor) => (sponsor.id === id ? { ...sponsor, logo: { src: '', width: null, height: null } } : sponsor)) },
        });
      } catch (error) {
        context.toast(error.message, 'error');
      }
    }

    /* --------------------------------------------------------------- wiring */

    function bind() {
      elements.add.addEventListener('click', addSponsor);
      elements.editor.addEventListener('click', (event) => {
        const row = event.target.closest('.sponsor-row');
        if (!row) return;
        if (event.target.closest('.sponsor-remove')) removeSponsor(row.dataset.id);
        const move = event.target.closest('.sponsor-move');
        if (move) moveSponsor(row.dataset.id, Number(move.dataset.direction));
        if (event.target.closest('.sponsor-logo-remove')) removeLogo(row.dataset.id);
      });
      elements.editor.addEventListener('change', (event) => {
        if (!event.target.classList.contains('sponsor-logo-input')) return;
        uploadLogo(event.target.closest('.sponsor-row').dataset.id, event.target.files[0]);
        event.target.value = '';
      });
      elements.save.addEventListener('click', () =>
        busy(elements.save, 'Saving…', () => context.save(draft(), 'Sponsors saved.').catch(() => {}))
      );
      elements.revert.addEventListener('click', () => context.reload());
    }

    return { bind, render };
  });
})(window, document);

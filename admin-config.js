/**
 * Console editors for the configurable parts of the board: participant fields,
 * display slots, branding assets and board wording.
 *
 * Kept separate from admin.js so each file stays about one concern.
 */
(function configEditors(global, document) {
  'use strict';

  const api = global.lotteryApi;

  // FIX: no upload in the console checked the file before reading it, so a
  // wrong-format or oversized file was base64-encoded and posted only to be
  // refused by the server. These mirror what the server accepts.
  const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/svg+xml'];
  const FALLBACK_MAX_BYTES = 8 * 1024 * 1024;

  const SLOT_META = [
    { key: 'reel', title: 'While spinning', hint: 'Cycles through the remaining entries. Every field here is sent to the board for all entries, not just the winner.' },
    { key: 'call', title: 'Winner announcement', hint: 'The first reveal, held for the announcement delay before the full card.' },
    { key: 'card', title: 'Winner card', hint: 'The full result the audience reads.' },
    { key: 'panel', title: 'Winners list row', hint: 'One row per winner in the side panel.' },
  ];

  // Kept short so the select never truncates inside a slot row; the longer
  // explanation rides along as a tooltip.
  const EMPHASIS_OPTIONS = [
    { value: 'primary', label: 'Primary', title: 'Largest, in the accent colour' },
    { value: 'secondary', label: 'Secondary', title: 'Bold supporting line' },
    { value: 'meta', label: 'Meta', title: 'Smaller detail line' },
    { value: 'eyebrow', label: 'Eyebrow', title: 'Small uppercase label' },
  ];

  const COPY_LABELS = {
    readyTitle: 'Idle heading',
    readyDetail: 'Idle sub-heading',
    winnerEyebrow: 'Winner label',
    prizeLabel: 'Prize word',
    // FIX: this string is rendered now, so it belongs in the Wording panel.
    prizesBack: 'Back-to-board link',
    lastWinnerEyebrow: 'Previous winner label',
    completeTitle: 'All prizes awarded',
    startButton: 'Start button',
    stopButton: 'Stop button',
    winnersHeading: 'Winners panel heading',
    winnersEmpty: 'Winners panel empty text',
    winnersToggle: 'Winners toggle',
    fullscreenButton: 'Fullscreen button',
    organiserLink: 'Organiser link',
    footer: 'Footer credit',
    loading: 'Loading message',
  };

  function escapeHtml(value) {
    return String(value === null || value === undefined ? '' : value).replace(
      /[&<>"']/g,
      (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]
    );
  }

  /**
   * Creates the editors. `context` supplies the shared console plumbing:
   * `getSettings()`, `applySettings(next)`, `toast()` and `reload()`.
   */
  /**
   * Checks a file before it is read.
   *
   * Returns null when the file is fine, or the reason it is not. The limit is
   * the deployment's own — a key-value deployment accepts far less than a
   * filesystem one, and finding that out after a slow upload is no help.
   */
  function rejectFile(file, maxBytes) {
    if (!file) return 'No file was chosen.';
    if (file.type && !IMAGE_TYPES.includes(file.type)) {
      return `${file.name} is a ${file.type.replace('image/', '') || 'unsupported'} file. Use PNG, JPEG, GIF or WebP.`;
    }
    if (maxBytes && file.size > maxBytes) {
      return `${file.name} is ${(file.size / 1048576).toFixed(1)} MB — the limit is ${(maxBytes / 1048576).toFixed(0)} MB on this deployment.`;
    }
    return null;
  }

  function readAsDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(new Error(`${file.name} could not be read.`));
      reader.readAsDataURL(file);
    });
  }

  /**
   * FIX: uploads gave no sign they were running. A large photo over a slow
   * connection looked like nothing had happened, so organisers clicked again.
   * The control that started it is disabled and labelled until it finishes.
   */
  async function withUploadState(element, busyText, action) {
    if (!element) return action();
    const original = element.textContent;
    element.textContent = busyText;
    element.setAttribute('aria-busy', 'true');
    element.dataset.busy = 'true';
    try {
      return await action();
    } finally {
      element.textContent = original;
      element.removeAttribute('aria-busy');
      delete element.dataset.busy;
    }
  }

  function createConfigEditors(context) {
    const elements = {
      fieldsBody: document.getElementById('fieldsBody'),
      identifierPill: document.getElementById('identifierPill'),
      saveFieldsBtn: document.getElementById('saveFieldsBtn'),
      revertFieldsBtn: document.getElementById('revertFieldsBtn'),

      slotEditors: document.getElementById('slotEditors'),
      sensitiveWarning: document.getElementById('sensitiveWarning'),
      panelMaxEntries: document.getElementById('panelMaxEntries'),
      saveDisplayBtn: document.getElementById('saveDisplayBtn'),
      revertDisplayBtn: document.getElementById('revertDisplayBtn'),

      copyFields: document.getElementById('copyFields'),
      saveCopyBtn: document.getElementById('saveCopyBtn'),
      revertCopyBtn: document.getElementById('revertCopyBtn'),

      saveBrandingBtn: document.getElementById('saveBrandingBtn'),

      welcomeEnabled: document.getElementById('welcomeEnabled'),
      welcomeShowOnLoad: document.getElementById('welcomeShowOnLoad'),
      welcomeShowCaptions: document.getElementById('welcomeShowCaptions'),
      welcomeTitleInput: document.getElementById('welcomeTitleInput'),
      welcomeMessageInput: document.getElementById('welcomeMessageInput'),
      welcomePlacement: document.getElementById('welcomePlacement'),
      welcomeInterval: document.getElementById('welcomeInterval'),
      welcomeCountPill: document.getElementById('welcomeCountPill'),
      guestGrid: document.getElementById('guestGrid'),
      guestDrop: document.getElementById('guestDrop'),
      guestInput: document.getElementById('guestInput'),
      saveWelcomeBtn: document.getElementById('saveWelcomeBtn'),
      revertWelcomeBtn: document.getElementById('revertWelcomeBtn'),

      prizesEnabled: document.getElementById('prizesEnabled'),
      prizesShowOnWinner: document.getElementById('prizesShowOnWinner'),
      prizesShowCaptions: document.getElementById('prizesShowCaptions'),
      prizesDrawOrder: document.getElementById('prizesDrawOrder'),
      prizesAnnounceMode: document.getElementById('prizesAnnounceMode'),
      runningOrder: document.getElementById('runningOrder'),
      runningOrderList: document.getElementById('runningOrderList'),
      runningOrderNote: document.getElementById('runningOrderNote'),
      prizesHeadingInput: document.getElementById('prizesHeadingInput'),
      prizesIntroInput: document.getElementById('prizesIntroInput'),
      prizesInterval: document.getElementById('prizesInterval'),
      prizeCountPill: document.getElementById('prizeCountPill'),
      prizeEditor: document.getElementById('prizeEditor'),
      addPrizeBtn: document.getElementById('addPrizeBtn'),
      savePrizesBtn: document.getElementById('savePrizesBtn'),
      revertPrizesBtn: document.getElementById('revertPrizesBtn'),
    };

    /* ---------------------------------------------------------- fields */

    function renderFields() {
      const { data } = context.getSettings();
      elements.identifierPill.textContent = `Identifier: ${data.identifier}`;

      elements.fieldsBody.innerHTML = data.fields
        .map(
          (field) => `
          <tr>
            <td><input type="radio" name="identifierField" value="${escapeHtml(field.key)}" ${field.key === data.identifier ? 'checked' : ''}></td>
            <td class="ticket">${escapeHtml(field.key)}</td>
            <td><input type="text" class="field-label-input" data-key="${escapeHtml(field.key)}" value="${escapeHtml(field.label)}" maxlength="60"></td>
            <td><input type="checkbox" class="field-sensitive" data-key="${escapeHtml(field.key)}" ${field.sensitive ? 'checked' : ''}></td>
            <td><input type="checkbox" class="field-export" data-key="${escapeHtml(field.key)}" ${field.includeInExport ? 'checked' : ''}></td>
          </tr>`
        )
        .join('');

      const policy = document.querySelector(`input[name="duplicatePolicy"][value="${data.duplicatePolicy}"]`);
      if (policy) policy.checked = true;
    }

    function collectFields() {
      const settings = context.getSettings();
      const identifier = document.querySelector('input[name="identifierField"]:checked');
      const policy = document.querySelector('input[name="duplicatePolicy"]:checked');

      const fields = settings.data.fields.map((field) => {
        const label = elements.fieldsBody.querySelector(`.field-label-input[data-key="${field.key}"]`);
        const sensitive = elements.fieldsBody.querySelector(`.field-sensitive[data-key="${field.key}"]`);
        const included = elements.fieldsBody.querySelector(`.field-export[data-key="${field.key}"]`);

        return {
          ...field,
          label: label ? label.value.trim() || field.label : field.label,
          sensitive: sensitive ? sensitive.checked : field.sensitive,
          includeInExport: included ? included.checked : field.includeInExport,
        };
      });

      return {
        ...settings,
        data: {
          ...settings.data,
          fields,
          identifier: identifier ? identifier.value : settings.data.identifier,
          duplicatePolicy: policy ? policy.value : settings.data.duplicatePolicy,
        },
      };
    }

    /* --------------------------------------------------------- display */

    function slotOptions(selectedKey) {
      return context
        .getSettings()
        .data.fields.map(
          (field) =>
            `<option value="${escapeHtml(field.key)}" ${field.key === selectedKey ? 'selected' : ''}>${escapeHtml(field.label)}${field.sensitive ? ' (sensitive)' : ''}</option>`
        )
        .join('');
    }

    function renderSlotLines(slotKey, lines) {
      if (lines.length === 0) {
        return '<p class="slot-empty">Nothing selected — the board will fall back to the identifier.</p>';
      }

      return lines
        .map(
          (line, index) => `
          <div class="slot-line-row" data-slot="${slotKey}" data-index="${index}">
            <select class="slot-field">${slotOptions(line.field)}</select>
            <select class="slot-emphasis">
              ${EMPHASIS_OPTIONS.map((option) => `<option value="${option.value}" title="${option.title}" ${option.value === line.emphasis ? 'selected' : ''}>${option.label}</option>`).join('')}
            </select>
            <label class="slot-label-toggle" title="Show the field name before the value">
              <input type="checkbox" class="slot-show-label" ${line.showLabel ? 'checked' : ''}>
              <span>Label</span>
            </label>
            <button type="button" class="btn btn-ghost slot-remove" aria-label="Remove line">Remove</button>
          </div>`
        )
        .join('');
    }

    function renderDisplay() {
      const settings = context.getSettings();

      elements.slotEditors.innerHTML = SLOT_META.map(
        (slot) => `
        <section class="card slot-card" data-slot="${slot.key}">
          <h2 class="card-title">${escapeHtml(slot.title)}</h2>
          <p class="field-hint slot-hint">${escapeHtml(slot.hint)}</p>
          <div class="slot-lines" data-slot="${slot.key}">${renderSlotLines(slot.key, settings.display[slot.key].lines)}</div>
          <button type="button" class="btn btn-ghost slot-add" data-slot="${slot.key}">Add a line</button>
        </section>`
      ).join('');

      elements.panelMaxEntries.value = settings.display.panel.maxEntries;
      renderSensitiveWarning();
    }

    /** Warns when a field marked sensitive has been placed on a public slot. */
    function renderSensitiveWarning() {
      const settings = context.getSettings();
      const sensitiveKeys = settings.data.fields.filter((field) => field.sensitive).map((field) => field.key);
      const exposed = new Set();

      SLOT_META.forEach((slot) => {
        elements.slotEditors
          .querySelectorAll(`.slot-lines[data-slot="${slot.key}"] .slot-field`)
          .forEach((select) => {
            if (sensitiveKeys.includes(select.value)) exposed.add(select.value);
          });
      });

      if (exposed.size === 0) {
        elements.sensitiveWarning.hidden = true;
        return;
      }

      const labels = settings.data.fields
        .filter((field) => exposed.has(field.key))
        .map((field) => field.label)
        .join(', ');

      elements.sensitiveWarning.hidden = false;
      elements.sensitiveWarning.innerHTML = `<strong>${escapeHtml(labels)}</strong> ${exposed.size === 1 ? 'is' : 'are'} marked sensitive and will be shown on the public board.`;
    }

    function collectDisplay() {
      const settings = context.getSettings();

      const display = SLOT_META.reduce((accumulator, slot) => {
        const rows = Array.from(elements.slotEditors.querySelectorAll(`.slot-lines[data-slot="${slot.key}"] .slot-line-row`));
        return {
          ...accumulator,
          [slot.key]: {
            ...settings.display[slot.key],
            lines: rows.map((row) => ({
              field: row.querySelector('.slot-field').value,
              emphasis: row.querySelector('.slot-emphasis').value,
              showLabel: row.querySelector('.slot-show-label').checked,
            })),
          },
        };
      }, {});

      display.panel.maxEntries = Number(elements.panelMaxEntries.value);
      return { ...settings, display: { ...settings.display, ...display } };
    }

    /* ---------------------------------------------------------- wording */

    function renderCopy() {
      const { copy } = context.getSettings();
      elements.copyFields.innerHTML = Object.keys(COPY_LABELS)
        .map(
          (key) => `
          <label class="field">
            <span class="field-label">${escapeHtml(COPY_LABELS[key])}</span>
            <input type="text" class="copy-input" data-key="${escapeHtml(key)}" value="${escapeHtml(copy[key])}" maxlength="160">
          </label>`
        )
        .join('');
    }

    function collectCopy() {
      const settings = context.getSettings();
      const copy = Array.from(elements.copyFields.querySelectorAll('.copy-input')).reduce(
        (accumulator, input) => ({ ...accumulator, [input.dataset.key]: input.value }),
        { ...settings.copy }
      );
      return { ...settings, copy };
    }

    /* --------------------------------------------------------- branding */

    /* Dimensions are only known for files uploaded through the console; an
       SVG and a pre-existing file both arrive without them. */
    function describeAsset(asset) {
      if (!asset.src) return '';
      const name = asset.src.replace('assets/', '');
      if (asset.width && asset.height) return `${name} — ${asset.width}×${asset.height}px`;
      return /\.svg$/i.test(name) ? `${name} — scalable` : name;
    }

    function renderBranding() {
      const { branding } = context.getSettings();

      [['logo', 'logoPreview', 'logoMeta'], ['background', 'backgroundPreview', 'backgroundMeta']].forEach(
        ([kind, previewId, metaId]) => {
          const preview = document.getElementById(previewId);
          const meta = document.getElementById(metaId);
          const asset = branding[kind];

          preview.innerHTML = asset.src
            ? `<img src="${escapeHtml(asset.src)}?v=${Date.now()}" alt="${kind} preview">`
            : `<span class="asset-empty">No ${kind}</span>`;

          // FIX: only written when there was a source, so removing an image
          // left the previous file's name and dimensions on screen.
          meta.textContent = describeAsset(asset);
        }
      );

      document.getElementById('logoPosition').value = branding.logo.position;
      document.getElementById('logoMaxHeight').value = branding.logo.maxHeight;
      document.getElementById('backgroundFit').value = branding.background.fit;
      document.getElementById('overlayOpacity').value = branding.background.overlayOpacity;
    }

    function collectBranding() {
      const settings = context.getSettings();
      return {
        ...settings,
        branding: {
          logo: {
            ...settings.branding.logo,
            position: document.getElementById('logoPosition').value,
            maxHeight: Number(document.getElementById('logoMaxHeight').value),
          },
          background: {
            ...settings.branding.background,
            fit: document.getElementById('backgroundFit').value,
            overlayOpacity: Number(document.getElementById('overlayOpacity').value),
          },
        },
      };
    }

    /**
     * FIX: no size or type check before reading; the reply replaced the whole
     * draft, so an unsaved logo position, height, fit or overlay was reverted
     * by uploading a file; and there was no loading state on a backdrop that
     * can be several megabytes.
     */
    async function uploadAsset(kind, file, control) {
      if (!file) return;

      const rejection = rejectFile(file, context.getLimits().maxUploadBytes || FALLBACK_MAX_BYTES);
      if (rejection) {
        context.toast(rejection, 'error');
        return;
      }

      await withUploadState(control, 'Uploading…', async () => {
        try {
          await context.save(collectBranding(), 'Branding saved.', { quiet: true });
          const content = await readAsDataUrl(file);
          const result = await api.uploadAsset(kind, { content, name: file.name });
          context.applySettings(result.appSettings);
          const { width, height } = result.asset;
          context.toast(`${kind === 'logo' ? 'Logo' : 'Background'} uploaded${width ? ` — ${width}×${height}px` : ''}.`);
        } catch (error) {
          context.toast(error.message, 'error');
        }
      });
    }

    /* FIX: reverted unsaved branding choices, as the upload did. */
    async function removeAsset(kind) {
      if (!global.confirm(`Remove the ${kind}?`)) return;
      try {
        await context.save(collectBranding(), 'Branding saved.', { quiet: true });
        context.applySettings((await api.deleteAsset(kind)).appSettings);
        context.toast(`${kind === 'logo' ? 'Logo' : 'Background'} removed.`);
      } catch (error) {
        context.toast(error.message, 'error');
      }
    }

    /* ---------------------------------------------------------- welcome */

    function renderWelcome() {
      const { welcome } = context.getSettings();

      elements.welcomeEnabled.checked = welcome.enabled;
      elements.welcomeShowOnLoad.checked = welcome.showOnLoad;
      elements.welcomeShowCaptions.checked = welcome.showCaptions;
      elements.welcomeTitleInput.value = welcome.title;
      elements.welcomeMessageInput.value = welcome.message;
      elements.welcomePlacement.value = welcome.placement;
      elements.welcomeInterval.value = welcome.intervalMs;
      elements.welcomeCountPill.textContent = `${welcome.images.length} photo${welcome.images.length === 1 ? '' : 's'}`;

      if (welcome.images.length === 0) {
        elements.guestGrid.innerHTML = '<p class="slot-empty">No photos yet. The welcome will show the message on its own.</p>';
        return;
      }

      elements.guestGrid.innerHTML = welcome.images
        .map(
          (image, position) => `
          <figure class="guest-item" data-src="${escapeHtml(image.src)}">
            <img src="${escapeHtml(image.src)}" alt="">
            <figcaption>
              <input type="text" class="guest-caption" data-src="${escapeHtml(image.src)}"
                value="${escapeHtml(image.caption)}" maxlength="120" placeholder="Caption (optional)">
              <span class="guest-meta">${image.width ? `${image.width}×${image.height}` : ''}</span>
            </figcaption>
            <div class="guest-actions">
              <button type="button" class="btn btn-ghost guest-move" data-direction="-1" ${position === 0 ? 'disabled' : ''} aria-label="Move earlier">↑</button>
              <button type="button" class="btn btn-ghost guest-move" data-direction="1" ${position === welcome.images.length - 1 ? 'disabled' : ''} aria-label="Move later">↓</button>
              <button type="button" class="btn btn-danger guest-remove">Remove</button>
            </div>
          </figure>`
        )
        .join('');
    }

    function collectWelcome() {
      const settings = context.getSettings();

      // Captions and order are edited in place; the array order is the source
      // of truth for the carousel sequence.
      const images = Array.from(elements.guestGrid.querySelectorAll('.guest-item')).map((item) => {
        const src = item.dataset.src;
        const existing = settings.welcome.images.find((image) => image.src === src) || {};
        const caption = item.querySelector('.guest-caption');
        return { ...existing, src, caption: caption ? caption.value.trim() : '' };
      });

      return {
        ...settings,
        welcome: {
          ...settings.welcome,
          enabled: elements.welcomeEnabled.checked,
          showOnLoad: elements.welcomeShowOnLoad.checked,
          showCaptions: elements.welcomeShowCaptions.checked,
          title: elements.welcomeTitleInput.value.trim(),
          message: elements.welcomeMessageInput.value,
          placement: elements.welcomePlacement.value,
          intervalMs: Number(elements.welcomeInterval.value),
          images: images.length > 0 ? images : settings.welcome.images,
        },
      };
    }

    /** Uploads run one after another so the server appends in a stable order. */
    /**
     * FIX: three problems here. Nothing validated the file before reading it;
     * the reply replaced the whole draft, discarding an unsaved title or
     * message; and one bad file abandoned the rest of the selection with no
     * loading state at any point.
     */
    async function uploadGuestPhotos(files, control) {
      const list = Array.from(files || []);
      if (list.length === 0) return;

      const maxBytes = context.getLimits().maxUploadBytes || FALLBACK_MAX_BYTES;
      const rejected = list.map((file) => rejectFile(file, maxBytes)).filter(Boolean);
      if (rejected.length > 0) {
        context.toast(rejected[0], 'error');
        return;
      }

      await withUploadState(control, 'Uploading…', async () => {
        // Photos land on the stored welcome block, so pending text is
        // committed first rather than being overwritten by the reply.
        try {
          await context.save(collectWelcome(), 'Guest welcome saved.', { quiet: true });
        } catch (error) {
          context.toast(`Photos not added — the welcome could not be saved. ${error.message}`, 'error');
          return;
        }

        const failed = [];
        let added = 0;
        for (const file of list) {
          try {
            const content = await readAsDataUrl(file);
            const result = await api.addWelcomeImage({ content, name: file.name });
            context.applySettings(result.appSettings);
            added += 1;
          } catch (error) {
            failed.push(`${file.name}: ${error.message}`);
          }
        }

        if (added > 0) context.toast(`Added ${added} photo${added === 1 ? '' : 's'}.`);
        if (failed.length > 0) context.toast(failed[0], 'error');
      });
    }

    /* FIX: discarded an unsaved title or message, as the upload did. */
    async function removeGuestPhoto(src) {
      if (!global.confirm('Remove this photo from the carousel?')) return;
      try {
        await context.save(collectWelcome(), 'Guest welcome saved.', { quiet: true });
        context.applySettings((await api.removeWelcomeImage(src)).appSettings);
        context.toast('Photo removed.');
      } catch (error) {
        context.toast(error.message, 'error');
      }
    }

    function moveGuestPhoto(src, direction) {
      const settings = context.getSettings();
      const images = [...settings.welcome.images];
      const from = images.findIndex((image) => image.src === src);
      const to = from + direction;
      if (from < 0 || to < 0 || to >= images.length) return;

      [images[from], images[to]] = [images[to], images[from]];
      context.applySettings({ ...settings, welcome: { ...settings.welcome, images } });
    }

    /* ------------------------------------------------------------ prizes */

    function renderPrizes() {
      const { prizes } = context.getSettings();

      elements.prizesEnabled.checked = prizes.enabled;
      elements.prizesShowOnWinner.checked = prizes.showOnWinner;
      elements.prizesShowCaptions.checked = prizes.showCaptions;
      elements.prizesDrawOrder.value = prizes.drawOrder;
      elements.prizesAnnounceMode.value = prizes.announceMode;
      elements.prizesHeadingInput.value = prizes.heading;
      elements.prizesIntroInput.value = prizes.intro;
      elements.prizesInterval.value = prizes.intervalMs;
      elements.prizeCountPill.textContent = `${prizes.items.length} prize${prizes.items.length === 1 ? '' : 's'}`;

      renderRunningOrder();

      if (prizes.items.length === 0) {
        elements.prizeEditor.innerHTML = '<p class="slot-empty">No prizes yet. Add the first one above.</p>';
        return;
      }

      elements.prizeEditor.innerHTML = prizes.items
        .map(
          (prize, index) => `
          <section class="prize-row" data-id="${escapeHtml(prize.id)}">
            <header class="prize-row-head">
              <span class="prize-row-rank">${index + 1}</span>
              <input type="text" class="prize-label" value="${escapeHtml(prize.label)}" maxlength="60" aria-label="Rank label">
              <div class="prize-row-actions">
                <button type="button" class="btn btn-ghost prize-move" data-direction="-1" ${index === 0 ? 'disabled' : ''} aria-label="Move up">↑</button>
                <button type="button" class="btn btn-ghost prize-move" data-direction="1" ${index === prizes.items.length - 1 ? 'disabled' : ''} aria-label="Move down">↓</button>
                <button type="button" class="btn btn-danger prize-remove">Remove</button>
              </div>
            </header>

            <div class="grid-2">
              <label class="field">
                <span class="field-label">Prize</span>
                <input type="text" class="prize-name" value="${escapeHtml(prize.name)}" maxlength="140" placeholder="iPhone 18 Pro Max">
              </label>
              <label class="field">
                <span class="field-label">Description</span>
                <textarea class="prize-description" rows="2" maxlength="600" placeholder="What the winner receives.">${escapeHtml(prize.description)}</textarea>
              </label>
            </div>

            <div class="prize-photos">
              <div class="prize-photo-grid">
                ${prize.images
                  .map(
                    (image) => `
                    <figure class="guest-item" data-src="${escapeHtml(image.src)}">
                      <img src="${escapeHtml(image.src)}" alt="">
                      <figcaption>
                        <input type="text" class="prize-caption" data-src="${escapeHtml(image.src)}" value="${escapeHtml(image.caption)}" maxlength="120" placeholder="Caption (optional)">
                        <span class="guest-meta">${image.width ? `${image.width}×${image.height}` : ''}</span>
                      </figcaption>
                      <div class="guest-actions">
                        <button type="button" class="btn btn-danger prize-photo-remove">Remove</button>
                      </div>
                    </figure>`
                  )
                  .join('')}
              </div>
              <input type="file" class="sr-only prize-photo-input" id="prize-photo-${escapeHtml(prize.id)}" accept="image/png,image/jpeg,image/gif,image/webp" multiple>
              <label class="btn btn-ghost btn-small" for="prize-photo-${escapeHtml(prize.id)}">Add photos</label>
            </div>
          </section>`
        )
        .join('');
    }

    /**
     * The sequence the evening will actually run in, spelled out before
     * anyone presses Start — the setting alone is easy to misread.
     */
    function renderRunningOrder() {
      const settings = context.getSettings();
      const { prizes } = settings;
      const total = settings.totalPrizes;

      if (!prizes.enabled || total < 1) {
        elements.runningOrder.hidden = true;
        return;
      }

      const ranks = Array.from({ length: total }, (_, index) =>
        prizes.drawOrder === 'lowest-first' ? Math.max(1, total - index) : index + 1
      );

      elements.runningOrder.hidden = false;
      elements.runningOrderList.innerHTML = ranks
        .map((rank, index) => {
          const prize = prizes.items[rank - 1];
          const label = prize ? prize.label : `Prize ${rank}`;
          const name = prize ? prize.name : 'No prize linked to this position';
          return `
            <li class="running-order-step${prize ? '' : ' is-unlinked'}">
              <span class="running-order-index">${index + 1}</span>
              <span class="running-order-body">
                <span class="running-order-label">${escapeHtml(label)}</span>
                <span class="running-order-name">${escapeHtml(name)}</span>
              </span>
            </li>`;
        })
        .join('');

      const unlinked = ranks.filter((rank) => !prizes.items[rank - 1]).length;
      const announced = prizes.announceMode === 'before'
        ? 'Each prize is shown on the board before its draw.'
        : 'Prizes stay hidden until each winner is announced.';

      elements.runningOrderNote.textContent = unlinked > 0
        ? `${announced} ${unlinked} of ${total} draw(s) have no prize linked — add one, or reduce the prize count in Settings.`
        : announced;
    }

    function collectPrizes() {
      const settings = context.getSettings();

      const items = Array.from(elements.prizeEditor.querySelectorAll('.prize-row')).map((row) => {
        const id = row.dataset.id;
        const existing = settings.prizes.items.find((prize) => prize.id === id) || { images: [] };
        const images = Array.from(row.querySelectorAll('.guest-item')).map((figure) => {
          const src = figure.dataset.src;
          const stored = existing.images.find((image) => image.src === src) || {};
          const caption = figure.querySelector('.prize-caption');
          return { ...stored, src, caption: caption ? caption.value.trim() : '' };
        });

        return {
          ...existing,
          id,
          label: row.querySelector('.prize-label').value.trim(),
          name: row.querySelector('.prize-name').value.trim(),
          description: row.querySelector('.prize-description').value.trim(),
          images,
        };
      });

      return {
        ...settings,
        prizes: {
          ...settings.prizes,
          enabled: elements.prizesEnabled.checked,
          showOnWinner: elements.prizesShowOnWinner.checked,
          showCaptions: elements.prizesShowCaptions.checked,
          drawOrder: elements.prizesDrawOrder.value,
          announceMode: elements.prizesAnnounceMode.value,
          heading: elements.prizesHeadingInput.value.trim(),
          intro: elements.prizesIntroInput.value,
          intervalMs: Number(elements.prizesInterval.value),
          items,
        },
      };
    }

    /** New prizes are held locally until saved, like every other edit here. */
    function addPrize() {
      const draft = collectPrizes();
      const next = draft.prizes.items.length + 1;
      context.applySettings({
        ...draft,
        prizes: {
          ...draft.prizes,
          items: [
            ...draft.prizes.items,
            { id: `prize-${next}-${Math.random().toString(36).slice(2, 7)}`, label: '', name: `Prize ${next}`, description: '', images: [] },
          ],
        },
      });
    }

    function removePrize(id) {
      if (!global.confirm('Remove this prize? Its photos are released when you save.')) return;
      const draft = collectPrizes();
      context.applySettings({
        ...draft,
        prizes: { ...draft.prizes, items: draft.prizes.items.filter((prize) => prize.id !== id) },
      });
    }

    function movePrize(id, direction) {
      const draft = collectPrizes();
      const items = [...draft.prizes.items];
      const from = items.findIndex((prize) => prize.id === id);
      const to = from + direction;
      if (from < 0 || to < 0 || to >= items.length) return;

      [items[from], items[to]] = [items[to], items[from]];
      context.applySettings({ ...draft, prizes: { ...draft.prizes, items } });
    }

    /**
     * The prize rows that cannot be saved as they stand.
     *
     * A prize with no name is dropped by the server when the list is saved.
     * That is right for a saved list but disastrous mid-edit, so callers check
     * first and say what is wrong instead of letting the row be deleted.
     */
    function unnamedPrizeRows() {
      return Array.from(elements.prizeEditor.querySelectorAll('.prize-row')).filter(
        (row) => !row.querySelector('.prize-name').value.trim()
      );
    }

    /**
     * FIX: a prize with an empty name was silently deleted by any action that
     * saved the list — including adding a photo, which saves first so the
     * photo has something to attach to. Adding a prize and reaching for a
     * photo before typing the name destroyed the row and answered "That prize
     * no longer exists". Now the organiser is told what is missing and taken
     * to the field, and nothing is sent to the server.
     */
    function blockedByUnnamedPrize(action) {
      const rows = unnamedPrizeRows();
      if (rows.length === 0) return false;

      const [first] = rows;
      const rank = Array.from(elements.prizeEditor.querySelectorAll('.prize-row')).indexOf(first) + 1;
      context.toast(`Give prize ${rank} a name before ${action}.`, 'error');
      const nameField = first.querySelector('.prize-name');
      nameField.focus();
      nameField.scrollIntoView({ block: 'center', behavior: 'smooth' });
      return true;
    }

    /* Photos attach to a saved prize, so unsaved edits are committed first. */
    async function uploadPrizePhotos(id, files, control) {
      const list = Array.from(files || []);
      if (list.length === 0) return;
      if (blockedByUnnamedPrize('adding photos')) return;

      const pending = collectPrizes();
      if (!pending.prizes.items.some((prize) => prize.id === id)) {
        context.toast('That prize is no longer in the list. Reload the console and try again.', 'error');
        return;
      }

      const maxBytes = context.getLimits().maxUploadBytes || FALLBACK_MAX_BYTES;
      const rejected = list.map((file) => rejectFile(file, maxBytes)).filter(Boolean);
      if (rejected.length > 0) {
        context.toast(rejected[0], 'error');
        return;
      }

      await withUploadState(control, 'Uploading…', async () => {
        // FIX: this save could throw and nothing caught it, so a failed
        // commit became an unhandled rejection and the upload stopped with no
        // explanation beyond a settings error.
        try {
          await context.save(pending, 'Prizes saved.', { quiet: true });
        } catch (error) {
          context.toast(`Photos not added — the prize list could not be saved. ${error.message}`, 'error');
          return;
        }

        // FIX: one bad file used to abandon the whole selection. Every file is
        // attempted and the failures are reported together.
        const failed = [];
        let added = 0;
        for (const file of list) {
          try {
            const content = await readAsDataUrl(file);
            const result = await api.addPrizeImage(id, { content, name: file.name });
            context.applySettings(result.appSettings);
            added += 1;
          } catch (error) {
            failed.push(`${file.name}: ${error.message}`);
          }
        }

        if (added > 0) context.toast(`Added ${added} photo${added === 1 ? '' : 's'}.`);
        if (failed.length > 0) context.toast(failed[0], 'error');
      });
    }

    /**
     * FIX: this replaced the entire draft with the server's copy, so any name,
     * label, description or caption typed since the last save was thrown away
     * by removing one photo. Pending edits are committed first, exactly as
     * adding a photo does.
     */
    async function removePrizePhoto(id, src) {
      if (!global.confirm('Remove this photo?')) return;
      if (blockedByUnnamedPrize('removing a photo')) return;

      try {
        await context.save(collectPrizes(), 'Prizes saved.', { quiet: true });
        context.applySettings((await api.removePrizeImage(id, src)).appSettings);
        context.toast('Photo removed.');
      } catch (error) {
        context.toast(error.message, 'error');
      }
    }

    /* ------------------------------------------------------------ wiring */

    function bind() {
      elements.saveFieldsBtn.addEventListener('click', () => context.save(collectFields(), 'Fields saved.'));
      elements.revertFieldsBtn.addEventListener('click', renderFields);

      elements.saveDisplayBtn.addEventListener('click', () => context.save(collectDisplay(), 'Display saved.'));
      elements.revertDisplayBtn.addEventListener('click', renderDisplay);

      elements.saveCopyBtn.addEventListener('click', () => context.save(collectCopy(), 'Wording saved.'));
      elements.revertCopyBtn.addEventListener('click', renderCopy);

      elements.saveBrandingBtn.addEventListener('click', () => context.save(collectBranding(), 'Branding saved.'));

      elements.saveWelcomeBtn.addEventListener('click', () => context.save(collectWelcome(), 'Guest welcome saved.'));

      // FIX: saving with a nameless prize dropped that row without a word.
      elements.savePrizesBtn.addEventListener('click', () => {
        if (blockedByUnnamedPrize('saving')) return;
        context.save(collectPrizes(), 'Prizes saved.');
      });
      elements.revertPrizesBtn.addEventListener('click', renderPrizes);
      elements.addPrizeBtn.addEventListener('click', addPrize);

      [elements.prizesDrawOrder, elements.prizesAnnounceMode, elements.prizesEnabled].forEach((control) =>
        control.addEventListener('change', () => context.applySettings(collectPrizes()))
      );

      elements.prizeEditor.addEventListener('click', (event) => {
        const row = event.target.closest('.prize-row');
        if (!row) return;

        if (event.target.closest('.prize-remove')) return removePrize(row.dataset.id);
        if (event.target.closest('.prize-photo-remove')) {
          const figure = event.target.closest('.guest-item');
          return removePrizePhoto(row.dataset.id, figure.dataset.src);
        }
        const move = event.target.closest('.prize-move');
        if (move) movePrize(row.dataset.id, Number(move.dataset.direction));
        return undefined;
      });

      elements.prizeEditor.addEventListener('change', (event) => {
        const input = event.target.closest('.prize-photo-input');
        if (!input) return;
        const row = input.closest('.prize-row');
        // FIX: the promise was dropped on the floor, so any rejection inside
        // became an unhandled rejection with nothing shown to the organiser.
        uploadPrizePhotos(row.dataset.id, input.files, row.querySelector(`label[for="${input.id}"]`)).catch(
          (error) => context.toast(error.message, 'error')
        );
        input.value = '';
      });
      elements.revertWelcomeBtn.addEventListener('click', renderWelcome);
      elements.guestInput.addEventListener('change', (event) => {
        const label = document.querySelector(`label[for="${event.target.id}"]`);
        uploadGuestPhotos(event.target.files, label).catch((error) => context.toast(error.message, 'error'));
        event.target.value = '';
      });

      ['dragenter', 'dragover'].forEach((eventName) =>
        elements.guestDrop.addEventListener(eventName, (event) => {
          event.preventDefault();
          elements.guestDrop.classList.add('is-dragging');
        })
      );
      ['dragleave', 'drop'].forEach((eventName) =>
        elements.guestDrop.addEventListener(eventName, (event) => {
          event.preventDefault();
          elements.guestDrop.classList.remove('is-dragging');
        })
      );
      elements.guestDrop.addEventListener('drop', (event) =>
        uploadGuestPhotos(event.dataTransfer.files).catch((error) => context.toast(error.message, 'error'))
      );

      elements.guestGrid.addEventListener('click', (event) => {
        const item = event.target.closest('.guest-item');
        if (!item) return;

        if (event.target.closest('.guest-remove')) {
          removeGuestPhoto(item.dataset.src);
          return;
        }

        const move = event.target.closest('.guest-move');
        if (move) moveGuestPhoto(item.dataset.src, Number(move.dataset.direction));
      });

      // Slot rows are rebuilt constantly, so the editor listens at the container.
      elements.slotEditors.addEventListener('click', (event) => {
        const addButton = event.target.closest('.slot-add');
        if (addButton) {
          const settings = context.getSettings();
          const slotKey = addButton.dataset.slot;
          const container = elements.slotEditors.querySelector(`.slot-lines[data-slot="${slotKey}"]`);
          const used = Array.from(container.querySelectorAll('.slot-field')).map((select) => select.value);
          const next = settings.data.fields.find((field) => !used.includes(field.key));

          if (!next) {
            context.toast('Every field is already on this slot.', 'warn');
            return;
          }
          if (used.length >= 6) {
            context.toast('A slot holds at most six lines.', 'warn');
            return;
          }

          const empty = container.querySelector('.slot-empty');
          if (empty) empty.remove();
          container.insertAdjacentHTML(
            'beforeend',
            renderSlotLines(slotKey, [{ field: next.key, emphasis: used.length === 0 ? 'primary' : 'meta', showLabel: false }])
          );
          renderSensitiveWarning();
          return;
        }

        const removeButton = event.target.closest('.slot-remove');
        if (removeButton) {
          removeButton.closest('.slot-line-row').remove();
          renderSensitiveWarning();
        }
      });

      elements.slotEditors.addEventListener('change', renderSensitiveWarning);

      ['logo', 'background'].forEach((kind) => {
        const input = document.getElementById(`${kind}Input`);
        input.addEventListener('change', (event) => {
          const label = document.querySelector(`label[for="${input.id}"]`);
          uploadAsset(kind, event.target.files[0], label).catch((error) => context.toast(error.message, 'error'));
          // FIX: the input kept the last filename, so choosing the same file
          // again fired no change event and the upload appeared to do nothing.
          event.target.value = '';
        });
      });
      document.getElementById('logoRemoveBtn').addEventListener('click', () => removeAsset('logo'));
      document.getElementById('backgroundRemoveBtn').addEventListener('click', () => removeAsset('background'));
    }

    return {
      bind,
      render() {
        renderFields();
        renderDisplay();
        renderCopy();
        renderBranding();
        renderWelcome();
        renderPrizes();
      },
    };
  }

  global.createConfigEditors = createConfigEditors;
})(window, document);

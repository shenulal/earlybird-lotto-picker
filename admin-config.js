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

  /* NEW: a backdrop may be picked straight out of a camera roll, so it gets a
     ceiling of its own — and is shrunk to what a screen can actually show
     before it is sent. A 10 MB photograph is 6000px across; the board draws it
     at 2560 at most, and the bytes saved are the difference between an upload
     that works on a serverless host and one the platform refuses outright. */
  /* NEW: the sizes each preset stands for. They fill the sliders rather than
     being stored themselves, so there is one source of truth — the numbers —
     and a preset is just a quick way to reach a set of them. */
  const LAYOUT_PRESETS = {
    reel: {
      small: { width: 760, height: 130, fontSize: 56 },
      medium: { width: 1080, height: 180, fontSize: 92 },
      large: { width: 1440, height: 260, fontSize: 140 },
    },
    controls: {
      small: { minWidth: 130, height: 44, fontSize: 15, paddingX: 20, radius: 999 },
      medium: { minWidth: 190, height: 58, fontSize: 21, paddingX: 30, radius: 999 },
      large: { minWidth: 260, height: 76, fontSize: 28, paddingX: 42, radius: 999 },
    },
  };

  // What "Reset to defaults" goes back to: the board sizing itself, as it does
  // on a board nobody has touched.
  const LAYOUT_DEFAULTS = {
    overlayOpacity: 45,
    reel: { width: 0, height: 0, fontSize: 0 },
    controls: { minWidth: 0, height: 0, fontSize: 0, paddingX: 0, radius: 999 },
  };

  const BACKGROUND_MAX_BYTES = 10 * 1024 * 1024;
  const BACKGROUND_MAX_EDGE = 2560;
  // Comfortably inside the 4.5 MB body a serverless request may carry, once
  // base64 has added its third.
  const SHRINK_ABOVE_BYTES = 1.5 * 1024 * 1024;

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

  /**
   * NEW: redraws an oversized backdrop at a size a screen can show.
   *
   * Returns the original untouched when it is already small enough, or when
   * anything about the redraw fails — a backdrop that uploads at full size is
   * better than one that does not upload at all.
   */
  async function shrinkBackground(file, dataUrl) {
    if (file.size <= SHRINK_ABOVE_BYTES) return { content: dataUrl, resized: false };
    if (file.type === 'image/svg+xml' || file.type === 'image/gif') return { content: dataUrl, resized: false };

    try {
      const image = await new Promise((resolve, reject) => {
        const element = new global.Image();
        element.onload = () => resolve(element);
        element.onerror = () => reject(new Error('unreadable'));
        element.src = dataUrl;
      });

      const scale = Math.min(1, BACKGROUND_MAX_EDGE / Math.max(image.naturalWidth, image.naturalHeight));
      const width = Math.round(image.naturalWidth * scale);
      const height = Math.round(image.naturalHeight * scale);

      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext('2d');
      context.drawImage(image, 0, 0, width, height);

      // A backdrop sits behind everything and is darkened by the overlay, so
      // JPEG at this quality is indistinguishable and a fraction of the size.
      const content = canvas.toDataURL('image/jpeg', 0.86);
      if (!content || content.length >= dataUrl.length) return { content: dataUrl, resized: false };

      return {
        content,
        resized: true,
        from: `${image.naturalWidth}×${image.naturalHeight}`,
        to: `${width}×${height}`,
      };
    } catch (_error) {
      return { content: dataUrl, resized: false };
    }
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
    // NEW: the prize carousel shown in the text preview, torn down whenever it
    // is rebuilt so its timer never outlives the element it turns.
    let previewCarousel = null;
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

      revealDelay: document.getElementById('revealDelay'),
      revealDelayValue: document.getElementById('revealDelayValue'),
      resetRevealDelayBtn: document.getElementById('resetRevealDelayBtn'),
      revealSim: document.getElementById('revealSim'),
      revealSimStage: document.getElementById('revealSimStage'),
      revealSimLabel: document.getElementById('revealSimLabel'),
      revealSimBar: document.getElementById('revealSimBar'),
      playRevealBtn: document.getElementById('playRevealBtn'),

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

      // NEW: social channels and QR settings.
      channelEditor: document.getElementById('channelEditor'),
      channelCountPill: document.getElementById('channelCountPill'),
      addChannelBtn: document.getElementById('addChannelBtn'),
      saveChannelsBtn: document.getElementById('saveChannelsBtn'),
      revertChannelsBtn: document.getElementById('revertChannelsBtn'),
      qrStyle: document.getElementById('qrStyle'),
      qrPosition: document.getElementById('qrPosition'),
      qrSize: document.getElementById('qrSize'),
      qrDisplay: document.getElementById('qrDisplay'),
      qrColor: document.getElementById('qrColor'),
      qrColorText: document.getElementById('qrColorText'),
      socialHeading: document.getElementById('socialHeading'),
      qrPreview: document.getElementById('qrPreview'),

      // NEW: board layout.
      overlayOpacity: document.getElementById('overlayOpacity'),
      overlayValue: document.getElementById('overlayValue'),
      saveTextBtn: document.getElementById('saveTextBtn'),
      revertTextBtn: document.getElementById('revertTextBtn'),
      resetTextBtn: document.getElementById('resetTextBtn'),
      saveLayoutBtn: document.getElementById('saveLayoutBtn'),
      revertLayoutBtn: document.getElementById('revertLayoutBtn'),
      resetLayoutBtn: document.getElementById('resetLayoutBtn'),
      boardPreview: document.getElementById('boardPreview'),
      boardPreviewBackdrop: document.getElementById('boardPreviewBackdrop'),
      boardPreviewOverlay: document.getElementById('boardPreviewOverlay'),
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
      elements.revealDelay.value = settings.animation.winnerAnnouncementDelay;
      renderRevealDelay();
      renderSensitiveWarning();
    }

    /* ------------------------------------------- NEW: winner reveal timing */

    const REVEAL_DELAY_DEFAULT = 5000;

    // Long enough to read as a hand-over, short enough that it never eats a
    // brief delay. The board carves the same slice out of the same delay.
    const REVEAL_EXIT_MS = 300;

    function revealDelayMs() {
      return Math.max(0, Number(elements.revealDelay.value) || 0);
    }

    /** Says the delay as a length of time, and says what zero means. */
    function renderRevealDelay() {
      const ms = revealDelayMs();
      elements.revealDelayValue.textContent =
        ms === 0 ? 'Off — card at once' : `${(ms / 1000).toFixed(1)}s`;
    }

    /**
     * NEW: a rehearsal of the reveal, at the delay currently set.
     *
     * A number of seconds is hard to judge as a length of suspense, and the
     * only other way to find out is to spend a real draw on it in front of an
     * audience. This plays the same sequence the board plays — announcement,
     * the same hand-over carved out of the same delay, then the card — on the
     * organiser's own slots and one of their own entries.
     */
    let revealSimTimers = [];

    function stopRevealSim() {
      revealSimTimers.forEach(clearTimeout);
      revealSimTimers = [];
      elements.revealSim.dataset.phase = 'idle';
      elements.revealSimBar.style.transition = 'none';
      elements.revealSimBar.style.transform = 'scaleX(0)';
      elements.playRevealBtn.textContent = 'Play the sequence';
    }

    function simLater(callback, delay) {
      revealSimTimers.push(setTimeout(callback, delay));
    }

    /** The slot's chosen lines, filled from a real entry where there is one. */
    function simSlot(slotKey, record) {
      const settings = context.getSettings();
      const labels = new Map(settings.data.fields.map((f) => [f.key, f.label || f.key]));

      const lines = settings.display[slotKey].lines
        .map((line) => {
          const value = record ? record[line.field] : '';
          if (value === undefined || value === null || String(value).trim() === '') return '';
          const label = line.showLabel && labels.get(line.field)
            ? `<span class="sim-line-label">${escapeHtml(labels.get(line.field))}</span>`
            : '';
          return `<p class="sim-line" data-emphasis="${escapeHtml(line.emphasis)}">${label}<span>${escapeHtml(value)}</span></p>`;
        })
        .filter(Boolean)
        .join('');

      return lines || '<p class="sim-line" data-emphasis="meta">Nothing is placed on this slot yet.</p>';
    }

    function playRevealSim() {
      stopRevealSim();

      const settings = context.getSettings();
      const record = context.getSampleRecord();
      const delay = revealDelayMs();
      const prize = settings.prizes.items[0];
      const rank = prize ? prize.label : `${settings.copy.prizeLabel} 1`;

      const card = () => {
        elements.revealSim.dataset.phase = 'card';
        elements.revealSimLabel.textContent = 'Winner card';
        elements.revealSimStage.innerHTML = `
          <div class="sim-card sim-enter">
            <p class="sim-eyebrow">${escapeHtml(settings.copy.winnerEyebrow)} &middot; ${escapeHtml(rank)}</p>
            ${simSlot('card', record)}
            ${prize ? `<p class="sim-prize">${escapeHtml(prize.name)}</p>` : ''}
          </div>`;
        elements.playRevealBtn.textContent = 'Play the sequence';
      };

      // Zero is not a very short announcement, it is no announcement: the
      // rehearsal has to show that, or the setting looks broken at 0.
      if (delay === 0) {
        card();
        return;
      }

      elements.revealSim.dataset.phase = 'call';
      elements.revealSimLabel.textContent = 'Winner announcement';
      elements.playRevealBtn.textContent = 'Playing…';
      elements.revealSimStage.innerHTML = `
        <div class="sim-call sim-enter">
          <p class="sim-eyebrow">${escapeHtml(settings.copy.winnerEyebrow)}</p>
          ${simSlot('call', record)}
        </div>`;

      // The bar runs the whole delay, so the wait is visible while it happens
      // rather than only in hindsight.
      const bar = elements.revealSimBar;
      bar.style.transition = 'none';
      bar.style.transform = 'scaleX(0)';
      requestAnimationFrame(() => {
        bar.style.transition = `transform ${delay}ms linear`;
        bar.style.transform = 'scaleX(1)';
      });

      const fade = Math.min(REVEAL_EXIT_MS, Math.round(delay / 3));
      const announcement = elements.revealSimStage.querySelector('.sim-call');
      simLater(() => {
        announcement.style.setProperty('--announcement-exit', `${fade}ms`);
        announcement.classList.add('is-leaving');
      }, delay - fade);
      simLater(card, delay);
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
      return {
        ...settings,
        display: { ...settings.display, ...display },
        animation: { ...settings.animation, winnerAnnouncementDelay: revealDelayMs() },
      };
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

      // CHANGED: a backdrop has a ceiling of its own, well above what the
      // store would otherwise allow, because it is shrunk before it is sent.
      const ceiling =
        kind === 'background'
          ? BACKGROUND_MAX_BYTES
          : context.getLimits().maxUploadBytes || FALLBACK_MAX_BYTES;

      const rejection = rejectFile(file, ceiling);
      if (rejection) {
        context.toast(rejection, 'error');
        return;
      }

      await withUploadState(control, 'Uploading…', async () => {
        try {
          await context.save(collectBranding(), 'Branding saved.', { quiet: true });

          const raw = await readAsDataUrl(file);
          const prepared =
            kind === 'background' ? await shrinkBackground(file, raw) : { content: raw, resized: false };

          const result = await api.uploadAsset(kind, { content: prepared.content, name: file.name });
          context.applySettings(result.appSettings);

          const { width, height } = result.asset;
          const size = width ? ` — ${width}×${height}px` : '';
          const shrunk = prepared.resized ? ` Resized from ${prepared.from} to fit.` : '';
          context.toast(`${kind === 'logo' ? 'Logo' : 'Background'} uploaded${size}.${shrunk}`);
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

    /* ------------------------------------------------ NEW: text styling */

    const TEXT_SCOPES = ['welcome', 'prizes', 'board'];

    // Sizes a preset stands for. As with the layout presets, these fill the
    // controls rather than being stored, so the numbers remain the only truth.
    const TEXT_PRESETS = {
      small: { fontSize: 16, lineHeight: 150 },
      medium: { fontSize: 24, lineHeight: 155 },
      large: { fontSize: 36, lineHeight: 140 },
    };

    const TEXT_DEFAULTS = {
      fontSize: 0,
      color: '',
      opacity: 100,
      fontFamily: 'body',
      fontWeight: 0,
      align: 'auto',
      lineHeight: 0,
      letterSpacing: 0,
    };

    const PRIZE_MEDIA_DEFAULTS = {
      imageMode: 'single',
      autoplay: true,
      slideMs: 3000,
      transition: 'fade',
      showDots: true,
      shape: 'rounded',
    };

    // What the preview says for a value meaning "as the screen has it".
    const TEXT_READOUTS = {
      fontSize: (value) => (value ? `${value}px` : 'Auto'),
      opacity: (value) => `${value}%`,
      lineHeight: (value) => (value ? (value / 100).toFixed(2) : 'Auto'),
      letterSpacing: (value) => (value ? `${(value / 100).toFixed(2)}em` : 'Auto'),
    };

    function textField(scope, key) {
      return document.querySelector(`[data-text="${scope}.${key}"]`);
    }

    function readTextStyle(scope) {
      const style = { ...TEXT_DEFAULTS };
      Object.keys(TEXT_DEFAULTS).forEach((key) => {
        const field = textField(scope, key);
        if (!field) return;
        const raw = field.value;
        style[key] = typeof TEXT_DEFAULTS[key] === 'number' ? Number(raw) || 0 : raw;
      });
      return style;
    }

    function writeTextStyle(scope, style) {
      Object.keys(TEXT_DEFAULTS).forEach((key) => {
        const field = textField(scope, key);
        if (!field) return;
        field.value = style[key];

        const readout = document.querySelector(`[data-text-value="${scope}.${key}"]`);
        if (readout && TEXT_READOUTS[key]) readout.textContent = TEXT_READOUTS[key](Number(style[key]) || 0);
      });

      const swatch = document.querySelector(`[data-text-color="${scope}"]`);
      if (swatch && /^#[0-9a-f]{6}$/i.test(style.color)) swatch.value = style.color;
    }

    function renderText() {
      const settings = context.getSettings();
      TEXT_SCOPES.forEach((scope) => writeTextStyle(scope, (settings.text || {})[scope] || TEXT_DEFAULTS));

      const media = settings.prizes.board || PRIZE_MEDIA_DEFAULTS;
      document.getElementById('prizeImageMode').value = media.imageMode;
      document.getElementById('prizeImageShape').value = media.shape;
      document.getElementById('prizeAutoplay').checked = media.autoplay;
      document.getElementById('prizeSlideMs').value = media.slideMs;
      document.getElementById('prizeTransition').value = media.transition;
      document.getElementById('prizeShowDots').checked = media.showDots;

      renderTextPreview();
    }

    function collectText() {
      const settings = context.getSettings();
      const text = {};
      TEXT_SCOPES.forEach((scope) => {
        text[scope] = readTextStyle(scope);
      });

      return {
        ...settings,
        text,
        prizes: {
          ...settings.prizes,
          board: {
            imageMode: document.getElementById('prizeImageMode').value,
            autoplay: document.getElementById('prizeAutoplay').checked,
            slideMs: Number(document.getElementById('prizeSlideMs').value),
            transition: document.getElementById('prizeTransition').value,
            showDots: document.getElementById('prizeShowDots').checked,
            shape: document.getElementById('prizeImageShape').value,
          },
        },
      };
    }

    function activeTextScope() {
      const tab = document.querySelector('#panel-text .tab.is-active');
      return tab ? tab.dataset.textTab : 'welcome';
    }

    const PREVIEW_SAMPLES = {
      welcome: {
        eyebrow: 'Welcome',
        heading: 'Our guest of honour',
        body: 'Please join us in welcoming H.E. Dr. Amina Al Suwaidi, who will open tonight\u2019s draw and present the first prize to our winner.',
      },
      prizes: {
        eyebrow: 'Tonight\u2019s prizes',
        heading: 'iPhone 18 Pro Max',
        body: 'The latest flagship, in titanium \u2014 512 GB, with a two-year warranty.',
      },
      board: {
        eyebrow: 'Up next · First prize',
        heading: 'iPhone 18 Pro Max',
        body: 'The latest flagship, in titanium.',
      },
    };

    /**
     * NEW: the words on the background they will actually sit on.
     *
     * Colour and opacity are only judgeable against the photograph behind
     * them, so the preview uses the uploaded backdrop at its current darkening
     * rather than a flat panel.
     */
    function renderTextPreview() {
      const draft = collectText();
      const scope = activeTextScope();
      const style = draft.text[scope];
      const preview = document.getElementById('textPreview');
      if (!preview) return;

      const background = draft.branding.background;
      document.getElementById('textPreviewBackdrop').style.backgroundImage = background.src
        ? `url("${encodeURI(background.src)}")`
        : 'none';
      preview.dataset.hasImage = String(Boolean(background.src));
      document.getElementById('textPreviewOverlay').style.opacity = String(background.overlayOpacity / 100);

      // Sizes here are given in pixels, which only mean something at the width
      // the screen will really be. So the sample is laid out at that width and
      // scaled down to fit the panel, exactly as the board preview does.
      const screenWidth = preview.dataset.width === 'mobile' ? 390 : 1440;
      preview.style.setProperty('--preview-screen-width', `${screenWidth}px`);
      preview.style.setProperty(
        '--preview-scale',
        String((preview.getBoundingClientRect().width || 520) / screenWidth)
      );

      const sample = PREVIEW_SAMPLES[scope];
      document.getElementById('textPreviewEyebrow').textContent = sample.eyebrow;
      const heading = document.getElementById('textPreviewHeading');
      heading.textContent = sample.heading;
      heading.hidden = !sample.heading;
      document.getElementById('textPreviewBody').textContent = sample.body;

      const content = document.getElementById('textPreviewContent');
      const families = {
        display: "'Bebas Neue', 'Lato', system-ui, sans-serif",
        body: "'Lato', 'Segoe UI', system-ui, sans-serif",
        mono: "'IBM Plex Mono', ui-monospace, Menlo, monospace",
        system: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
        sans: 'Helvetica, Arial, system-ui, sans-serif',
        serif: 'Georgia, "Times New Roman", Times, serif',
      };

      const set = (name, value) => {
        if (value) content.style.setProperty(name, value);
        else content.style.removeProperty(name);
      };
      set('--text-font', families[style.fontFamily] || '');

      // Which line the size governs differs by screen. On the welcome screen it
      // is the message; on the prize page and the board it is the prize's name,
      // with its description following proportionally beneath.
      const chosen = style.fontSize;
      const secondary = chosen ? `${Math.round(chosen * 0.72)}px` : '';
      set('--preview-heading-size', scope === 'welcome' || !chosen ? '' : `${chosen}px`);
      set('--preview-body-size', scope === 'welcome' ? (chosen ? `${chosen}px` : '') : secondary);
      set('--text-size', chosen ? `${chosen}px` : '');
      set('--text-color', style.color || '');
      set('--text-weight', style.fontWeight ? String(style.fontWeight) : '');
      set('--text-align', style.align !== 'auto' ? style.align : '');
      set('--text-line-height', style.lineHeight ? String(style.lineHeight / 100) : '');
      set('--text-letter-spacing', style.letterSpacing ? `${style.letterSpacing / 100}em` : '');
      set('--text-opacity', style.opacity < 100 ? String(style.opacity / 100) : '');

      renderPrizeMediaPreview(draft, scope);
    }

    /**
     * Three plain panels, shown when no prize has photographs yet.
     *
     * The timing, the transition, the dots and the shape are all judgeable
     * without a real photograph, and an organiser configuring the board before
     * the pictures arrive should not be left looking at an empty box.
     */
    const PLACEHOLDER_SLIDES = ['#2b3550', '#3d3055', '#26414d'].map((tone, index) => ({
      src:
        'data:image/svg+xml;utf8,' +
        encodeURIComponent(
          `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 300">` +
            `<rect width="400" height="300" fill="${tone}"/>` +
            `<text x="200" y="160" text-anchor="middle" font-family="sans-serif" ` +
            `font-size="34" fill="#8f9bbd">Photo ${index + 1}</text></svg>`
        ),
      caption: '',
    }));

    /** The board tab also previews what happens to a prize's photographs. */
    function renderPrizeMediaPreview(draft, scope) {
      const mount = document.getElementById('textPreviewMedia');
      const media = draft.prizes.board;
      const real = draft.prizes.items.flatMap((prize) => prize.images).slice(0, 6);
      const images = real.length > 0 ? real : PLACEHOLDER_SLIDES;

      document.getElementById('prizeCarouselOptions').hidden = media.imageMode !== 'carousel';
      const note = document.getElementById('prizeMediaNote');
      if (note) note.hidden = real.length > 0;

      if (scope !== 'board') {
        mount.hidden = true;
        mount.innerHTML = '';
        if (previewCarousel) {
          previewCarousel.destroy();
          previewCarousel = null;
        }
        return;
      }

      mount.hidden = false;
      mount.dataset.shape = media.shape;

      if (previewCarousel) {
        previewCarousel.destroy();
        previewCarousel = null;
      }

      if (media.imageMode === 'carousel' && images.length > 1 && global.createCarousel) {
        previewCarousel = global.createCarousel(mount, images, {
          intervalMs: media.autoplay ? media.slideMs : 0,
          transition: media.transition,
          showDots: media.showDots,
          showArrows: false,
          showCaptions: false,
          altFallback: 'Prize photograph',
        });
        return;
      }

      mount.innerHTML = `<img src="${escapeHtml(images[0].src)}" alt="">`;
    }

    /* ----------------------------------------------- NEW: board layout */

    // Every slider, and which part of the settings it belongs to.
    const LAYOUT_SLIDERS = [
      { id: 'reelWidth', group: 'reel', key: 'width' },
      { id: 'reelHeight', group: 'reel', key: 'height' },
      { id: 'reelFontSize', group: 'reel', key: 'fontSize' },
      { id: 'controlMinWidth', group: 'controls', key: 'minWidth' },
      { id: 'controlHeight', group: 'controls', key: 'height' },
      { id: 'controlFontSize', group: 'controls', key: 'fontSize' },
      { id: 'controlPaddingX', group: 'controls', key: 'paddingX' },
      { id: 'controlRadius', group: 'controls', key: 'radius', zeroIsAValue: true },
    ];

    function layoutInput(id) {
      return document.getElementById(id);
    }

    /** Zero means "let the board decide", except where zero is a real choice. */
    function describeSize(value, zeroIsAValue) {
      if (!value && !zeroIsAValue) return 'Auto';
      return `${value}px`;
    }

    function renderLayout() {
      const settings = context.getSettings();
      const { ui, branding } = settings;

      elements.overlayOpacity.value = branding.background.overlayOpacity;
      elements.overlayValue.textContent = `${branding.background.overlayOpacity}%`;

      LAYOUT_SLIDERS.forEach((slider) => {
        const value = (ui[slider.group] || {})[slider.key] || 0;
        layoutInput(slider.id).value = value;
        layoutInput(`${slider.id}Value`).textContent = describeSize(value, slider.zeroIsAValue);
      });

      renderBoardPreview();
    }

    function collectLayout() {
      const settings = context.getSettings();
      const reel = {};
      const controls = {};

      LAYOUT_SLIDERS.forEach((slider) => {
        const value = Number(layoutInput(slider.id).value) || 0;
        if (slider.group === 'reel') reel[slider.key] = value;
        else controls[slider.key] = value;
      });

      return {
        ...settings,
        branding: {
          ...settings.branding,
          background: {
            ...settings.branding.background,
            overlayOpacity: Number(elements.overlayOpacity.value),
          },
        },
        ui: { ...settings.ui, reel, controls },
      };
    }

    /**
     * NEW: the board as the room will see it.
     *
     * The real backdrop at the chosen darkening, with the reel and the buttons
     * at their chosen sizes, scaled down to the preview's width. A number of
     * pixels means nothing on its own; seen against the artwork it is about to
     * sit on, it means everything.
     */
    function renderBoardPreview() {
      const draft = collectLayout();
      const preview = elements.boardPreview;
      if (!preview) return;

      const background = draft.branding.background;
      elements.boardPreviewBackdrop.style.backgroundImage = background.src
        ? `url("${encodeURI(background.src)}")`
        : 'none';
      preview.dataset.hasImage = String(Boolean(background.src));
      elements.boardPreviewOverlay.style.opacity = String(background.overlayOpacity / 100);

      // The board is drawn at the chosen width and then scaled to fit here, so
      // what is on screen is proportionally what will be projected.
      const wide = preview.dataset.width !== 'mobile';
      const boardWidth = wide ? 1440 : 390;
      const frame = elements.boardPreview.getBoundingClientRect().width || 520;
      const scale = frame / boardWidth;

      preview.style.setProperty('--preview-board-width', `${boardWidth}px`);
      preview.style.setProperty('--preview-scale', String(scale));

      // Auto values fall back to what the board itself would have chosen at
      // this width, so the preview never shows a size the board would not.
      const auto = wide
        ? { reelWidth: 860, reelHeight: 180, reelFont: 118, ctlWidth: 208, ctlHeight: 54, ctlFont: 22, ctlPad: 30 }
        : { reelWidth: 358, reelHeight: 132, reelFont: 48, ctlWidth: 146, ctlHeight: 46, ctlFont: 17, ctlPad: 22 };

      const { reel, controls } = draft.ui;
      const set = (name, value) => preview.style.setProperty(name, `${value}px`);
      set('--preview-reel-width', Math.min(reel.width || auto.reelWidth, boardWidth - 40));
      set('--preview-reel-height', reel.height || auto.reelHeight);
      set('--preview-reel-font', reel.fontSize || auto.reelFont);
      set('--preview-control-width', controls.minWidth || auto.ctlWidth);
      set('--preview-control-height', controls.height || auto.ctlHeight);
      set('--preview-control-font', controls.fontSize || auto.ctlFont);
      set('--preview-control-padding', controls.paddingX || auto.ctlPad);
      set('--preview-control-radius', controls.radius);
      preview.style.setProperty('--preview-accent', draft.ui.primaryColor);
    }

    function applyLayoutValues(values) {
      elements.overlayOpacity.value = values.overlayOpacity;
      LAYOUT_SLIDERS.forEach((slider) => {
        const group = values[slider.group];
        if (group && group[slider.key] !== undefined) layoutInput(slider.id).value = group[slider.key];
        layoutInput(`${slider.id}Value`).textContent = describeSize(
          Number(layoutInput(slider.id).value) || 0,
          slider.zeroIsAValue
        );
      });
      elements.overlayValue.textContent = `${elements.overlayOpacity.value}%`;
      renderBoardPreview();
    }

    /* ---------------------------------------------------- NEW: channels */

    const CHANNEL_ORDER = [
      'instagram', 'facebook', 'x', 'youtube', 'tiktok', 'linkedin',
      'whatsapp', 'telegram', 'discord', 'website', 'custom',
    ];

    function channelName(type) {
      const social = global.pickoraSocial;
      return social ? social.channelInfo(type).name : type;
    }

    function renderChannels() {
      const { social } = context.getSettings();
      const channels = social.channels;

      elements.channelCountPill.textContent = `${channels.length} channel${channels.length === 1 ? '' : 's'}`;
      elements.qrStyle.value = social.qr.style;
      elements.qrPosition.value = social.qr.position;
      elements.qrSize.value = social.qr.size;
      elements.qrDisplay.value = social.qr.display;
      elements.socialHeading.value = social.heading;
      elements.qrColorText.value = social.qr.color;
      if (/^#[0-9a-f]{6}$/i.test(social.qr.color)) elements.qrColor.value = social.qr.color;

      if (channels.length === 0) {
        elements.channelEditor.innerHTML =
          '<p class="slot-empty">No channels yet. Add the first one above — the block stays off the public pages until there is one.</p>';
        renderQrPreview();
        return;
      }

      elements.channelEditor.innerHTML = channels
        .map(
          (channel, index) => `
          <div class="channel-row" data-id="${escapeHtml(channel.id)}">
            <span class="channel-rank">${index + 1}</span>
            <label class="field">
              <span class="field-label">Channel</span>
              <select class="channel-type">
                ${CHANNEL_ORDER.map(
                  (type) =>
                    `<option value="${type}"${type === channel.type ? ' selected' : ''}>${escapeHtml(channelName(type))}</option>`
                ).join('')}
              </select>
            </label>
            <label class="field channel-url-field">
              <span class="field-label">Link</span>
              <input type="url" class="channel-url" value="${escapeHtml(channel.url)}" placeholder="https://instagram.com/your-event" spellcheck="false">
            </label>
            <label class="field">
              <span class="field-label">Display name</span>
              <input type="text" class="channel-label" value="${escapeHtml(channel.label)}" maxlength="40" placeholder="${escapeHtml(channelName(channel.type))}">
            </label>
            <div class="channel-actions">
              <button type="button" class="btn btn-ghost channel-move" data-direction="-1" ${index === 0 ? 'disabled' : ''} aria-label="Move up">↑</button>
              <button type="button" class="btn btn-ghost channel-move" data-direction="1" ${index === channels.length - 1 ? 'disabled' : ''} aria-label="Move down">↓</button>
              <button type="button" class="btn btn-danger channel-remove">Remove</button>
            </div>
          </div>`
        )
        .join('');

      renderQrPreview();
    }

    function collectChannels() {
      const settings = context.getSettings();
      const channels = Array.from(elements.channelEditor.querySelectorAll('.channel-row')).map((row) => ({
        id: row.dataset.id,
        type: row.querySelector('.channel-type').value,
        url: row.querySelector('.channel-url').value.trim(),
        label: row.querySelector('.channel-label').value.trim(),
      }));

      return {
        ...settings,
        social: {
          heading: elements.socialHeading.value.trim(),
          channels,
          qr: {
            style: elements.qrStyle.value,
            position: elements.qrPosition.value,
            size: elements.qrSize.value,
            display: elements.qrDisplay.value,
            color: elements.qrColorText.value.trim(),
          },
        },
      };
    }

    /**
     * NEW: the block as the room will see it, redrawn on every change.
     *
     * Rendered by the same module the public pages use, so what is previewed
     * here is not an approximation of the result — it is the result.
     */
    function renderQrPreview() {
      if (!global.pickoraSocial) return;
      const draft = collectChannels();

      // Only channels with a usable link can be drawn; the rest are still
      // being typed.
      const ready = draft.social.channels.filter((channel) => /^https?:\/\/.+/i.test(channel.url) || /\./.test(channel.url));
      const preview = {
        ...draft,
        social: {
          ...draft.social,
          channels: ready.map((channel) => ({
            ...channel,
            url: /^https?:\/\//i.test(channel.url) ? channel.url : `https://${channel.url}`,
          })),
        },
      };

      elements.qrPreview.dataset.position = draft.social.qr.position;
      elements.qrPreview.innerHTML = '<div class="qr-preview-stage"><div class="social-block" id="qrPreviewBlock"></div></div>';
      global.pickoraSocial.render(elements.qrPreview.querySelector('#qrPreviewBlock'), preview);
    }

    function addChannel() {
      const draft = collectChannels();
      const next = draft.social.channels.length + 1;
      context.applySettings({
        ...draft,
        social: {
          ...draft.social,
          channels: [
            ...draft.social.channels,
            { id: `channel-${next}-${Math.random().toString(36).slice(2, 7)}`, type: 'instagram', url: '', label: '' },
          ],
        },
      });
    }

    function removeChannel(id) {
      if (!global.confirm('Remove this channel?')) return;
      const draft = collectChannels();
      context.applySettings({
        ...draft,
        social: { ...draft.social, channels: draft.social.channels.filter((channel) => channel.id !== id) },
      });
    }

    function moveChannel(id, direction) {
      const draft = collectChannels();
      const channels = [...draft.social.channels];
      const from = channels.findIndex((channel) => channel.id === id);
      const to = from + direction;
      if (from < 0 || to < 0 || to >= channels.length) return;

      [channels[from], channels[to]] = [channels[to], channels[from]];
      context.applySettings({ ...draft, social: { ...draft.social, channels } });
    }

    /* ------------------------------------------------------------ wiring */

    function bind() {
      elements.saveFieldsBtn.addEventListener('click', () => context.save(collectFields(), 'Fields saved.'));
      elements.revertFieldsBtn.addEventListener('click', renderFields);

      elements.saveDisplayBtn.addEventListener('click', () => context.save(collectDisplay(), 'Display saved.'));
      elements.revertDisplayBtn.addEventListener('click', () => {
        stopRevealSim();
        renderDisplay();
      });

      // NEW: the winner reveal timing.
      elements.revealDelay.addEventListener('input', () => {
        renderRevealDelay();
        // A rehearsal pacing the old value while the slider says a new one is
        // worse than no rehearsal, so it is dropped the moment this moves.
        stopRevealSim();
      });

      elements.resetRevealDelayBtn.addEventListener('click', () => {
        elements.revealDelay.value = String(REVEAL_DELAY_DEFAULT);
        renderRevealDelay();
        stopRevealSim();
      });

      elements.playRevealBtn.addEventListener('click', () => {
        if (elements.revealSim.dataset.phase === 'call') stopRevealSim();
        else playRevealSim();
      });

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
      /* NEW: text and media. Everything redraws the preview as it changes;
         only Save writes anything. */
      const textPanel = document.getElementById('panel-text');

      textPanel.addEventListener('input', (event) => {
        const field = event.target.closest('[data-text]');
        if (field) {
          const [scope, key] = field.dataset.text.split('.');
          const readout = document.querySelector(`[data-text-value="${scope}.${key}"]`);
          if (readout && TEXT_READOUTS[key]) readout.textContent = TEXT_READOUTS[key](Number(field.value) || 0);

          // Typing a hex keeps the swatch beside it in step.
          const swatch = document.querySelector(`[data-text-color="${scope}"]`);
          if (key === 'color' && swatch && /^#[0-9a-f]{6}$/i.test(field.value.trim())) {
            swatch.value = field.value.trim();
          }
        }

        const swatch = event.target.closest('[data-text-color]');
        if (swatch) {
          const target = textField(swatch.dataset.textColor, 'color');
          if (target) target.value = swatch.value;
        }

        if (event.target.id === 'prizeSlideMs') {
          document.getElementById('prizeSlideValue').textContent = `${(Number(event.target.value) / 1000).toFixed(1)}s`;
        }

        renderTextPreview();
      });

      textPanel.addEventListener('change', renderTextPreview);

      textPanel.addEventListener('click', (event) => {
        const tab = event.target.closest('[data-text-tab]');
        if (tab) {
          textPanel.querySelectorAll('[data-text-tab]').forEach((button) => {
            const active = button === tab;
            button.classList.toggle('is-active', active);
            button.setAttribute('aria-selected', String(active));
          });
          textPanel.querySelectorAll('[data-text-pane]').forEach((pane) => {
            pane.hidden = pane.dataset.textPane !== tab.dataset.textTab;
          });
          renderTextPreview();
          return;
        }

        const preset = event.target.closest('[data-text-preset]');
        if (preset) {
          const scope = preset.dataset.textPreset;
          writeTextStyle(scope, { ...readTextStyle(scope), ...TEXT_PRESETS[preset.dataset.size] });
          renderTextPreview();
          return;
        }

        const width = event.target.closest('[data-text-preview]');
        if (width) {
          document.getElementById('textPreview').dataset.width = width.dataset.textPreview;
          textPanel.querySelectorAll('[data-text-preview]').forEach((button) => {
            const active = button === width;
            button.classList.toggle('is-active', active);
            button.setAttribute('aria-pressed', String(active));
          });
          // The frame is drawn at the chosen screen's width, so the scale it is
          // shown at has to be worked out again for it.
          renderTextPreview();
        }
      });

      elements.saveTextBtn.addEventListener('click', () => context.save(collectText(), 'Text and media saved.'));
      elements.revertTextBtn.addEventListener('click', renderText);
      elements.resetTextBtn.addEventListener('click', () => {
        if (!global.confirm('Put the text styling and the prize photographs back to their defaults?')) return;
        TEXT_SCOPES.forEach((scope) => writeTextStyle(scope, TEXT_DEFAULTS));
        document.getElementById('prizeImageMode').value = PRIZE_MEDIA_DEFAULTS.imageMode;
        document.getElementById('prizeImageShape').value = PRIZE_MEDIA_DEFAULTS.shape;
        document.getElementById('prizeAutoplay').checked = PRIZE_MEDIA_DEFAULTS.autoplay;
        document.getElementById('prizeSlideMs').value = PRIZE_MEDIA_DEFAULTS.slideMs;
        document.getElementById('prizeTransition').value = PRIZE_MEDIA_DEFAULTS.transition;
        document.getElementById('prizeShowDots').checked = PRIZE_MEDIA_DEFAULTS.showDots;
        document.getElementById('prizeSlideValue').textContent = '3.0s';
        renderTextPreview();
        context.save(collectText(), 'Text and media reset.');
      });

      // NEW: board layout. Every slider redraws the preview as it moves; only
      // Save writes anything.
      elements.overlayOpacity.addEventListener('input', () => {
        elements.overlayValue.textContent = `${elements.overlayOpacity.value}%`;
        renderBoardPreview();
      });

      LAYOUT_SLIDERS.forEach((slider) => {
        layoutInput(slider.id).addEventListener('input', () => {
          layoutInput(`${slider.id}Value`).textContent = describeSize(
            Number(layoutInput(slider.id).value) || 0,
            slider.zeroIsAValue
          );
          renderBoardPreview();
        });
      });

      document.getElementById('panel-layout').addEventListener('click', (event) => {
        const preset = event.target.closest('[data-preset]');
        if (preset) {
          const values = LAYOUT_PRESETS[preset.dataset.preset][preset.dataset.size];
          applyLayoutValues({ overlayOpacity: elements.overlayOpacity.value, [preset.dataset.preset]: values });
          return;
        }

        if (event.target.closest('[data-reset="overlay"]')) {
          applyLayoutValues({ overlayOpacity: LAYOUT_DEFAULTS.overlayOpacity });
          return;
        }

        const width = event.target.closest('[data-preview]');
        if (width) {
          elements.boardPreview.dataset.width = width.dataset.preview;
          document.querySelectorAll('#panel-layout [data-preview]').forEach((button) => {
            const active = button === width;
            button.classList.toggle('is-active', active);
            button.setAttribute('aria-pressed', String(active));
          });
          renderBoardPreview();
        }
      });

      elements.saveLayoutBtn.addEventListener('click', () => context.save(collectLayout(), 'Board layout saved.'));
      elements.revertLayoutBtn.addEventListener('click', renderLayout);
      elements.resetLayoutBtn.addEventListener('click', () => {
        if (!global.confirm('Put the reel, the buttons and the darkening back to their defaults?')) return;
        applyLayoutValues(LAYOUT_DEFAULTS);
        context.save(collectLayout(), 'Board layout reset.');
      });

      // NEW: channels. An unsaved link is worth keeping while it is typed, so
      // edits stay local and only the preview follows them live.
      elements.addChannelBtn.addEventListener('click', addChannel);
      elements.saveChannelsBtn.addEventListener('click', () => context.save(collectChannels(), 'Channels saved.'));
      elements.revertChannelsBtn.addEventListener('click', renderChannels);

      elements.channelEditor.addEventListener('click', (event) => {
        const row = event.target.closest('.channel-row');
        if (!row) return;
        if (event.target.closest('.channel-remove')) return removeChannel(row.dataset.id);
        const move = event.target.closest('.channel-move');
        if (move) moveChannel(row.dataset.id, Number(move.dataset.direction));
        return undefined;
      });

      // Typing a link redraws the preview; changing the channel updates the
      // placeholder name alongside it.
      elements.channelEditor.addEventListener('input', renderQrPreview);
      elements.channelEditor.addEventListener('change', renderQrPreview);

      [elements.qrStyle, elements.qrPosition, elements.qrSize, elements.qrDisplay].forEach((control) =>
        control.addEventListener('change', renderQrPreview)
      );
      elements.socialHeading.addEventListener('input', renderQrPreview);
      elements.qrColorText.addEventListener('input', () => {
        if (/^#[0-9a-f]{6}$/i.test(elements.qrColorText.value.trim())) {
          elements.qrColor.value = elements.qrColorText.value.trim();
        }
        renderQrPreview();
      });
      elements.qrColor.addEventListener('input', () => {
        elements.qrColorText.value = elements.qrColor.value;
        renderQrPreview();
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
        renderChannels(); // NEW
        renderLayout();   // NEW
        renderText();     // NEW
      },
    };
  }

  global.createConfigEditors = createConfigEditors;
})(window, document);

/**
 * Organiser console.
 *
 * Everything behind the sign-in gate: draw supervision, participant upload,
 * board settings and credentials. The server enforces the session on every
 * endpoint — this script only decides what to show.
 */
(function console_(global, document) {
  'use strict';

  const api = global.lotteryApi;

  const elements = {
    gate: document.getElementById('gate'),
    shell: document.getElementById('console'),
    toast: document.getElementById('toast'),

    loginForm: document.getElementById('loginForm'),
    loginUsername: document.getElementById('loginUsername'),
    loginPassword: document.getElementById('loginPassword'),
    loginError: document.getElementById('loginError'),
    loginSubmit: document.getElementById('loginSubmit'),

    brandEvent: document.getElementById('brandEvent'),
    currentUser: document.getElementById('currentUser'),
    logoutBtn: document.getElementById('logoutBtn'),
    defaultPasswordBanner: document.getElementById('defaultPasswordBanner'),
    envCredentialsBanner: document.getElementById('envCredentialsBanner'),

    metrics: document.getElementById('metrics'),
    dataHealthCard: document.getElementById('dataHealthCard'),
    dataHealth: document.getElementById('dataHealth'),
    winnersHead: document.getElementById('winnersHead'),
    winnersBody: document.getElementById('winnersBody'),
    refreshBtn: document.getElementById('refreshBtn'),
    undoBtn: document.getElementById('undoBtn'),
    resetBtn: document.getElementById('resetBtn'),

    uploadDrop: document.getElementById('uploadDrop'),
    fileInput: document.getElementById('fileInput'),
    uploadBtn: document.getElementById('uploadBtn'),
    uploadSummary: document.getElementById('uploadSummary'),
    ticketCountPill: document.getElementById('ticketCountPill'),
    sampleHead: document.getElementById('sampleHead'),
    sampleBody: document.getElementById('sampleBody'),
    uploadSchema: document.getElementById('uploadSchema'),
    clearEntriesBtn: document.getElementById('clearEntriesBtn'),
    schemaPreviewBody: document.getElementById('schemaPreviewBody'),
    sampleFoot: document.getElementById('sampleFoot'),

    settingsForm: document.getElementById('settingsForm'),
    revertSettingsBtn: document.getElementById('revertSettingsBtn'),
    saveSettingsBtn: document.getElementById('saveSettingsBtn'),

    accountUsername: document.getElementById('accountUsername'),
    passwordForm: document.getElementById('passwordForm'),
    passwordError: document.getElementById('passwordError'),
  };

  const state = { overview: null, pendingUpload: null, chosenIdentifier: null };
  let configEditors = null;

  /* ------------------------------------------------------------- utilities */

  function escapeHtml(value) {
    return String(value === null || value === undefined ? '' : value).replace(
      /[&<>"']/g,
      (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]
    );
  }

  function toast(message, tone = 'success') {
    elements.toast.textContent = message;
    elements.toast.dataset.tone = tone;
    elements.toast.hidden = false;
    clearTimeout(toast.timerId);
    toast.timerId = setTimeout(() => {
      elements.toast.hidden = true;
    }, 5000);
  }

  function showFieldError(element, message) {
    element.textContent = message;
    element.hidden = !message;
  }

  function readPath(source, path) {
    return path.split('.').reduce((value, key) => (value == null ? undefined : value[key]), source);
  }

  /** Builds a nested object from dotted form-field names without mutating anything. */
  function writePath(target, path, value) {
    const [head, ...rest] = path.split('.');
    if (rest.length === 0) return { ...target, [head]: value };
    return { ...target, [head]: writePath(target[head] || {}, rest.join('.'), value) };
  }

  function formatTimestamp(value) {
    if (!value) return '—';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
  }

  async function withBusyButton(button, action) {
    const originalText = button.textContent;
    button.disabled = true;
    try {
      return await action();
    } finally {
      button.disabled = false;
      button.textContent = originalText;
    }
  }

  /* ------------------------------------------------------------------ auth */

  function showGate() {
    elements.gate.hidden = false;
    elements.shell.hidden = true;
    elements.loginUsername.focus();
  }

  function showConsole() {
    elements.gate.hidden = true;
    elements.shell.hidden = false;
  }

  async function handleLogin(event) {
    event.preventDefault();
    showFieldError(elements.loginError, '');

    const username = elements.loginUsername.value.trim();
    const password = elements.loginPassword.value;

    if (!username || !password) {
      showFieldError(elements.loginError, 'Enter both a username and a password.');
      return;
    }

    await withBusyButton(elements.loginSubmit, async () => {
      elements.loginSubmit.textContent = 'Signing in…';
      try {
        await api.login(username, password);
        elements.loginPassword.value = '';
        showConsole();
        await loadOverview();
      } catch (error) {
        showFieldError(elements.loginError, error.message);
      }
    });
  }

  async function handleLogout() {
    try {
      await api.logout();
    } catch (_error) {
      /* signing out locally is still the right outcome */
    }
    state.overview = null;
    showGate();
  }

  /* -------------------------------------------------------------- overview */

  function renderMetrics(overview) {
    const { stats } = overview;
    const cards = [
      { label: 'Participants', value: stats.totalTickets, note: `${stats.remainingTickets} still in the pool` },
      { label: 'Prizes', value: stats.totalPrizes, note: `${stats.remainingPrizes} remaining`, tone: 'accent' },
      { label: 'Drawn', value: stats.winnersCount, tone: stats.winnersCount > 0 ? 'good' : undefined },
      { label: 'Draw started', value: overview.startedAt ? formatTimestamp(overview.startedAt).split(',')[0] : '—', small: true },
    ];

    elements.metrics.innerHTML = cards
      .map(
        (card) => `
        <article class="metric">
          <p class="metric-label">${escapeHtml(card.label)}</p>
          <p class="metric-value"${card.tone ? ` data-tone="${card.tone}"` : ''}${card.small ? ' style="font-size:1.05rem"' : ''}>${escapeHtml(card.value)}</p>
          ${card.note ? `<p class="metric-note">${escapeHtml(card.note)}</p>` : ''}
        </article>`
      )
      .join('');
  }

  function renderDataHealth(data) {
    const notes = [];

    const identifierField = state.overview
      ? state.overview.appSettings.data.fields.find((field) => field.key === state.overview.appSettings.data.identifier)
      : null;
    const identifierLabel = identifierField ? identifierField.label : 'identifier';

    if (data.issues.duplicates > 0) {
      notes.push(
        `<strong>${data.issues.duplicates}</strong> row(s) repeat a ${escapeHtml(identifierLabel)} already in the list and were ignored, so the same entry cannot be drawn twice.`
      );
    }
    if (data.issues.missingIdentifier > 0) {
      notes.push(`<strong>${data.issues.missingIdentifier}</strong> row(s) have no ${escapeHtml(identifierLabel)} and were ignored.`);
    }
    if (data.issues.truncated) {
      notes.push('The list hit the maximum size and was truncated.');
    }
    if (notes.length > 0) {
      notes.push(`The file holds <strong>${data.rawCount}</strong> rows; <strong>${data.ticketCount}</strong> are in play.`);
    }

    elements.dataHealthCard.hidden = notes.length === 0;
    elements.dataHealth.innerHTML = notes.map((note) => `<li>${note}</li>`).join('');
  }

  /** Columns follow the configured field schema, whatever the event uses. */
  function resultColumns(appSettings) {
    return [
      { key: 'prizeNumber', label: '#', className: 'num' },
      ...appSettings.data.fields.map((field, index) => ({
        key: field.key,
        label: field.label,
        className: index === 0 ? 'ticket' : '',
      })),
      { key: 'drawnAt', label: 'Drawn at', format: formatTimestamp },
    ];
  }

  function renderTableHead(thead, columns) {
    thead.innerHTML = `<tr>${columns.map((column) => `<th>${escapeHtml(column.label)}</th>`).join('')}</tr>`;
  }

  function renderTable(tbody, rows, columns, emptyMessage) {
    if (rows.length === 0) {
      tbody.innerHTML = `<tr class="table-empty"><td colspan="${columns.length}">${escapeHtml(emptyMessage)}</td></tr>`;
      return;
    }

    tbody.innerHTML = rows
      .map(
        (row) => `
        <tr>
          ${columns
            .map((column) => {
              const value = column.format ? column.format(row[column.key]) : row[column.key];
              return `<td class="${column.className || ''}">${escapeHtml(value) || '&mdash;'}</td>`;
            })
            .join('')}
        </tr>`
      )
      .join('');
  }

  function renderWinners(winners, appSettings) {
    const columns = resultColumns(appSettings);
    const rows = winners
      .slice()
      .reverse()
      .map((winner) => ({ prizeNumber: winner.prizeNumber, drawnAt: winner.drawnAt, ...winner.record }));

    renderTableHead(elements.winnersHead, columns);
    renderTable(elements.winnersBody, rows, columns, 'No draws yet.');
  }

  function renderParticipants(data, appSettings) {
    elements.ticketCountPill.textContent = `${data.ticketCount} ${data.ticketCount === 1 ? 'entry' : 'entries'}`;

    const columns = appSettings.data.fields.map((field, index) => ({
      key: field.key,
      label: field.label,
      className: index === 0 ? 'ticket' : '',
    }));

    renderTableHead(elements.sampleHead, columns);
    renderTable(elements.sampleBody, data.sample, columns, 'No entries uploaded yet.');
    elements.sampleFoot.textContent =
      data.sample.length > 0 ? `Showing the first ${data.sample.length} of ${data.ticketCount}.` : '';
  }

  /** The cap differs between a filesystem and a key-value deployment. */
  function renderUploadLimits(limits) {
    if (!limits) return;
    const megabytes = Math.round(limits.maxUploadBytes / 1048576);
    document.querySelectorAll('[data-upload-limit]').forEach((element) => {
      element.textContent = `${megabytes} MB`;
    });
  }

  function renderAccount(account, appSettings) {
    const isEnvManaged = account.credentialSource === 'environment';

    elements.brandEvent.textContent = appSettings.eventName;
    elements.currentUser.textContent = account.username;
    elements.accountUsername.value = account.username;
    elements.defaultPasswordBanner.hidden = !account.usingDefaultPassword;
    elements.envCredentialsBanner.hidden = !isEnvManaged;

    Array.from(elements.passwordForm.elements).forEach((field) => {
      field.disabled = isEnvManaged;
    });
  }

  function render(overview) {
    state.overview = overview;
    renderMetrics(overview);
    renderDataHealth(overview.data);
    renderWinners(overview.winners, overview.appSettings);
    renderParticipants(overview.data, overview.appSettings);
    renderAccount(overview.account, overview.appSettings);
    renderUploadLimits(overview.limits);
    fillSettingsForm(overview.appSettings);
    if (configEditors) configEditors.render();
    elements.undoBtn.disabled = overview.winners.length === 0;
  }

  async function loadOverview() {
    try {
      render(await api.getOverview());
    } catch (error) {
      if (error.status === 401) {
        showGate();
        return;
      }
      toast(error.message, 'error');
    }
  }

  /* ---------------------------------------------------------- draw actions */

  async function handleUndo() {
    const last = state.overview && state.overview.winners[state.overview.winners.length - 1];
    if (!last) return;

    const confirmed = global.confirm(
      `Remove the most recent draw?\n\nPrize ${last.prizeNumber} — ${last.ticket}${last.name ? ` (${last.name})` : ''}\n\n` +
        'The ticket goes back into the pool and can be drawn again.'
    );
    if (!confirmed) return;

    await withBusyButton(elements.undoBtn, async () => {
      try {
        await api.undoLastDraw();
        toast('The last draw was removed.');
        await loadOverview();
      } catch (error) {
        toast(error.message, 'error');
      }
    });
  }

  async function handleReset() {
    const count = state.overview ? state.overview.winners.length : 0;
    const confirmed = global.confirm(
      `Reset the draw?\n\nThis clears all ${count} recorded winner(s) and returns every ticket to the pool.\n\nThis cannot be undone — export the results first if you need them.`
    );
    if (!confirmed) return;

    await withBusyButton(elements.resetBtn, async () => {
      try {
        await api.resetDraw();
        toast('The draw was reset.');
        await loadOverview();
      } catch (error) {
        toast(error.message, 'error');
      }
    });
  }

  /* ---------------------------------------------------------------- upload */

  function renderSchemaPreview(preview) {
    state.chosenIdentifier = preview.schema.identifier;
    const first = preview.sample[0] || {};

    elements.schemaPreviewBody.innerHTML = preview.schema.fields
      .map(
        (field) => `
        <tr>
          <td><input type="radio" name="previewIdentifier" value="${escapeHtml(field.key)}" ${field.key === preview.schema.identifier ? 'checked' : ''}></td>
          <td>${escapeHtml(field.label)}${field.sensitive ? ' <span class="tag-sensitive">sensitive</span>' : ''}</td>
          <td class="ticket">${escapeHtml(field.key)}</td>
          <td>${escapeHtml(first[field.key]) || '&mdash;'}</td>
        </tr>`
      )
      .join('');

    elements.uploadSchema.hidden = false;
  }

  async function describeUpload(file, text) {
    const format = /\.json$/i.test(file.name) ? 'json' : /\.csv$/i.test(file.name) ? 'csv' : undefined;
    state.pendingUpload = { name: file.name, content: text, format };

    elements.uploadSummary.hidden = false;
    elements.uploadSummary.innerHTML = `<strong>${escapeHtml(file.name)}</strong> — reading columns…`;
    elements.uploadBtn.disabled = true;

    try {
      const preview = await api.previewTickets({ content: text, format });
      const dropped = preview.issues.duplicates + preview.issues.missingIdentifier;

      elements.uploadSummary.innerHTML = `
        <strong>${escapeHtml(file.name)}</strong> is ready to import.
        <dl>
          <dt>Size</dt><dd>${(file.size / 1024).toFixed(1)} KB</dd>
          <dt>Format</dt><dd>${escapeHtml(preview.format)}</dd>
          <dt>Columns</dt><dd>${preview.columns.length}</dd>
          <dt>Usable rows</dt><dd>${preview.count}</dd>
          ${dropped > 0 ? `<dt>Skipped</dt><dd>${dropped}</dd>` : ''}
        </dl>`;

      renderSchemaPreview(preview);
      elements.uploadBtn.disabled = false;
    } catch (error) {
      elements.uploadSummary.innerHTML = `<strong>${escapeHtml(file.name)}</strong> could not be read: ${escapeHtml(error.message)}`;
      elements.uploadSchema.hidden = true;
    }
  }

  function readFile(file) {
    if (!file) return;
    if (file.size > 20 * 1024 * 1024) {
      toast('That file is larger than 20 MB.', 'error');
      return;
    }

    const reader = new FileReader();
    reader.onload = () => describeUpload(file, String(reader.result));
    reader.onerror = () => toast('The file could not be read.', 'error');
    reader.readAsText(file);
  }

  async function submitUpload(force = false) {
    if (!state.pendingUpload) return;

    const selectedMode = document.querySelector('input[name="uploadMode"]:checked');
    const mode = selectedMode ? selectedMode.value : 'replace';
    const selectedIdentifier = document.querySelector('input[name="previewIdentifier"]:checked');

    await withBusyButton(elements.uploadBtn, async () => {
      elements.uploadBtn.textContent = 'Importing…';
      try {
        const result = await api.uploadTickets({
          content: state.pendingUpload.content,
          format: state.pendingUpload.format,
          identifier: selectedIdentifier ? selectedIdentifier.value : undefined,
          mode,
          force,
        });

        const dropped = result.issues.duplicates + result.issues.missingIdentifier;
        toast(
          `Imported ${result.imported} entr${result.imported === 1 ? 'y' : 'ies'}. The list now holds ${result.ticketCount}.` +
            (dropped > 0 ? ` ${dropped} row(s) were skipped — see Data health.` : '')
        );

        state.pendingUpload = null;
        elements.fileInput.value = '';
        elements.uploadSummary.hidden = true;
        elements.uploadSchema.hidden = true;
        elements.uploadBtn.disabled = true;
        await loadOverview();
      } catch (error) {
        if (error.payload && error.payload.reason === 'draw-in-progress') {
          if (global.confirm(`${error.message}\n\nReplace the participant list anyway?`)) {
            await submitUpload(true);
          }
          return;
        }
        toast(error.message, 'error');
      }
    });
  }

  async function clearEntries(force = false) {
    const count = state.overview ? state.overview.data.ticketCount : 0;
    if (!force && !global.confirm(`Delete all ${count} entr${count === 1 ? 'y' : 'ies'}?\n\nThe list is emptied and cannot be recovered — export it first if you need a copy.`)) {
      return;
    }

    await withBusyButton(elements.clearEntriesBtn, async () => {
      try {
        await api.clearTickets(force);
        toast('All entries deleted.');
        await loadOverview();
      } catch (error) {
        if (error.payload && error.payload.reason === 'draw-in-progress') {
          if (global.confirm(`${error.message}\n\nDelete the entries anyway?`)) await clearEntries(true);
          return;
        }
        toast(error.message, 'error');
      }
    });
  }

  function bindUpload() {
    elements.fileInput.addEventListener('change', (event) => readFile(event.target.files[0]));
    elements.uploadBtn.addEventListener('click', () => submitUpload(false));
    elements.clearEntriesBtn.addEventListener('click', () => clearEntries(false));

    ['dragenter', 'dragover'].forEach((eventName) => {
      elements.uploadDrop.addEventListener(eventName, (event) => {
        event.preventDefault();
        elements.uploadDrop.classList.add('is-dragging');
      });
    });

    ['dragleave', 'drop'].forEach((eventName) => {
      elements.uploadDrop.addEventListener(eventName, (event) => {
        event.preventDefault();
        elements.uploadDrop.classList.remove('is-dragging');
      });
    });

    elements.uploadDrop.addEventListener('drop', (event) => {
      readFile(event.dataTransfer.files[0]);
    });
  }

  /* -------------------------------------------------------------- settings */

  const SETTINGS_TEXT_FIELDS = [
    'eventName',
    'organizationName',
    'locale',
    'direction',
    'ui.backgroundColor',
    'ui.boardAlignment',
  ];
  const SETTINGS_NUMBER_FIELDS = [
    'totalPrizes',
    'animation.rollingSpeed',
    'animation.confettiDuration',
    'animation.confettiCount',
    'animation.winnerAnnouncementDelay',
    'animation.confettiStartDelay',
    'draw.minimumRollMs',
  ];
  const SETTINGS_BOOLEAN_FIELDS = [
    'display.autoStopWhenPrizesExhausted',
    'ui.showOrganizationName',
    'ui.showWinnersPanel',
    'ui.showStats',
    'draw.publicDrawEnabled',
    'draw.requireAuthForDraw',
    'draw.allowResetFromBoard',
  ];

  function field(name) {
    return elements.settingsForm.elements.namedItem(name);
  }

  function fillSettingsForm(appSettings) {
    [...SETTINGS_TEXT_FIELDS, ...SETTINGS_NUMBER_FIELDS].forEach((name) => {
      const input = field(name);
      if (input) input.value = readPath(appSettings, name);
    });

    SETTINGS_BOOLEAN_FIELDS.forEach((name) => {
      const input = field(name);
      if (input) input.checked = Boolean(readPath(appSettings, name));
    });

    field('animation.confettiPalette').value = appSettings.animation.confettiPalette.join(', ');

    // The colour picker only accepts #rrggbb, so the text input stays the
    // source of truth for named colours or other CSS values.
    const colorValue = appSettings.ui.primaryColor;
    field('ui.primaryColorText').value = colorValue;
    if (/^#[0-9a-f]{6}$/i.test(colorValue)) {
      field('ui.primaryColor').value = colorValue;
    }
  }

  function collectSettings() {
    const base = state.overview ? state.overview.appSettings : {};

    let next = SETTINGS_TEXT_FIELDS.reduce(
      (accumulator, name) => writePath(accumulator, name, field(name).value.trim()),
      base
    );

    next = SETTINGS_NUMBER_FIELDS.reduce(
      (accumulator, name) => writePath(accumulator, name, Number(field(name).value)),
      next
    );

    next = SETTINGS_BOOLEAN_FIELDS.reduce(
      (accumulator, name) => writePath(accumulator, name, field(name).checked),
      next
    );

    const palette = field('animation.confettiPalette')
      .value.split(',')
      .map((color) => color.trim())
      .filter(Boolean);

    next = writePath(next, 'animation.confettiPalette', palette);
    return writePath(next, 'ui.primaryColor', field('ui.primaryColorText').value.trim());
  }

  async function handleSettingsSubmit(event) {
    event.preventDefault();
    if (!elements.settingsForm.reportValidity()) return;

    await withBusyButton(elements.saveSettingsBtn, async () => {
      elements.saveSettingsBtn.textContent = 'Saving…';
      try {
        const result = await api.saveSettings(collectSettings());
        toast('Settings saved. Reload the draw board to apply them.');
        fillSettingsForm(result.appSettings);
        state.overview = { ...state.overview, appSettings: result.appSettings };
        elements.brandEvent.textContent = result.appSettings.eventName;
      } catch (error) {
        toast(error.message, 'error');
      }
    });
  }

  function bindSettings() {
    elements.settingsForm.addEventListener('submit', handleSettingsSubmit);
    elements.revertSettingsBtn.addEventListener('click', () => {
      if (state.overview) fillSettingsForm(state.overview.appSettings);
    });

    field('ui.primaryColor').addEventListener('input', (event) => {
      field('ui.primaryColorText').value = event.target.value;
    });

    field('ui.primaryColorText').addEventListener('change', (event) => {
      if (/^#[0-9a-f]{6}$/i.test(event.target.value.trim())) {
        field('ui.primaryColor').value = event.target.value.trim();
      }
    });
  }

  /* --------------------------------------------------------------- account */

  async function handlePasswordSubmit(event) {
    event.preventDefault();
    showFieldError(elements.passwordError, '');

    const form = new FormData(elements.passwordForm);
    const newPassword = String(form.get('newPassword'));

    if (newPassword !== String(form.get('confirmPassword'))) {
      showFieldError(elements.passwordError, 'The two new passwords do not match.');
      return;
    }
    if (newPassword.length < 8) {
      showFieldError(elements.passwordError, 'Choose a password of at least 8 characters.');
      return;
    }

    try {
      await api.changePassword({
        username: String(form.get('username')).trim(),
        currentPassword: String(form.get('currentPassword')),
        newPassword,
      });
      elements.passwordForm.reset();
      toast('Sign-in details updated.');
      await loadOverview();
    } catch (error) {
      showFieldError(elements.passwordError, error.message);
    }
  }

  /* ------------------------------------------------- configurable editors */

  /** Persists a whole settings object edited by one of the config panels. */
  async function saveConfiguration(appSettings, message) {
    try {
      const result = await api.saveSettings(appSettings);
      state.overview = { ...state.overview, appSettings: result.appSettings };
      if (configEditors) configEditors.render();
      fillSettingsForm(result.appSettings);
      elements.brandEvent.textContent = result.appSettings.eventName;
      toast(message);
    } catch (error) {
      toast(error.message, 'error');
    }
  }

  function createEditorContext() {
    return {
      getSettings: () => state.overview.appSettings,
      applySettings(appSettings) {
        state.overview = { ...state.overview, appSettings };
        if (configEditors) configEditors.render();
      },
      save: saveConfiguration,
      toast,
    };
  }

  /* ------------------------------------------------------------------- nav */

  function bindNavigation() {
    document.querySelectorAll('.nav-item').forEach((button) => {
      button.addEventListener('click', () => {
        const target = button.dataset.panel;

        document.querySelectorAll('.nav-item').forEach((item) => {
          item.classList.toggle('is-active', item === button);
        });

        document.querySelectorAll('.panel').forEach((panel) => {
          panel.hidden = panel.id !== `panel-${target}`;
        });
      });
    });
  }

  /* ------------------------------------------------------------------ boot */

  async function init() {
    elements.loginForm.addEventListener('submit', handleLogin);
    elements.logoutBtn.addEventListener('click', handleLogout);
    elements.refreshBtn.addEventListener('click', loadOverview);
    elements.undoBtn.addEventListener('click', handleUndo);
    elements.resetBtn.addEventListener('click', handleReset);
    elements.passwordForm.addEventListener('submit', handlePasswordSubmit);

    bindNavigation();
    bindUpload();
    bindSettings();

    configEditors = global.createConfigEditors(createEditorContext());
    configEditors.bind();

    try {
      const session = await api.getSession();
      if (!session.authenticated) {
        showGate();
        return;
      }
      showConsole();
      await loadOverview();
    } catch (error) {
      showGate();
      showFieldError(elements.loginError, error.message);
    }
  }

  document.addEventListener('DOMContentLoaded', init);
})(window, document);

/**
 * Console: the Certificate panel.
 *
 * Every word and every part of the printed certificate is configured here.
 * The preview is the certificate page itself, in a frame, sent each unsaved
 * change as it is made — so the preview is the document, not a likeness of it.
 */
(function certificatePanel(global, document) {
  'use strict';

  const features = global.PickoraConsoleFeatures;
  if (!features) return;

  const MAX_SIGNATORIES = 6;
  const MAX_FIELDS = 8;

  features.register(function createCertificatePanel(context, helpers) {
    const { escapeHtml, busy } = helpers;
    const $ = (id) => document.getElementById(id);

    const TOGGLES = {
      enabled: 'certEnabled',
      showLogo: 'certShowLogo',
      showOrganization: 'certShowOrganization',
      showPrizes: 'certShowPrizes',
      showAbsent: 'certShowAbsent',
      showEntryCount: 'certShowEntries',
      showTimestamps: 'certShowTimestamps',
      showMethod: 'certShowMethod',
      showFingerprint: 'certShowFingerprint',
      maskSensitive: 'certMask',
    };
    const TEXTS = {
      title: 'certTitle',
      subtitle: 'certSubtitle',
      venue: 'certVenue',
      referencePrefix: 'certPrefix',
      statement: 'certStatement',
      methodText: 'certMethod',
      footerNote: 'certFooter',
      paper: 'certPaper',
      orientation: 'certOrientation',
    };

    const elements = {
      fields: $('certFields'),
      signatories: $('signatoryList'),
      addSignatory: $('addSignatoryBtn'),
      accent: $('certAccent'),
      accentText: $('certAccentText'),
      frame: $('certificatePreview'),
      open: $('openCertificateBtn'),
      save: $('saveCertificateBtn'),
      revert: $('revertCertificateBtn'),
      panel: $('panel-certificate'),
    };

    let frameLoaded = false;

    /* --------------------------------------------------------------- render */

    function renderFields(certificate) {
      const { fields } = context.getSettings().data;
      elements.fields.innerHTML = `<legend class="field-label">Columns printed for each winner <small>(up to ${MAX_FIELDS})</small></legend>${fields
        .map(
          (field) => `
          <label><input type="checkbox" value="${escapeHtml(field.key)}"${certificate.fields.includes(field.key) ? ' checked' : ''}>
            ${escapeHtml(field.label)}${field.sensitive ? ' <span class="tag-sensitive">sensitive</span>' : ''}</label>`
        )
        .join('')}`;
    }

    function signatoryRow(person) {
      return `
        <div class="signatory-row">
          <label class="field"><span class="field-label">Name</span>
            <input type="text" class="signatory-name" maxlength="80" value="${escapeHtml(person.name)}" placeholder="Left blank to sign by hand"></label>
          <label class="field"><span class="field-label">Role</span>
            <input type="text" class="signatory-role" maxlength="80" value="${escapeHtml(person.role)}" placeholder="Organiser, witness, inspector…"></label>
          <button type="button" class="btn btn-danger btn-small signatory-remove" aria-label="Remove this signature line">Remove</button>
        </div>`;
    }

    function renderSignatories(list) {
      elements.signatories.innerHTML = list.length
        ? list.map(signatoryRow).join('')
        : '<p class="slot-empty">No signature lines. Add one for each person who signs.</p>';
      elements.addSignatory.disabled = list.length >= MAX_SIGNATORIES;
    }

    function render() {
      const certificate = context.getSettings().certificate;
      Object.entries(TOGGLES).forEach(([key, id]) => {
        $(id).checked = Boolean(certificate[key]);
      });
      Object.entries(TEXTS).forEach(([key, id]) => {
        $(id).value = certificate[key];
      });
      elements.accentText.value = certificate.accentColor;
      if (/^#[0-9a-f]{6}$/i.test(certificate.accentColor)) elements.accent.value = certificate.accentColor;
      renderFields(certificate);
      renderSignatories(certificate.signatories);
      elements.open.hidden = !certificate.enabled;
      sendDraft();
    }

    /* -------------------------------------------------------------- collect */

    function readSignatories() {
      return Array.from(elements.signatories.querySelectorAll('.signatory-row')).map((row) => ({
        name: row.querySelector('.signatory-name').value.trim(),
        role: row.querySelector('.signatory-role').value.trim(),
      }));
    }

    function collect() {
      const certificate = context.getSettings().certificate;
      const toggles = Object.fromEntries(Object.entries(TOGGLES).map(([key, id]) => [key, $(id).checked]));
      const texts = Object.fromEntries(Object.entries(TEXTS).map(([key, id]) => [key, $(id).value.trim()]));
      const fields = Array.from(elements.fields.querySelectorAll('input:checked')).map((input) => input.value).slice(0, MAX_FIELDS);

      return {
        ...certificate,
        ...toggles,
        ...texts,
        fields: fields.length ? fields : certificate.fields,
        signatories: readSignatories().filter((person) => person.name || person.role),
        accentColor: elements.accentText.value.trim(),
      };
    }

    /* -------------------------------------------------------------- preview */

    function sendDraft() {
      if (!frameLoaded || !elements.frame.contentWindow) return;
      elements.frame.contentWindow.postMessage({ type: 'pickora-certificate-draft', certificate: collect() }, global.location.origin);
    }

    /** The frame loads only once the panel is opened, and then stays. */
    function ensureFrame() {
      if (elements.frame.dataset.src) return;
      elements.frame.dataset.src = '/certificate?preview=1';
      elements.frame.addEventListener('load', () => {
        frameLoaded = true;
        sendDraft();
      });
      elements.frame.src = elements.frame.dataset.src;
    }

    function reloadFrame() {
      if (frameLoaded) elements.frame.contentWindow.postMessage({ type: 'pickora-certificate-reload' }, global.location.origin);
    }

    /* --------------------------------------------------------------- wiring */

    function bind() {
      elements.panel.addEventListener('input', sendDraft);
      elements.panel.addEventListener('change', (event) => {
        if (event.target.closest('#certFields')) {
          const checked = elements.fields.querySelectorAll('input:checked');
          if (checked.length > MAX_FIELDS) {
            event.target.checked = false;
            context.toast(`At most ${MAX_FIELDS} columns fit on the page.`, 'error');
          }
        }
        sendDraft();
      });

      elements.accent.addEventListener('input', () => {
        elements.accentText.value = elements.accent.value;
        sendDraft();
      });

      elements.addSignatory.addEventListener('click', () => {
        const list = readSignatories();
        if (list.length >= MAX_SIGNATORIES) return;
        renderSignatories([...list, { name: '', role: '' }]);
        sendDraft();
      });
      elements.signatories.addEventListener('click', (event) => {
        const remove = event.target.closest('.signatory-remove');
        if (!remove) return;
        remove.closest('.signatory-row').remove();
        renderSignatories(readSignatories());
        sendDraft();
      });

      // Load the preview the first time the panel is shown.
      document.querySelectorAll('.nav-item[data-panel="certificate"]').forEach((button) => {
        button.addEventListener('click', () => {
          ensureFrame();
          reloadFrame();
        });
      });

      elements.save.addEventListener('click', () =>
        busy(elements.save, 'Saving…', () =>
          context
            .save({ ...context.getSettings(), certificate: collect() }, 'Certificate saved.')
            .then(reloadFrame)
            .catch(() => {})
        )
      );
      elements.revert.addEventListener('click', () => context.reload());
    }

    return { bind, render };
  });
})(window, document);

/**
 * Console: the Draw style panel — reel or wheel, and every setting of the
 * wheel, with a live preview drawn by the board's own wheel (wheel.js).
 */
(function wheelPanel(global, document) {
  'use strict';

  const features = global.PickoraConsoleFeatures;
  if (!features) return;

  const SAMPLE = ['A-101', 'B-202', 'C-303', 'D-404', 'E-505', 'F-606', 'G-707', 'H-808'];

  features.register(function createWheelPanel(context, helpers) {
    const { escapeHtml, numberFrom, busy } = helpers;
    const $ = (id) => document.getElementById(id);

    const elements = {
      segments: $('wheelSegments'),
      labelField: $('wheelLabelField'),
      speed: $('wheelSpeed'),
      speedValue: $('wheelSpeedValue'),
      settle: $('wheelSettle'),
      pointer: $('wheelPointer'),
      size: $('wheelSize'),
      fontSize: $('wheelFontSize'),
      centerText: $('wheelCenterText'),
      palette: $('wheelPalette'),
      textColor: $('wheelTextColor'),
      borderColor: $('wheelBorderColor'),
      showLabels: $('wheelShowLabels'),
      centerLogo: $('wheelCenterLogo'),
      preview: $('wheelPreview'),
      test: $('wheelTestBtn'),
      save: $('saveWheelBtn'),
      revert: $('revertWheelBtn'),
      panel: $('panel-wheel'),
    };

    let wheel = null;
    let testing = false;

    /** Labels for the preview: real entries when there are some. */
    function sampleEntries(field) {
      const overview = context.getOverview();
      const sample = overview && overview.data && overview.data.sample;
      if (sample && sample.length && field) return sample.map((record) => ({ label: String(record[field] || '') })).filter((entry) => entry.label);
      return SAMPLE.map((label) => ({ label }));
    }

    /** Fields the board shows, and never sensitive ones — what may go on a segment. */
    function eligibleFields(settings) {
      const shown = new Set(['reel', 'call', 'card', 'panel'].flatMap((slot) => settings.display[slot].lines.map((line) => line.field)));
      return settings.data.fields.filter((field) => !field.sensitive && shown.has(field.key));
    }

    function render() {
      const settings = context.getSettings();
      const current = settings.wheel;
      elements.panel.querySelectorAll('input[name="wheelStyle"]').forEach((input) => {
        input.checked = input.value === current.style;
      });
      elements.labelField.innerHTML = `<option value="">Same as the reel</option>${eligibleFields(settings)
        .map((field) => `<option value="${escapeHtml(field.key)}"${field.key === current.labelField ? ' selected' : ''}>${escapeHtml(field.label)}</option>`)
        .join('')}`;
      elements.segments.value = current.segments;
      elements.speed.value = current.speed;
      elements.settle.value = current.settleMs;
      elements.pointer.value = current.pointer;
      elements.size.value = current.size;
      elements.fontSize.value = current.fontSize;
      elements.centerText.value = current.centerText;
      elements.palette.value = current.palette.join(', ');
      elements.textColor.value = current.textColor;
      elements.borderColor.value = current.borderColor;
      elements.showLabels.checked = current.showLabels;
      elements.centerLogo.checked = current.centerLogo;
      renderPreview();
    }

    function collect() {
      const current = context.getSettings().wheel;
      const style = elements.panel.querySelector('input[name="wheelStyle"]:checked');
      return {
        ...current,
        style: style ? style.value : current.style,
        segments: numberFrom(elements.segments, current.segments),
        labelField: elements.labelField.value,
        speed: numberFrom(elements.speed, current.speed),
        settleMs: numberFrom(elements.settle, current.settleMs),
        pointer: elements.pointer.value,
        size: numberFrom(elements.size, 0),
        fontSize: numberFrom(elements.fontSize, 0),
        centerText: elements.centerText.value.trim(),
        palette: elements.palette.value.split(',').map((color) => color.trim()).filter((color) => /^#[0-9a-f]{3,8}$/i.test(color)).slice(0, 12),
        textColor: elements.textColor.value.trim(),
        borderColor: elements.borderColor.value.trim(),
        showLabels: elements.showLabels.checked,
        centerLogo: elements.centerLogo.checked,
      };
    }

    function wheelOptions(draft) {
      const settings = context.getSettings();
      return {
        ...draft,
        // The preview is a fixed size, whatever the board will use.
        size: Math.min(draft.size || 420, 420),
        palette: draft.palette.length ? draft.palette : settings.animation.confettiPalette,
        logoSrc: settings.branding.logo.src ? `/${settings.branding.logo.src}` : '',
      };
    }

    function renderPreview() {
      if (testing || !global.createPickoraWheel) return;
      const draft = collect();
      elements.speedValue.textContent = `${(draft.speed / 10).toFixed(1)} turns/s`;
      if (wheel) wheel.destroy();
      const entries = sampleEntries(draft.labelField || (context.getSettings().display.reel.lines[0] || {}).field);
      wheel = global.createPickoraWheel(elements.preview, {
        renderLabel: (entry) => entry.label,
        deal: () => entries[Math.floor(Math.random() * entries.length)],
        options: wheelOptions(draft),
      });
      wheel.preview(entries);
    }

    /** Spins and lands on a sample entry, so the timing can be judged. */
    async function testSpin() {
      if (testing || !global.createPickoraWheel) return;
      testing = true;
      elements.test.disabled = true;
      const draft = collect();
      const entries = sampleEntries(draft.labelField || (context.getSettings().display.reel.lines[0] || {}).field);
      if (wheel) wheel.destroy();
      wheel = global.createPickoraWheel(elements.preview, {
        renderLabel: (entry) => entry.label,
        deal: () => entries[Math.floor(Math.random() * entries.length)],
        options: wheelOptions(draft),
      });
      wheel.start();
      await new Promise((resolve) => global.setTimeout(resolve, 1500));
      const settling = wheel.settle(0);
      wheel.land(entries[Math.floor(Math.random() * entries.length)]);
      await settling;
      testing = false;
      elements.test.disabled = false;
    }

    function bind() {
      elements.panel.addEventListener('input', renderPreview);
      elements.panel.addEventListener('change', renderPreview);
      elements.test.addEventListener('click', testSpin);
      elements.save.addEventListener('click', () =>
        busy(elements.save, 'Saving…', () =>
          context.save({ ...context.getSettings(), wheel: collect() }, 'Draw style saved. Reload the draw board to use it.').catch(() => {})
        )
      );
      elements.revert.addEventListener('click', () => context.reload());
      // Drawn at its real size once the panel is visible.
      document.querySelectorAll('.nav-item[data-panel="wheel"]').forEach((button) => {
        button.addEventListener('click', () => global.setTimeout(renderPreview, 30));
      });
    }

    return { bind, render };
  });
})(window, document);

/**
 * Console: the Templates panel.
 *
 * Save the event's configuration — all of it or chosen parts — apply a saved
 * one to this event, carry one to another Pickora as a file, and keep the list
 * tidy. The built-in templates are starting points that cannot be changed.
 */
(function templatesPanel(global, document) {
  'use strict';

  const features = global.PickoraConsoleFeatures;
  if (!features) return;

  /** What each part of a template holds, in the organiser's words. */
  const SECTION_LABELS = {
    event: { title: 'Event details', hint: 'Name, organisation, prize count, language, direction' },
    branding: { title: 'Logo & backdrop', hint: 'Uploaded artwork' },
    look: { title: 'Colours & layout', hint: 'Accent, background, sizes, text styles' },
    wording: { title: 'Wording', hint: 'Every label on the board' },
    prizes: { title: 'Prizes', hint: 'The prize list and its photos' },
    welcome: { title: 'Welcome screen', hint: 'Message and guest photos' },
    channels: { title: 'Social channels', hint: 'Links and QR codes' },
    animation: { title: 'Reel & celebration', hint: 'Speed, confetti, celebration' },
    draw: { title: 'Draw rules', hint: 'Who may draw, timings, redraws' },
    sound: { title: 'Sound', hint: 'Cues and their settings; your tracks are kept' },
    countdown: { title: 'Countdown', hint: 'Time, words and look' },
    certificate: { title: 'Certificate', hint: 'Wording, columns, signatures' },
    fields: { title: 'Fields & display', hint: 'Entry columns and what the board shows' },
  };

  features.register(function createTemplatesPanel(context, helpers) {
    const api = global.lotteryApi;
    const { escapeHtml, formatTimestamp, readAsText, busy } = helpers;
    const $ = (id) => document.getElementById(id);

    const elements = {
      name: $('templateName'),
      description: $('templateDescription'),
      sections: $('templateSections'),
      save: $('saveTemplateBtn'),
      list: $('templateList'),
      count: $('templateCountPill'),
      importName: $('templateImportName'),
      importInput: $('templateImportInput'),
      panel: $('panel-templates'),
    };

    const state = { templates: [], sections: Object.keys(SECTION_LABELS), defaults: [], loaded: false, applying: null };

    function sectionLabel(name) {
      return (SECTION_LABELS[name] || { title: name }).title;
    }

    function checkboxes(names, checked, attribute) {
      return names
        .map(
          (name) => `
          <label title="${escapeHtml((SECTION_LABELS[name] || {}).hint || '')}">
            <input type="checkbox" ${attribute}="${escapeHtml(name)}"${checked.includes(name) ? ' checked' : ''}> ${escapeHtml(sectionLabel(name))}
          </label>`
        )
        .join('');
    }

    /* --------------------------------------------------------------- render */

    function renderSaveForm() {
      const chosen = Array.from(elements.sections.querySelectorAll('input:checked')).map((input) => input.dataset.section);
      elements.sections.innerHTML = `<legend class="field-label">Parts to include</legend>${checkboxes(
        state.sections,
        chosen.length ? chosen : state.defaults,
        'data-section'
      )}`;
    }

    function applyForm(template) {
      return `
        <div class="template-apply">
          <p class="field-hint">Apply which parts? Each replaces the same part of this event. Anything not ticked stays as it is.</p>
          <fieldset class="field checkbox-row">${checkboxes(template.sections, template.sections, 'data-apply-section')}</fieldset>
          <label class="switch">
            <input type="checkbox" data-keep-name checked>
            <span><strong>Keep this event's name and organisation</strong></span>
          </label>
          <div class="form-actions">
            <button type="button" class="btn btn-primary btn-small" data-confirm-apply>Apply to this event</button>
            <button type="button" class="btn btn-ghost btn-small" data-cancel-apply>Cancel</button>
          </div>
        </div>`;
    }

    function templateCard(template) {
      const isApplying = state.applying === template.id;
      const userActions = template.builtIn
        ? ''
        : `
          <button type="button" class="btn btn-ghost btn-small" data-refresh>Update from current</button>
          <button type="button" class="btn btn-ghost btn-small" data-rename>Rename</button>
          <button type="button" class="btn btn-danger btn-small" data-delete>Delete</button>`;

      return `
        <article class="template-card${isApplying ? ' is-applying' : ''}" data-template="${escapeHtml(template.id)}">
          <div class="template-main">
            <h3 class="template-name">${escapeHtml(template.name)}${template.builtIn ? ' <span class="pill pill-quiet">Built-in</span>' : ''}</h3>
            ${template.description ? `<p class="template-description">${escapeHtml(template.description)}</p>` : ''}
            <p class="template-sections">${template.sections.map((name) => `<span class="pill">${escapeHtml(sectionLabel(name))}</span>`).join('')}</p>
            ${template.updatedAt ? `<p class="field-hint">Saved ${escapeHtml(formatTimestamp(template.updatedAt))}</p>` : ''}
          </div>
          <div class="template-actions">
            <button type="button" class="btn btn-primary btn-small" data-apply>Apply…</button>
            <a class="btn btn-ghost btn-small" href="${escapeHtml(api.templateExportUrl(template.id, false))}" download>Export</a>
            <a class="btn btn-ghost btn-small" href="${escapeHtml(api.templateExportUrl(template.id, true))}" download>Export with files</a>
            ${userActions}
          </div>
          ${isApplying ? applyForm(template) : ''}
        </article>`;
    }

    function renderList() {
      const own = state.templates.filter((template) => !template.builtIn).length;
      elements.count.textContent = `${own} saved · ${state.templates.length - own} built-in`;
      elements.list.innerHTML = state.templates.length
        ? state.templates.map(templateCard).join('')
        : '<p class="slot-empty">No templates yet.</p>';
    }

    async function load() {
      try {
        const result = await api.listTemplates();
        state.templates = result.templates;
        state.sections = result.sections;
        state.defaults = result.defaultSections;
        state.loaded = true;
        renderSaveForm();
        renderList();
      } catch (error) {
        context.toast(error.message, 'error');
      }
    }

    function render() {
      // Templates live apart from the settings; they are fetched when the
      // panel is first opened, not on every settings change.
      if (state.loaded) renderList();
    }

    /* -------------------------------------------------------------- actions */

    function find(id) {
      return state.templates.find((template) => template.id === id);
    }

    async function save() {
      const name = elements.name.value.trim();
      const sections = Array.from(elements.sections.querySelectorAll('input:checked')).map((input) => input.dataset.section);
      if (!name) {
        context.toast('Give the template a name.', 'error');
        elements.name.focus();
        return;
      }
      if (sections.length === 0) {
        context.toast('Tick at least one part to include.', 'error');
        return;
      }

      await busy(elements.save, 'Saving…', async () => {
        try {
          await api.createTemplate({ name, description: elements.description.value.trim(), sections });
          elements.name.value = '';
          elements.description.value = '';
          context.toast(`Saved "${name}". Save any unsaved panel first — templates are made from the saved configuration.`);
          await load();
        } catch (error) {
          context.toast(error.message, 'error');
        }
      });
    }

    async function apply(card, button) {
      const template = find(card.dataset.template);
      const sections = Array.from(card.querySelectorAll('[data-apply-section]:checked')).map((input) => input.dataset.applySection);
      if (sections.length === 0) {
        context.toast('Tick at least one part to apply.', 'error');
        return;
      }
      const keepEventName = card.querySelector('[data-keep-name]').checked;
      const summary = sections.map(sectionLabel).join(', ');
      if (!global.confirm(`Apply "${template.name}"?\n\nThis replaces: ${summary}.\n\nExport the current configuration first if you may want it back.`)) return;

      await busy(button, 'Applying…', async () => {
        try {
          const result = await api.applyTemplate(template.id, { sections, keepEventName });
          state.applying = null;
          await context.reload();
          const missing = result.missing && result.missing.length;
          const dropped = result.droppedTracks && result.droppedTracks.length;
          context.toast(
            `"${template.name}" applied.${missing ? ` ${missing} file(s) it refers to are not on this deployment and were left out.` : ''}${
              dropped ? ` ${dropped} of its tracks did not fit in your sound library (30 at most): ${result.droppedTracks.join(', ')}.` : ''
            } Open screens pick it up on their next reload.`
          );
          renderList();
        } catch (error) {
          context.toast(error.message, 'error');
        }
      });
    }

    async function refresh(template, button) {
      if (!global.confirm(`Replace what "${template.name}" holds with the current saved configuration?`)) return;
      await busy(button, 'Updating…', async () => {
        try {
          await api.updateTemplate(template.id, { refresh: true });
          context.toast(`"${template.name}" now holds the current configuration.`);
          await load();
        } catch (error) {
          context.toast(error.message, 'error');
        }
      });
    }

    async function rename(template) {
      const name = global.prompt('Template name', template.name);
      if (name === null) return;
      const description = global.prompt('Description (optional)', template.description || '');
      if (description === null) return;
      try {
        await api.updateTemplate(template.id, { name: name.trim(), description: description.trim() });
        await load();
      } catch (error) {
        context.toast(error.message, 'error');
      }
    }

    async function remove(template, button) {
      if (!global.confirm(`Delete the template "${template.name}"?\n\nThis cannot be undone.`)) return;
      await busy(button, 'Deleting…', async () => {
        try {
          await api.deleteTemplate(template.id);
          context.toast(`"${template.name}" was deleted.`);
          await load();
        } catch (error) {
          context.toast(error.message, 'error');
        }
      });
    }

    async function importFile(file) {
      if (!file) return;
      const label = document.querySelector('label[for="templateImportInput"]');
      label.textContent = 'Importing…';
      try {
        let parsed;
        try {
          parsed = JSON.parse(await readAsText(file));
        } catch (_error) {
          throw new Error('That file is not valid JSON.');
        }
        const result = await api.importTemplate({ file: parsed, name: elements.importName.value.trim() });
        elements.importName.value = '';
        const refused = result.refused && result.refused.length;
        context.toast(
          `Imported "${result.template.name}".${refused ? ` ${refused} embedded file(s) did not check out and were left out.` : ''}`
        );
        await load();
      } catch (error) {
        context.toast(error.message, 'error');
      } finally {
        label.textContent = 'Choose file and import';
      }
    }

    /* --------------------------------------------------------------- wiring */

    function bind() {
      elements.save.addEventListener('click', save);
      elements.importInput.addEventListener('change', (event) => {
        importFile(event.target.files[0]);
        event.target.value = '';
      });

      elements.list.addEventListener('click', (event) => {
        const card = event.target.closest('[data-template]');
        if (!card) return;
        const template = find(card.dataset.template);
        const target = event.target.closest('button');
        if (!template || !target) return;

        if (target.hasAttribute('data-apply')) {
          state.applying = state.applying === template.id ? null : template.id;
          renderList();
        } else if (target.hasAttribute('data-cancel-apply')) {
          state.applying = null;
          renderList();
        } else if (target.hasAttribute('data-confirm-apply')) apply(card, target);
        else if (target.hasAttribute('data-refresh')) refresh(template, target);
        else if (target.hasAttribute('data-rename')) rename(template);
        else if (target.hasAttribute('data-delete')) remove(template, target);
      });

      document.querySelectorAll('.nav-item[data-panel="templates"]').forEach((button) => {
        button.addEventListener('click', load);
      });
    }

    return { bind, render };
  });
})(window, document);

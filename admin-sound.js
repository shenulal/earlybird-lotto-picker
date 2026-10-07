/**
 * Console: the Sound panel.
 *
 * Every cue the board can play, each with its own source, volume, delay,
 * fades, duration, start point and looping — plus the organiser's own uploaded
 * tracks. Previews run through the very engine the screens use (sound.js), so
 * what is heard here is what the room will hear.
 */
(function soundPanel(global, document) {
  'use strict';

  const features = global.PickoraConsoleFeatures;
  if (!features) return;

  const CUES = [
    { key: 'ambient', title: 'Background music', hint: 'Plays between draws on the screens chosen below, and steps aside for the draw if you ask it to.' },
    { key: 'spin', title: 'While the reel spins', hint: 'Starts with the spin and fades out the moment the reel lands.' },
    { key: 'land', title: 'Reel lands', hint: 'The instant the reel comes to rest on the winner.' },
    { key: 'reveal', title: 'Winner revealed', hint: 'When the winner card appears. Background music returns once it finishes.' },
    { key: 'absent', title: 'Winner not present', hint: 'When a winner is struck off with "Not present".' },
    { key: 'countdownTick', title: 'Countdown tick', hint: 'Each second of the countdown\'s final stretch.' },
    { key: 'countdownEnd', title: 'Countdown ends', hint: 'When the countdown reaches zero.' },
  ];

  // Starting points: one built-in sound per cue that belong together. They
  // only fill in the choices — every one can be changed afterwards.
  const PACKS = {
    gala: { label: 'Gala', cues: { ambient: 'gala', spin: 'drumroll', land: 'cymbal', reveal: 'fanfare', absent: 'descend', countdownTick: 'wood', countdownEnd: 'gong' } },
    gameshow: { label: 'Game show', cues: { ambient: 'pulse', spin: 'ticker', land: 'thud', reveal: 'tada', absent: 'buzz', countdownTick: 'beep', countdownEnd: 'horn' } },
    arcade: { label: 'Arcade', cues: { ambient: 'pulse', spin: 'arcade', land: 'thud', reveal: 'arcade', absent: 'buzz', countdownTick: 'beep', countdownEnd: 'horn' } },
    cinematic: { label: 'Cinematic', cues: { ambient: 'lounge', spin: 'riser', land: 'gong', reveal: 'bells', absent: 'descend', countdownTick: 'tick', countdownEnd: 'gong' } },
    calm: { label: 'Calm', cues: { ambient: 'celesta', spin: 'heartbeat', land: 'chime', reveal: 'bells', absent: 'descend', countdownTick: 'wood', countdownEnd: 'chime' } },
  };

  // A looping cue previewed without a duration of its own stops after this.
  const PREVIEW_LOOP_MS = 12000;

  features.register(function createSoundPanel(context, helpers) {
    const api = global.lotteryApi;
    const { escapeHtml, formatBytes, readAsDataUrl, numberFrom, busy } = helpers;
    const presets = global.PickoraSoundPresets;
    const engine = global.createPickoraSound ? global.createPickoraSound({ page: 'console', ignoreMute: true }) : null;
    let previewTimer = null;

    const $ = (id) => document.getElementById(id);
    const elements = {
      enabled: $('soundEnabled'),
      showMute: $('soundShowMute'),
      volume: $('soundVolume'),
      volumeValue: $('soundVolumeValue'),
      pack: $('soundPack'),
      packApply: $('soundPackApply'),
      trackInput: $('trackInput'),
      trackList: $('trackList'),
      trackCount: $('trackCountPill'),
      cues: $('soundCues'),
      save: $('saveSoundBtn'),
      revert: $('revertSoundBtn'),
    };

    function sound() {
      return context.getSettings().sound;
    }

    /* --------------------------------------------------------------- render */

    function sourceOptions(cueKey, cue, library) {
      const builtIns = (presets ? presets.names(cueKey) : [cue.preset])
        .map((name) => {
          const value = `preset:${name}`;
          const selected = cue.source === 'preset' && cue.preset === name ? ' selected' : '';
          return `<option value="${value}"${selected}>${escapeHtml((presets && presets.LABELS[name]) || name)}</option>`;
        })
        .join('');
      const tracks = library
        .map((track) => {
          const selected = cue.source === 'track' && cue.track === track.id ? ' selected' : '';
          return `<option value="track:${escapeHtml(track.id)}"${selected}>${escapeHtml(track.name)}</option>`;
        })
        .join('');
      return `<optgroup label="Built-in sounds">${builtIns}</optgroup>${
        tracks ? `<optgroup label="Your tracks">${tracks}</optgroup>` : ''
      }`;
    }

    function numberField(cueKey, name, label, value, { max, step = 100, hint = '' }) {
      return `
        <label class="field">
          <span class="field-label">${label}</span>
          <input type="number" data-field="${name}" min="0" max="${max}" step="${step}" value="${escapeHtml(value)}">
          ${hint ? `<span class="field-hint">${hint}</span>` : ''}
        </label>`;
    }

    function cueCard(meta, cue, library) {
      const isAmbient = meta.key === 'ambient';
      const usesTrack = cue.source === 'track';
      const ambientExtras = isAmbient
        ? `
          <fieldset class="field checkbox-row">
            <legend class="field-label">Play it on</legend>
            <label><input type="checkbox" data-screen="board"${cue.screens.board ? ' checked' : ''}> Draw board</label>
            <label><input type="checkbox" data-screen="welcome"${cue.screens.welcome ? ' checked' : ''}> Welcome screen</label>
            <label><input type="checkbox" data-screen="prizes"${cue.screens.prizes ? ' checked' : ''}> Prize screen</label>
          </fieldset>
          <label class="switch">
            <input type="checkbox" data-field="pauseDuringDraw"${cue.pauseDuringDraw ? ' checked' : ''}>
            <span><strong>Pause it during the draw</strong><small>Fades out when the reel starts and returns after the winner is revealed.</small></span>
          </label>`
        : '';

      return `
        <article class="card cue-card" data-cue="${meta.key}" data-enabled="${cue.enabled}">
          <div class="cue-head">
            <label class="switch cue-switch">
              <input type="checkbox" data-field="enabled"${cue.enabled ? ' checked' : ''}>
              <span><strong>${escapeHtml(meta.title)}</strong><small>${escapeHtml(meta.hint)}</small></span>
            </label>
            <div class="card-actions">
              <button type="button" class="btn btn-ghost btn-small" data-preview="${meta.key}">▶ Preview</button>
              <button type="button" class="btn btn-ghost btn-small" data-stop="${meta.key}">■ Stop</button>
            </div>
          </div>
          <div class="cue-grid">
            <label class="field cue-source">
              <span class="field-label">Sound</span>
              <select data-field="source">${sourceOptions(meta.key, cue, library)}</select>
            </label>
            <label class="field">
              <span class="field-label">Volume <output class="field-value">${cue.volume}%</output></span>
              <input type="range" data-field="volume" min="0" max="100" step="1" value="${cue.volume}">
            </label>
            ${numberField(meta.key, 'delayMs', 'Delay (ms)', cue.delayMs, { max: 10000, hint: 'After the moment, before it plays.' })}
            ${numberField(meta.key, 'durationMs', 'Length (ms)', cue.durationMs, {
              max: 600000,
              step: 500,
              hint: isAmbient || meta.key === 'spin' ? '0 plays until the moment is over.' : '0 plays the whole sound.',
            })}
            ${numberField(meta.key, 'fadeInMs', 'Fade in (ms)', cue.fadeInMs, { max: 10000 })}
            ${numberField(meta.key, 'fadeOutMs', 'Fade out (ms)', cue.fadeOutMs, { max: 10000 })}
            <label class="field" data-track-only${usesTrack ? '' : ' hidden'}>
              <span class="field-label">Start the track at (ms)</span>
              <input type="number" data-field="startAtMs" min="0" max="600000" step="500" value="${cue.startAtMs}">
              <span class="field-hint">Skip an intro and start on the hook.</span>
            </label>
            <label class="switch cue-loop">
              <input type="checkbox" data-field="loop"${cue.loop ? ' checked' : ''}>
              <span><strong>Loop</strong><small>Repeat until the length above, or the moment, is over.</small></span>
            </label>
          </div>
          ${ambientExtras}
        </article>`;
    }

    function renderTracks() {
      const { library, cues } = sound();
      elements.trackCount.textContent = `${library.length} track${library.length === 1 ? '' : 's'}`;

      if (library.length === 0) {
        elements.trackList.innerHTML = '<p class="slot-empty">No tracks yet. Upload a walk-in song, a drumroll or a fanfare of your own.</p>';
        return;
      }

      elements.trackList.innerHTML = library
        .map((track) => {
          const usedBy = CUES.filter((meta) => cues[meta.key].source === 'track' && cues[meta.key].track === track.id).map((meta) => meta.title);
          return `
            <div class="track-row" data-track="${escapeHtml(track.id)}">
              <span class="track-name">${escapeHtml(track.name)}</span>
              <span class="track-meta">${escapeHtml(track.format.toUpperCase())} · ${escapeHtml(formatBytes(track.bytes))}${
                usedBy.length ? ` · used for ${escapeHtml(usedBy.join(', '))}` : ''
              }</span>
              <span class="card-actions">
                <button type="button" class="btn btn-ghost btn-small" data-track-play>▶ Play</button>
                <button type="button" class="btn btn-ghost btn-small" data-track-stop>■</button>
                <button type="button" class="btn btn-ghost btn-small" data-track-rename>Rename</button>
                <button type="button" class="btn btn-danger btn-small" data-track-delete>Delete</button>
              </span>
            </div>`;
        })
        .join('');
    }

    function render() {
      const settings = sound();
      elements.enabled.checked = settings.enabled;
      elements.showMute.checked = settings.showMuteButton;
      elements.volume.value = settings.volume;
      elements.volumeValue.textContent = `${settings.volume}%`;
      elements.cues.innerHTML = CUES.map((meta) => cueCard(meta, settings.cues[meta.key], settings.library)).join('');
      renderTracks();
    }

    /* -------------------------------------------------------------- collect */

    function readCue(card, previous) {
      const field = (name) => card.querySelector(`[data-field="${name}"]`);
      const [source, id] = field('source').value.split(':');
      const cue = {
        ...previous,
        enabled: field('enabled').checked,
        source,
        preset: source === 'preset' ? id : previous.preset,
        track: source === 'track' ? id : '',
        volume: numberFrom(field('volume'), previous.volume),
        delayMs: numberFrom(field('delayMs'), 0),
        durationMs: numberFrom(field('durationMs'), 0),
        fadeInMs: numberFrom(field('fadeInMs'), 0),
        fadeOutMs: numberFrom(field('fadeOutMs'), 0),
        startAtMs: numberFrom(field('startAtMs'), 0),
        loop: field('loop').checked,
      };

      if (card.dataset.cue !== 'ambient') return cue;
      return {
        ...cue,
        pauseDuringDraw: field('pauseDuringDraw').checked,
        screens: ['board', 'welcome', 'prizes'].reduce(
          (screens, screen) => ({ ...screens, [screen]: card.querySelector(`[data-screen="${screen}"]`).checked }),
          {}
        ),
      };
    }

    function collect() {
      const settings = sound();
      const cues = Array.from(elements.cues.querySelectorAll('.cue-card')).reduce(
        (accumulator, card) => ({ ...accumulator, [card.dataset.cue]: readCue(card, settings.cues[card.dataset.cue]) }),
        {}
      );
      return {
        ...settings,
        enabled: elements.enabled.checked,
        showMuteButton: elements.showMute.checked,
        volume: numberFrom(elements.volume, settings.volume),
        cues,
      };
    }

    /* -------------------------------------------------------------- preview */

    function stopPreview(name) {
      global.clearTimeout(previewTimer);
      if (!engine) return;
      if (name) engine.stop(name, 150);
      else engine.stopAll();
    }

    /** Plays one cue exactly as configured on screen, saved or not. */
    async function preview(name, overrides = null) {
      if (!engine) {
        context.toast('This browser cannot play sound.', 'error');
        return;
      }
      stopPreview();
      const draft = collect();
      const cues = overrides ? { ...draft.cues, [name]: { ...draft.cues[name], ...overrides } } : draft.cues;
      engine.update({ ...draft, enabled: true, showMuteButton: false, cues: { ...cues, [name]: { ...cues[name], enabled: true } } });
      // Still inside the Preview click, so the browser allows this.
      engine.unlock();

      const handle = await engine.play(name);
      if (!handle) {
        context.toast('The sound could not start. Click anywhere on the page and try again.', 'error');
        return;
      }
      const cue = cues[name];
      const loops = cue.loop || name === 'ambient' || name === 'spin';
      if (loops && !cue.durationMs) previewTimer = global.setTimeout(() => engine.stop(name), PREVIEW_LOOP_MS);
    }

    /** Plays an uploaded track on its own, through the reveal cue's slot. */
    function previewTrack(id) {
      preview('reveal', { source: 'track', track: id, volume: 100, delayMs: 0, durationMs: 0, fadeInMs: 0, startAtMs: 0, loop: false });
    }

    /* -------------------------------------------------------------- library */

    function keepDraft(appSettings) {
      const draft = collect();
      return { ...appSettings, sound: { ...draft, library: appSettings.sound.library } };
    }

    async function upload(file) {
      if (!file) return;
      const limit = (context.getLimits() || {}).maxUploadBytes || 8 * 1024 * 1024;
      if (file.size > limit) {
        context.toast(`That file is ${formatBytes(file.size)} — the limit here is ${formatBytes(limit)}.`, 'error');
        return;
      }
      if (file.type && !file.type.startsWith('audio/') && !/\.(mp3|m4a|aac|ogg|oga|opus|wav|flac|webm)$/i.test(file.name)) {
        context.toast('Choose an audio file.', 'error');
        return;
      }

      const label = document.querySelector('label[for="trackInput"]');
      label.textContent = 'Uploading…';
      try {
        const result = await api.uploadTrack({ content: await readAsDataUrl(file), name: file.name });
        context.applySettings(keepDraft(result.appSettings));
        context.toast(`"${result.track.name}" was added to your tracks.`);
      } catch (error) {
        context.toast(error.message, 'error');
      } finally {
        label.textContent = 'Upload audio';
      }
    }

    async function rename(id) {
      const track = sound().library.find((entry) => entry.id === id);
      const name = track && global.prompt('Name this track', track.name);
      if (!name || !name.trim()) return;
      try {
        const result = await api.renameTrack(id, name.trim());
        context.applySettings(keepDraft(result.appSettings));
      } catch (error) {
        context.toast(error.message, 'error');
      }
    }

    async function remove(id, button) {
      const track = sound().library.find((entry) => entry.id === id);
      if (!track) return;
      if (!global.confirm(`Delete "${track.name}"?\n\nAny cue using it goes back to its built-in sound.`)) return;
      await busy(button, 'Deleting…', async () => {
        try {
          stopPreview();
          const result = await api.deleteTrack(id);
          context.applySettings(keepDraft(result.appSettings));
          context.toast(`"${track.name}" was deleted.`);
        } catch (error) {
          context.toast(error.message, 'error');
        }
      });
    }

    /* --------------------------------------------------------------- wiring */

    function applyPack() {
      const pack = PACKS[elements.pack.value];
      if (!pack) return;
      const draft = collect();
      const cues = Object.fromEntries(
        Object.entries(draft.cues).map(([name, cue]) => [name, { ...cue, source: 'preset', preset: pack.cues[name] || cue.preset }])
      );
      context.applySettings({ ...context.getSettings(), sound: { ...draft, cues } });
      context.toast(`${pack.label} sounds chosen for every cue. Save to keep them.`);
    }

    function bind() {
      elements.pack.innerHTML = Object.entries(PACKS)
        .map(([value, pack]) => `<option value="${value}">${escapeHtml(pack.label)}</option>`)
        .join('');

      elements.volume.addEventListener('input', () => {
        elements.volumeValue.textContent = `${elements.volume.value}%`;
      });
      elements.packApply.addEventListener('click', applyPack);

      elements.cues.addEventListener('input', (event) => {
        if (event.target.type === 'range') {
          const output = event.target.closest('.field').querySelector('output');
          if (output) output.textContent = `${event.target.value}%`;
        }
      });
      elements.cues.addEventListener('change', (event) => {
        const card = event.target.closest('.cue-card');
        if (!card) return;
        if (event.target.dataset.field === 'source') {
          card.querySelector('[data-track-only]').hidden = !event.target.value.startsWith('track:');
        }
        if (event.target.dataset.field === 'enabled') card.dataset.enabled = String(event.target.checked);
      });
      elements.cues.addEventListener('click', (event) => {
        const play = event.target.closest('[data-preview]');
        const stop = event.target.closest('[data-stop]');
        if (play) preview(play.dataset.preview);
        if (stop) stopPreview(stop.dataset.stop);
      });

      elements.trackInput.addEventListener('change', (event) => {
        upload(event.target.files[0]);
        // The same file chosen again must still fire a change.
        event.target.value = '';
      });
      elements.trackList.addEventListener('click', (event) => {
        const row = event.target.closest('[data-track]');
        if (!row) return;
        const id = row.dataset.track;
        if (event.target.closest('[data-track-play]')) previewTrack(id);
        if (event.target.closest('[data-track-stop]')) stopPreview('reveal');
        if (event.target.closest('[data-track-rename]')) rename(id);
        if (event.target.closest('[data-track-delete]')) remove(id, event.target.closest('[data-track-delete]'));
      });

      elements.save.addEventListener('click', () =>
        busy(elements.save, 'Saving…', () =>
          context
            .save({ ...context.getSettings(), sound: collect() }, 'Sound saved. Open screens pick it up within 20 seconds.')
            .catch(() => {})
        )
      );
      elements.revert.addEventListener('click', () => {
        stopPreview();
        context.reload();
      });
    }

    return { bind, render };
  });
})(window, document);

/**
 * The sound engine shared by the public pages.
 *
 * Plays each cue exactly as the organiser configured it — a built-in sound or
 * an uploaded track, at its own volume, after its own delay, fading in and
 * out, cut to its own duration, looping or not. Nothing about any of that is
 * decided here: the settings say, this carries it out.
 *
 * Uploaded tracks are fetched once and decoded into memory rather than played
 * through an <audio> element. That gives sample-accurate fades and loops, and
 * it sidesteps Safari, which refuses to play media from a server that does not
 * answer byte-range requests.
 *
 * Browsers only allow sound after someone has interacted with the page. The
 * engine unlocks itself on the first click or key press anywhere, and until
 * then the speaker button pulses to say sound is waiting.
 */
(function soundEngine(global, document) {
  'use strict';

  const MUTE_KEY = 'pickora-sound-muted';
  const presets = () => global.PickoraSoundPresets;

  function readMuted() {
    try {
      return global.localStorage.getItem(MUTE_KEY) === '1';
    } catch (_error) {
      return false;
    }
  }

  function writeMuted(muted) {
    try {
      global.localStorage.setItem(MUTE_KEY, muted ? '1' : '0');
    } catch (_error) {
      /* private browsing: the choice lasts for this page only */
    }
  }

  /**
   * Creates the engine for one page. `page` is 'board', 'welcome' or
   * 'prizes', and decides whether background music belongs here.
   * `ignoreMute` is for the console's previews: they must be heard whatever
   * the speaker button on a screen in the same browser was left at.
   */
  function createSound({ page = 'board', ignoreMute = false } = {}) {
    let settings = null;
    let copy = {};
    let ctx = null;
    let master = null;
    let muted = ignoreMute ? false : readMuted();
    let button = null;
    const decoded = new Map();
    const active = new Map();
    let ambientWanted = false;
    let ambientPaused = false;

    /* ------------------------------------------------------------- context */

    function context() {
      if (ctx) return ctx;
      const AudioContext = global.AudioContext || global.webkitAudioContext;
      if (!AudioContext) return null;
      ctx = new AudioContext();
      master = ctx.createGain();
      master.connect(ctx.destination);
      applyMaster();
      ctx.addEventListener('statechange', renderButton);
      return ctx;
    }

    function isOn() {
      return Boolean(settings && settings.enabled);
    }

    function isReady() {
      return Boolean(ctx && ctx.state === 'running');
    }

    function applyMaster() {
      if (!master) return;
      const level = isOn() && !muted ? settings.volume / 100 : 0;
      master.gain.setTargetAtTime(level, ctx.currentTime, 0.05);
    }

    /**
     * Resumes the audio clock. Browsers allow that only inside a user
     * gesture, so the context itself is only ever created from one — making
     * it any earlier just earns a console warning and a context that waits.
     */
    function unlock(fromGesture = false) {
      if (!isOn()) return;
      if (!ctx && !fromGesture) return;
      const audio = context();
      if (!audio) return;
      const resumed = audio.state === 'running' ? Promise.resolve() : audio.resume();
      resumed
        .then(() => {
          renderButton();
          preloadTracks();
          if (ambientWanted && !ambientPaused) startAmbient();
        })
        .catch(() => {});
    }

    function onFirstGesture() {
      unlock(true);
    }

    document.addEventListener('pointerdown', onFirstGesture, { capture: true });
    document.addEventListener('keydown', onFirstGesture, { capture: true });

    /* --------------------------------------------------------------- tracks */

    function trackFor(cue) {
      if (cue.source !== 'track' || !cue.track) return null;
      return settings.library.find((track) => track.id === cue.track) || null;
    }

    /** Fetches and decodes a track once; later plays reuse the buffer. */
    function loadTrack(track) {
      if (decoded.has(track.src)) return decoded.get(track.src);
      const audio = context();
      const loading = fetch(`/${track.src}`, { credentials: 'same-origin' })
        .then((response) => {
          if (!response.ok) throw new Error(`Track ${track.name} could not be loaded.`);
          return response.arrayBuffer();
        })
        .then((bytes) => new Promise((resolve, reject) => audio.decodeAudioData(bytes, resolve, reject)))
        .catch((error) => {
          decoded.delete(track.src);
          throw error;
        });
      decoded.set(track.src, loading);
      return loading;
    }

    /** Warms the cache, so the first reveal does not wait on the network. */
    function preloadTracks() {
      if (!isOn() || !ctx) return;
      Object.values(settings.cues)
        .filter((cue) => cue.enabled)
        .map(trackFor)
        .filter(Boolean)
        .forEach((track) => loadTrack(track).catch(() => {}));
    }

    function playBuffer(buffer, out, when, cue) {
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      const offset = Math.min(cue.startAtMs / 1000, Math.max(0, buffer.duration - 0.05));
      if (cue.loop) {
        source.loop = true;
        source.loopStart = offset;
        source.loopEnd = buffer.duration;
      }
      source.connect(out);
      source.start(when, offset);
      return {
        naturalMs: cue.loop ? null : (buffer.duration - offset) * 1000,
        loops: cue.loop,
        stop(at) {
          try {
            source.stop(at);
          } catch (_error) {
            /* already stopped */
          }
        },
      };
    }

    /* ----------------------------------------------------------------- cues */

    /**
     * A built-in sound as a voice. A one-shot asked to loop is simply struck
     * again each time it finishes, until the cue is stopped.
     */
    function playPreset(name, cue, out, when) {
      const first = presets() && presets().play(ctx, out, name, cue.preset, when);
      if (!first) return null;
      if (first.loops || !cue.loop) return first;

      let current = first;
      let stopped = false;
      let timer = null;
      const again = (at) => {
        timer = global.setTimeout(() => {
          if (stopped) return;
          const next = ctx.currentTime + 0.02;
          current = presets().play(ctx, out, name, cue.preset, next);
          again(next);
        }, Math.max(150, (at - ctx.currentTime) * 1000 + current.naturalMs));
      };
      again(when);

      return {
        naturalMs: null,
        loops: true,
        stop(at) {
          stopped = true;
          global.clearTimeout(timer);
          current.stop(at);
        },
      };
    }

    /**
     * Plays a cue. Resolves to a handle — `stop()` fades it out, and `ended`
     * settles when it has finished, however that happened — or null when the
     * cue is off, sound is off, or the browser has not been unlocked yet.
     *
     * FIX: the handle is registered before anything is awaited. An uploaded
     * track takes a moment to fetch and decode, and a second start, or a stop,
     * arriving in that moment used to find nothing registered — so a loop
     * could start twice and the first could never be stopped, or keep playing
     * through the spin it was told to step aside for.
     */
    async function play(name) {
      if (!isOn()) return null;
      const cue = settings.cues[name];
      if (!cue || !cue.enabled) return null;
      // No context yet means nobody has interacted with the page: nothing
      // may play, and trying would only be refused.
      if (!ctx) return null;

      stop(name, 0);

      let settle;
      const ended = new Promise((resolve) => {
        settle = resolve;
      });
      const out = ctx.createGain();
      out.connect(master);
      const handle = { name, voice: null, out, ended, stopped: false, timers: [] };
      handle.cancel = (fadeMs) => {
        // Cancelled before it ever sounded: nothing to fade.
        if (!handle.voice) finish(handle, settle);
        else fadeOut(handle, fadeMs === undefined ? cue.fadeOutMs : fadeMs, settle);
      };
      active.set(name, handle);

      if (ctx.state !== 'running') {
        // One more try, in case this call came straight from a click.
        await ctx.resume().catch(() => {});
        if (ctx.state !== 'running') {
          finish(handle, settle);
          return null;
        }
      }

      const track = trackFor(cue);
      let buffer = null;
      if (track) {
        try {
          buffer = await loadTrack(track);
        } catch (_error) {
          // A track that will not load falls back to the cue's built-in
          // sound rather than leaving the moment silent.
          buffer = null;
        }
      }
      if (handle.stopped) return null;

      // Timed from now, after any wait for the track, so the delay and the
      // fade are the ones configured.
      const level = cue.volume / 100;
      const fadeIn = cue.fadeInMs / 1000;
      const when = ctx.currentTime + cue.delayMs / 1000 + 0.01;
      out.gain.setValueAtTime(fadeIn > 0 ? 0.0001 : level, ctx.currentTime);
      if (fadeIn > 0) {
        out.gain.setValueAtTime(0.0001, when);
        out.gain.exponentialRampToValueAtTime(Math.max(level, 0.0001), when + fadeIn);
      }

      const voice = buffer ? playBuffer(buffer, out, when, cue) : playPreset(name, cue, out, when);
      if (!voice) {
        finish(handle, settle);
        return null;
      }
      handle.voice = voice;

      // The organiser's duration cuts the cue short (with its fade); without
      // one, a one-shot lasts as long as it rings and a loop until stopped.
      const capMs = cue.durationMs > 0 ? cue.durationMs : null;
      if (capMs) {
        handle.timers.push(global.setTimeout(() => fadeOut(handle, cue.fadeOutMs, settle), cue.delayMs + capMs));
      } else if (voice.naturalMs !== null) {
        handle.timers.push(global.setTimeout(() => finish(handle, settle), cue.delayMs + voice.naturalMs + 50));
      }
      return handle;
    }

    function fadeOut(handle, fadeMs, settle) {
      if (handle.stopped) return;
      handle.stopped = true;
      handle.timers.forEach(global.clearTimeout);
      const fade = Math.max(0, fadeMs) / 1000;
      const now = ctx.currentTime;
      handle.out.gain.cancelScheduledValues(now);
      handle.out.gain.setValueAtTime(Math.max(handle.out.gain.value, 0.0001), now);
      handle.out.gain.exponentialRampToValueAtTime(0.0001, now + Math.max(fade, 0.02));
      handle.voice.stop(now + Math.max(fade, 0.02) + 0.05);
      global.setTimeout(() => finish(handle, settle), fade * 1000 + 120);
    }

    function finish(handle, settle) {
      handle.stopped = true;
      handle.timers.forEach(global.clearTimeout);
      try {
        handle.out.disconnect();
      } catch (_error) {
        /* already disconnected */
      }
      if (active.get(handle.name) === handle) active.delete(handle.name);
      settle();
    }

    /** Fades a cue out — with its own fade, unless another is given. */
    function stop(name, fadeMs) {
      const handle = active.get(name);
      if (handle) handle.cancel(fadeMs);
    }

    function stopAll() {
      [...active.keys()].forEach((name) => stop(name, 0));
    }

    /* -------------------------------------------------------------- ambient */

    function ambientBelongsHere() {
      const cue = isOn() && settings.cues.ambient;
      return Boolean(cue && cue.enabled && cue.screens[page]);
    }

    // FIX: counts pauses, so a resume promised before a later pause — the
    // reveal's, when "Not present" is pressed during it — cannot bring the
    // music back underneath what came after.
    let pauseGeneration = 0;

    function startAmbient() {
      ambientWanted = true;
      const current = active.get('ambient');
      // A handle still fading out does not count as playing.
      if (!ambientBelongsHere() || ambientPaused || (current && !current.stopped)) return;
      play('ambient');
    }

    /** Steps the music aside for the draw, if the organiser asked for that. */
    function pauseAmbient() {
      if (!isOn() || !settings.cues.ambient.pauseDuringDraw) return;
      pauseGeneration += 1;
      ambientPaused = true;
      stop('ambient');
    }

    /** Brings the music back, once `after` (a cue's handle) has finished. */
    function resumeAmbient(after) {
      const generation = pauseGeneration;
      const resume = () => {
        if (generation !== pauseGeneration) return;
        ambientPaused = false;
        if (ambientWanted) startAmbient();
      };
      if (after && after.ended) after.ended.then(resume);
      else resume();
    }

    /* --------------------------------------------------------------- button */

    function renderButton() {
      if (!button) return;
      const show = isOn() && settings.showMuteButton;
      button.hidden = !show;
      if (!show) return;

      const waiting = !muted && !isReady();
      button.setAttribute('aria-pressed', String(!muted));
      button.dataset.state = muted ? 'muted' : waiting ? 'waiting' : 'on';
      const label = copy.soundToggle || 'Sound';
      button.title = muted ? `${label}: off (S)` : waiting ? `${label}: click to enable (S)` : `${label}: on (S)`;
      button.setAttribute('aria-label', button.title);
    }

    function setMuted(next) {
      muted = Boolean(next);
      if (!ignoreMute) writeMuted(muted);
      // Always called from a click or key press.
      if (!muted) unlock(true);
      applyMaster();
      renderButton();
    }

    function toggleMuted() {
      setMuted(!muted);
    }

    /** Puts the speaker button into `host`, ahead of what is already there. */
    function mountButton(host) {
      if (!host || button) return;
      button = document.createElement('button');
      button.type = 'button';
      button.className = 'sound-toggle';
      button.innerHTML =
        '<svg viewBox="0 0 24 24" aria-hidden="true"><path class="sound-cone" d="M4 9v6h4l5 4V5L8 9H4z"/>' +
        '<path class="sound-wave" d="M16 8.5a5 5 0 0 1 0 7M18.5 6a8.5 8.5 0 0 1 0 12"/>' +
        '<path class="sound-cross" d="M16 9l5 6M21 9l-5 6"/></svg>';
      button.addEventListener('click', toggleMuted);
      host.insertBefore(button, host.firstChild);

      document.addEventListener('keydown', (event) => {
        if (/^(INPUT|TEXTAREA|SELECT)$/.test(event.target.tagName) || event.metaKey || event.ctrlKey || event.altKey) return;
        if (event.repeat || !event.key || event.key.toLowerCase() !== 's') return;
        if (isOn() && settings.showMuteButton) toggleMuted();
      });
      renderButton();
    }

    /* --------------------------------------------------------------- update */

    /**
     * Takes the latest settings. Safe to call at any time — live updates from
     * the console arrive this way — and only restarts what actually changed.
     */
    function update(soundSettings, pageCopy) {
      const before = settings ? JSON.stringify(settings.cues.ambient) + settings.library.map((t) => t.src).join() : null;
      const wasOn = isOn();
      settings = soundSettings;
      copy = pageCopy || copy;

      if (!isOn()) {
        stopAll();
      } else {
        if (!wasOn) unlock();
        applyMaster();
        preloadTracks();
        const after = JSON.stringify(settings.cues.ambient) + settings.library.map((t) => t.src).join();
        if (before !== null && before !== after && active.has('ambient')) {
          stop('ambient', 300);
          global.setTimeout(startAmbient, 400);
        }
        if (!ambientBelongsHere()) stop('ambient');
      }
      renderButton();
    }

    return {
      update,
      // For a caller already inside a click, such as the console's Preview:
      // the engine's own first-click listener may have run before sound was
      // switched on for this page, and so skipped creating the context.
      unlock: () => unlock(true),
      play,
      stop,
      stopAll,
      startAmbient,
      pauseAmbient,
      resumeAmbient,
      mountButton,
      setMuted,
      isMuted: () => muted,
      isOn,
    };
  }

  global.createPickoraSound = createSound;
})(window, document);

/**
 * The built-in sounds, synthesised on the spot with the Web Audio API.
 *
 * Nothing here is a recording: every sound is built from oscillators and
 * filtered noise when it is asked for. So there is nothing to download,
 * nothing to license, and the sounds work on an offline board exactly as on a
 * hosted one.
 *
 * Each preset is `play(ctx, out, when)` and returns a voice:
 *   { naturalMs, loops, stop(at) }
 * `naturalMs` is how long a one-shot rings for; a looping preset has none and
 * plays until stopped. `out` is the cue's own gain node — volume and fades are
 * the engine's business (sound.js), not the preset's.
 */
(function soundPresets(global) {
  'use strict';

  /* --------------------------------------------------------- building blocks */

  const noiseBuffers = new WeakMap();

  /** Two seconds of white noise, made once per audio context. */
  function noiseBuffer(ctx) {
    if (noiseBuffers.has(ctx)) return noiseBuffers.get(ctx);
    const buffer = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let index = 0; index < data.length; index += 1) data[index] = Math.random() * 2 - 1;
    noiseBuffers.set(ctx, buffer);
    return buffer;
  }

  function midi(note) {
    return 440 * 2 ** ((note - 69) / 12);
  }

  /**
   * One enveloped note. Attack to `gain`, hold, then an exponential release.
   * Everything is scheduled ahead on the audio clock, so timing never depends
   * on the main thread being free.
   */
  function tone(ctx, out, options) {
    const {
      type = 'sine',
      freq,
      start,
      duration,
      gain = 0.3,
      attack = 0.005,
      release = 0.2,
      detune = 0,
      glideTo = null,
      filter = null,
      vibrato = null,
    } = options;

    const osc = ctx.createOscillator();
    const amp = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, start);
    if (glideTo) osc.frequency.exponentialRampToValueAtTime(glideTo, start + duration);
    osc.detune.value = detune;

    let head = osc;
    if (filter) {
      const node = ctx.createBiquadFilter();
      node.type = filter.type || 'lowpass';
      node.frequency.setValueAtTime(filter.freq, start);
      if (filter.to) node.frequency.exponentialRampToValueAtTime(filter.to, start + (filter.over || duration));
      node.Q.value = filter.q || 0.7;
      osc.connect(node);
      head = node;
    }

    if (vibrato) {
      const lfo = ctx.createOscillator();
      const depth = ctx.createGain();
      lfo.frequency.value = vibrato.rate;
      depth.gain.value = vibrato.depth;
      lfo.connect(depth);
      depth.connect(osc.frequency);
      lfo.start(start);
      lfo.stop(start + duration + release + 0.05);
    }

    amp.gain.setValueAtTime(0.0001, start);
    amp.gain.exponentialRampToValueAtTime(gain, start + attack);
    amp.gain.setValueAtTime(gain, start + Math.max(attack, duration));
    amp.gain.exponentialRampToValueAtTime(0.0001, start + duration + release);

    head.connect(amp);
    amp.connect(out);
    osc.start(start);
    osc.stop(start + duration + release + 0.05);
    return osc;
  }

  /** A burst of filtered noise — snares, cymbals, claps, clicks. */
  function noise(ctx, out, options) {
    const { start, duration, gain = 0.3, attack = 0.002, release = 0.1, filter = { type: 'bandpass', freq: 2000, q: 1 } } = options;
    const source = ctx.createBufferSource();
    source.buffer = noiseBuffer(ctx);
    source.loop = true;

    const shape = ctx.createBiquadFilter();
    shape.type = filter.type;
    shape.frequency.setValueAtTime(filter.freq, start);
    if (filter.to) shape.frequency.exponentialRampToValueAtTime(filter.to, start + duration);
    shape.Q.value = filter.q || 1;

    const amp = ctx.createGain();
    amp.gain.setValueAtTime(0.0001, start);
    amp.gain.exponentialRampToValueAtTime(gain, start + attack);
    amp.gain.exponentialRampToValueAtTime(0.0001, start + duration + release);

    source.connect(shape);
    shape.connect(amp);
    amp.connect(out);
    source.start(start, Math.random() * 1.5);
    source.stop(start + duration + release + 0.05);
    return source;
  }

  /** A bell: a few inharmonic partials with long, staggered decays. */
  function bell(ctx, out, freq, start, gain = 0.2, length = 2.2) {
    [
      [1, 1, 1],
      [2.76, 0.45, 0.6],
      [5.4, 0.25, 0.4],
      [8.93, 0.12, 0.25],
    ].forEach(([ratio, level, decay]) => {
      tone(ctx, out, { freq: freq * ratio, start, duration: 0.01, gain: gain * level, release: length * decay });
    });
  }

  /** A brass-like note: a sawtooth whose filter opens as it speaks. */
  function brass(ctx, out, freq, start, duration, gain = 0.16) {
    [-6, 6].forEach((detune) => {
      tone(ctx, out, {
        type: 'sawtooth',
        freq,
        start,
        duration,
        gain: gain / 2,
        attack: 0.04,
        release: 0.25,
        detune,
        filter: { type: 'lowpass', freq: 500, to: 2600, over: 0.12, q: 1.2 },
      });
    });
  }

  /** A one-shot voice: rings for `naturalMs`, and a stop just lets it finish. */
  function oneShot(naturalMs, nodes = []) {
    return {
      naturalMs,
      loops: false,
      stop(at) {
        nodes.forEach((node) => {
          try {
            node.stop(at);
          } catch (_error) {
            /* already stopped */
          }
        });
      },
    };
  }

  /**
   * A looping voice driven by a scheduler: every so often `step(time)` is
   * asked for the next event, which is scheduled a little ahead on the audio
   * clock. Stopping clears the scheduler; what is already scheduled rings out
   * under the engine's fade.
   */
  function scheduled(ctx, when, step, lookahead = 0.25) {
    let next = when;
    let count = 0;
    let stopped = false;

    function pump() {
      if (stopped) return;
      while (next < ctx.currentTime + lookahead) {
        const advance = step(next, count);
        count += 1;
        next += advance;
      }
    }

    pump();
    const timer = global.setInterval(pump, 50);

    return {
      naturalMs: null,
      loops: true,
      stop() {
        stopped = true;
        global.clearInterval(timer);
      },
    };
  }

  /* ------------------------------------------------------------- the sounds */

  const CHORDS = {
    lounge: [
      [48, 55, 59, 64],
      [45, 52, 55, 60],
      [41, 48, 52, 57],
      [43, 50, 53, 59],
    ],
    gala: [
      [50, 57, 62, 66],
      [47, 54, 59, 62],
      [43, 50, 55, 59],
      [45, 52, 57, 61],
    ],
  };

  const PRESETS = {
    ambient: {
      // Slow, warm chords: a soft room tone that sits under conversation.
      lounge(ctx, out, when) {
        return scheduled(ctx, when, (time, count) => {
          const chord = CHORDS.lounge[count % CHORDS.lounge.length];
          chord.forEach((note, index) => {
            tone(ctx, out, {
              type: index === 0 ? 'triangle' : 'sine',
              freq: midi(note),
              start: time,
              duration: 3.6,
              gain: index === 0 ? 0.12 : 0.07,
              attack: 1.1,
              release: 1.4,
              filter: { type: 'lowpass', freq: 1400 },
            });
          });
          return 4;
        }, 0.6);
      },

      // A bell arpeggio over a gentle pad: evening-dress, not background hum.
      gala(ctx, out, when) {
        const beat = 60 / 84 / 2;
        return scheduled(ctx, when, (time, count) => {
          const bar = Math.floor(count / 8);
          const chord = CHORDS.gala[bar % CHORDS.gala.length];
          if (count % 8 === 0) {
            chord.slice(0, 3).forEach((note) => {
              tone(ctx, out, { type: 'sine', freq: midi(note), start: time, duration: beat * 7, gain: 0.05, attack: 0.6, release: 1 });
            });
          }
          const order = [0, 1, 2, 3, 2, 1, 2, 3];
          bell(ctx, out, midi(chord[order[count % 8]] + 12), time, 0.06, 1.6);
          return beat;
        }, 0.4);
      },

      // A pulsing electronic bed: bass on every eighth, a stab every bar.
      pulse(ctx, out, when) {
        const eighth = 60 / 118 / 2;
        const roots = [45, 45, 41, 43];
        return scheduled(ctx, when, (time, count) => {
          const root = roots[Math.floor(count / 8) % roots.length];
          tone(ctx, out, {
            type: 'square',
            freq: midi(root - 12),
            start: time,
            duration: eighth * 0.55,
            gain: 0.07,
            release: 0.05,
            filter: { type: 'lowpass', freq: 420 },
          });
          if (count % 8 === 0) {
            [0, 7, 12, 16].forEach((interval) => {
              tone(ctx, out, {
                type: 'sawtooth',
                freq: midi(root + interval),
                start: time,
                duration: eighth * 3,
                gain: 0.025,
                attack: 0.02,
                release: 0.4,
                filter: { type: 'lowpass', freq: 900, to: 2400, over: eighth * 2 },
              });
            });
          }
          return eighth;
        });
      },

      // Sparse high bells in a pentatonic scale, never repeating a pattern.
      celesta(ctx, out, when) {
        const scale = [72, 74, 76, 79, 81, 84, 86, 88];
        return scheduled(ctx, when, (time) => {
          bell(ctx, out, midi(scale[Math.floor(Math.random() * scale.length)]), time, 0.07, 2.4);
          return 0.45 + Math.random() * 0.7;
        }, 0.5);
      },
    },

    spin: {
      // A snare roll that swells while the reel turns.
      drumroll(ctx, out, when) {
        const started = when;
        return scheduled(ctx, when, (time) => {
          const swell = Math.min(1, 0.45 + (time - started) / 6);
          noise(ctx, out, {
            start: time,
            duration: 0.03,
            gain: (0.16 + Math.random() * 0.06) * swell,
            release: 0.05,
            filter: { type: 'bandpass', freq: 1800 + Math.random() * 600, q: 0.8 },
          });
          return 0.042 + Math.random() * 0.006;
        }, 0.15);
      },

      // A clockwork ticker, like a prize wheel's pointer.
      ticker(ctx, out, when) {
        return scheduled(ctx, when, (time, count) => {
          tone(ctx, out, { type: 'square', freq: count % 2 ? 2100 : 1700, start: time, duration: 0.008, gain: 0.12, release: 0.02 });
          return 0.085;
        }, 0.15);
      },

      // A rising synth sweep that keeps climbing, then holds the tension.
      riser(ctx, out, when) {
        const osc = ctx.createOscillator();
        const filter = ctx.createBiquadFilter();
        const amp = ctx.createGain();
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(110, when);
        osc.frequency.exponentialRampToValueAtTime(880, when + 9);
        filter.type = 'lowpass';
        filter.frequency.setValueAtTime(300, when);
        filter.frequency.exponentialRampToValueAtTime(4000, when + 9);
        filter.Q.value = 6;
        amp.gain.setValueAtTime(0.0001, when);
        amp.gain.exponentialRampToValueAtTime(0.09, when + 0.4);
        osc.connect(filter);
        filter.connect(amp);
        amp.connect(out);
        osc.start(when);

        const wobble = scheduled(ctx, when, (time) => {
          noise(ctx, out, { start: time, duration: 0.4, gain: 0.03, attack: 0.2, release: 0.2, filter: { type: 'highpass', freq: 5000 } });
          return 0.5;
        }, 0.6);

        return {
          naturalMs: null,
          loops: true,
          stop(at) {
            wobble.stop();
            try {
              osc.stop(at + 0.05);
            } catch (_error) {
              /* already stopped */
            }
          },
        };
      },

      // An 8-bit arpeggio, as fast as a slot machine.
      arcade(ctx, out, when) {
        const notes = [72, 76, 79, 84, 79, 76];
        return scheduled(ctx, when, (time, count) => {
          tone(ctx, out, { type: 'square', freq: midi(notes[count % notes.length]), start: time, duration: 0.05, gain: 0.07, release: 0.02 });
          return 0.07;
        });
      },

      // A heartbeat that quickens the longer the reel runs.
      heartbeat(ctx, out, when) {
        const started = when;
        return scheduled(ctx, when, (time) => {
          const elapsed = time - started;
          const bpm = Math.min(132, 72 + elapsed * 7);
          [0, 0.17].forEach((offset, index) => {
            tone(ctx, out, {
              freq: index === 0 ? 62 : 55,
              glideTo: 38,
              start: time + offset,
              duration: 0.12,
              gain: index === 0 ? 0.5 : 0.35,
              attack: 0.004,
              release: 0.12,
            });
          });
          return 60 / bpm;
        }, 0.3);
      },
    },

    land: {
      cymbal(ctx, out, when) {
        noise(ctx, out, { start: when, duration: 0.05, gain: 0.32, release: 1.9, filter: { type: 'highpass', freq: 5200, q: 0.4 } });
        noise(ctx, out, { start: when, duration: 0.02, gain: 0.2, release: 0.5, filter: { type: 'bandpass', freq: 3200, q: 2 } });
        [3150, 4720, 6310].forEach((freq) => {
          tone(ctx, out, { type: 'square', freq, start: when, duration: 0.01, gain: 0.012, release: 1.2 });
        });
        return oneShot(2000);
      },

      gong(ctx, out, when) {
        [[73, 0.36], [146.5, 0.14], [197, 0.1], [251, 0.07], [329, 0.04]].forEach(([freq, gain], index) => {
          tone(ctx, out, { freq, start: when, duration: 0.05, gain, attack: 0.01, release: 3.2 - index * 0.35, vibrato: { rate: 4 + index, depth: 0.6 } });
        });
        noise(ctx, out, { start: when, duration: 0.03, gain: 0.08, release: 0.3, filter: { type: 'lowpass', freq: 900 } });
        return oneShot(3400);
      },

      chime(ctx, out, when) {
        [88, 83, 91].forEach((note, index) => bell(ctx, out, midi(note), when + index * 0.09, 0.14, 1.8));
        return oneShot(2200);
      },

      thud(ctx, out, when) {
        tone(ctx, out, { freq: 150, glideTo: 42, start: when, duration: 0.35, gain: 0.7, attack: 0.003, release: 0.15 });
        noise(ctx, out, { start: when, duration: 0.02, gain: 0.25, release: 0.06, filter: { type: 'lowpass', freq: 1200 } });
        return oneShot(600);
      },
    },

    reveal: {
      // Up the major triad and onto a held chord, like a stage brass section.
      fanfare(ctx, out, when) {
        const beat = 0.14;
        [60, 64, 67].forEach((note, index) => brass(ctx, out, midi(note), when + index * beat, beat * 0.85, 0.16));
        [60, 64, 67, 72].forEach((note) => brass(ctx, out, midi(note), when + 3 * beat, 1.6, 0.13));
        noise(ctx, out, { start: when + 3 * beat, duration: 0.05, gain: 0.15, release: 1.4, filter: { type: 'highpass', freq: 6000 } });
        return oneShot(2600);
      },

      tada(ctx, out, when) {
        [55, 59, 62].forEach((note) => brass(ctx, out, midi(note), when, 0.12, 0.13));
        [60, 64, 67, 72].forEach((note) => brass(ctx, out, midi(note), when + 0.2, 1.3, 0.13));
        return oneShot(1900);
      },

      bells(ctx, out, when) {
        [84, 88, 91, 96, 100].forEach((note, index) => bell(ctx, out, midi(note), when + index * 0.11, 0.13, 2.4));
        return oneShot(3000);
      },

      arcade(ctx, out, when) {
        [72, 76, 79, 84, 79, 84].forEach((note, index) => {
          const isLast = index === 5;
          tone(ctx, out, {
            type: 'square',
            freq: midi(note),
            start: when + index * 0.1,
            duration: isLast ? 0.6 : 0.08,
            gain: 0.09,
            release: isLast ? 0.3 : 0.02,
            vibrato: isLast ? { rate: 7, depth: 8 } : null,
          });
        });
        return oneShot(1500);
      },

      // A room applauding: a few hundred claps, swelling and fading.
      applause(ctx, out, when) {
        const length = 3.2;
        for (let index = 0; index < 260; index += 1) {
          const at = Math.random() * length;
          const swell = Math.sin((at / length) * Math.PI);
          noise(ctx, out, {
            start: when + at,
            duration: 0.012,
            gain: 0.05 + swell * 0.1 * Math.random(),
            release: 0.04,
            filter: { type: 'bandpass', freq: 900 + Math.random() * 1800, q: 1.4 },
          });
        }
        return oneShot(length * 1000 + 300);
      },
    },

    absent: {
      // The sad trombone: down by semitones, the last note wobbling.
      trombone(ctx, out, when) {
        [58, 57, 56, 55].forEach((note, index) => {
          const isLast = index === 3;
          tone(ctx, out, {
            type: 'sawtooth',
            freq: midi(note),
            start: when + index * 0.42,
            duration: isLast ? 1.1 : 0.34,
            gain: 0.12,
            attack: 0.05,
            release: 0.2,
            filter: { type: 'lowpass', freq: 900 },
            vibrato: isLast ? { rate: 5.5, depth: 6 } : null,
          });
        });
        return oneShot(2700);
      },

      descend(ctx, out, when) {
        [76, 72, 69].forEach((note, index) => bell(ctx, out, midi(note), when + index * 0.22, 0.12, 1.6));
        return oneShot(2200);
      },

      buzz(ctx, out, when) {
        [0, 0.28].forEach((offset) => {
          tone(ctx, out, { type: 'square', freq: 98, start: when + offset, duration: 0.22, gain: 0.12, release: 0.03, filter: { type: 'lowpass', freq: 1100 } });
        });
        return oneShot(650);
      },
    },

    countdownTick: {
      tick(ctx, out, when) {
        noise(ctx, out, { start: when, duration: 0.01, gain: 0.35, release: 0.03, filter: { type: 'bandpass', freq: 3200, q: 3 } });
        return oneShot(80);
      },
      beep(ctx, out, when) {
        tone(ctx, out, { freq: 880, start: when, duration: 0.07, gain: 0.18, release: 0.03 });
        return oneShot(140);
      },
      wood(ctx, out, when) {
        tone(ctx, out, { freq: 1250, glideTo: 900, start: when, duration: 0.03, gain: 0.3, release: 0.06 });
        noise(ctx, out, { start: when, duration: 0.01, gain: 0.1, release: 0.02, filter: { type: 'bandpass', freq: 2400, q: 4 } });
        return oneShot(120);
      },
    },

    countdownEnd: {
      // An air horn: three detuned saws, a hard edge and a long blast.
      horn(ctx, out, when) {
        [-14, 0, 12].forEach((detune) => {
          tone(ctx, out, {
            type: 'sawtooth',
            freq: 466,
            start: when,
            duration: 1.1,
            gain: 0.06,
            attack: 0.02,
            release: 0.18,
            detune,
            filter: { type: 'lowpass', freq: 3200 },
          });
        });
        return oneShot(1400);
      },
      chime(ctx, out, when) {
        return PRESETS.land.chime(ctx, out, when);
      },
      gong(ctx, out, when) {
        return PRESETS.land.gong(ctx, out, when);
      },
    },
  };

  /** The names the console shows for each built-in sound. */
  const LABELS = {
    lounge: 'Lounge — warm, slow chords',
    gala: 'Gala — bells over a soft pad',
    pulse: 'Pulse — electronic bed',
    celesta: 'Celesta — sparse high bells',
    drumroll: 'Drumroll',
    ticker: 'Prize-wheel ticker',
    riser: 'Rising synth sweep',
    arcade: 'Arcade',
    heartbeat: 'Heartbeat',
    cymbal: 'Cymbal crash',
    gong: 'Gong',
    chime: 'Chime',
    thud: 'Deep thud',
    fanfare: 'Brass fanfare',
    tada: 'Ta-da',
    bells: 'Bells',
    applause: 'Applause',
    trombone: 'Sad trombone',
    descend: 'Falling chime',
    buzz: 'Game-show buzzer',
    tick: 'Clock tick',
    beep: 'Beep',
    wood: 'Woodblock',
    horn: 'Air horn',
  };

  /** Starts a built-in sound. Returns null for a name that does not exist. */
  function play(ctx, out, cue, preset, when) {
    const family = PRESETS[cue];
    const builder = family && family[preset];
    return builder ? builder(ctx, out, when) : null;
  }

  global.PickoraSoundPresets = {
    play,
    LABELS,
    names: (cue) => Object.keys(PRESETS[cue] || {}),
  };
})(window);

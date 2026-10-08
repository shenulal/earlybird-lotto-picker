/**
 * The spin-the-wheel draw style.
 *
 * A drop-in for the reel (reel.js): the same start / settle / land / destroy
 * shape, so the board treats them alike. The server still makes the draw;
 * the wheel only shows it.
 *
 * As with the reel, nothing is ever swapped in view. The wheel cruises until
 * Stop, keeps turning until the winner is named, then writes the winner on
 * the segment directly opposite the pointer — the one furthest from where
 * anyone is looking, while the wheel is still a blur — and decelerates at a
 * constant rate so exactly that segment comes to rest under the pointer.
 * The speed falls smoothly from whatever it was; the wheel never surges.
 *
 * Everything you see is configured: segment count, colours, size, text,
 * speed, settle time, pointer side, centre logo or text.
 */
(function wheelModule(global, document) {
  'use strict';

  const SPIN_UP_MS = 600;
  const LANDED_HOLD_MS = 650;
  const MAX_FRAME_MS = 48;
  const TAU = Math.PI * 2;
  const POINTER_ANGLES = { top: -Math.PI / 2, right: 0, bottom: Math.PI / 2, left: Math.PI };
  const FALLBACK_PALETTE = ['#ffd54f', '#ff8a65', '#4dd0e1', '#f06292', '#aed581', '#9575cd'];

  function clamp(value, low, high) {
    return Math.min(high, Math.max(low, value));
  }

  /** Readable text on a segment: dark on light colours, light on dark. */
  function inkFor(hex, configured) {
    if (configured) return configured;
    const value = hex.replace('#', '');
    const full = value.length === 3 ? value.split('').map((c) => c + c).join('') : value.slice(0, 6);
    const [r, g, b] = [0, 2, 4].map((offset) => parseInt(full.slice(offset, offset + 2), 16) / 255);
    const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    return luminance > 0.6 ? '#1b1d24' : '#ffffff';
  }

  /**
   * Creates a wheel inside `mount`.
   *   renderLabel(entry) — the text for one entry's segment
   *   deal()             — the next entry to put on a segment
   *   options            — the organiser's wheel settings, plus `palette` and
   *                        `logoSrc` resolved by the board
   */
  function createWheel(mount, { renderLabel, deal, reducedMotion = false, onLanded = () => {}, options }) {
    const settings = options || {};
    mount.innerHTML = `
      <div class="wheel-wrap" data-pointer="${settings.pointer || 'top'}">
        <canvas class="wheel-canvas" aria-hidden="true"></canvas>
        <span class="wheel-pointer" aria-hidden="true"></span>
        <p class="wheel-result" aria-live="polite"></p>
      </div>`;

    const wrap = mount.querySelector('.wheel-wrap');
    const canvas = mount.querySelector('.wheel-canvas');
    const result = mount.querySelector('.wheel-result');
    const context = canvas.getContext('2d');
    const palette = settings.palette && settings.palette.length ? settings.palette : FALLBACK_PALETTE;
    const pointerAngle = POINTER_ANGLES[settings.pointer] ?? POINTER_ANGLES.top;

    let segments = [];
    let labels = [];
    let angle = 0;
    let velocity = 0; // radians per millisecond
    let cruise = 0;
    let phase = 'idle';
    let frameId = null;
    let lastFrameAt = 0;
    let spinStartedAt = 0;
    let stopping = null;
    let landingEntry = null;
    let settle = null;
    let winnerIndex = -1;
    let logo = null;
    let size = 0;

    if (settings.centerLogo && settings.logoSrc) {
      const image = new Image();
      image.onload = () => {
        logo = image;
        draw();
      };
      image.src = settings.logoSrc;
    }

    /* ------------------------------------------------------------ geometry */

    function measure() {
      const available = Math.min(mount.clientWidth || 600, global.innerHeight * 0.62);
      size = Math.round(settings.size > 0 ? Math.min(settings.size, available) : clamp(available, 240, 900));
      const ratio = global.devicePixelRatio || 1;
      canvas.width = size * ratio;
      canvas.height = size * ratio;
      canvas.style.width = `${size}px`;
      canvas.style.height = `${size}px`;
      wrap.style.setProperty('--wheel-size', `${size}px`);
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
    }

    function segmentAngle() {
      return TAU / segments.length;
    }

    /** The segment whose centre is nearest `target` right now. */
    function segmentAt(target) {
      const arc = segmentAngle();
      const relative = (((target - angle) % TAU) + TAU) % TAU;
      return Math.floor(relative / arc) % segments.length;
    }

    /* ----------------------------------------------------------------- draw */

    function fitText(text, maxWidth, fontSize) {
      let value = String(text || '');
      context.font = `700 ${fontSize}px 'Bebas Neue', 'Lato', sans-serif`;
      if (context.measureText(value).width <= maxWidth) return value;
      while (value.length > 1 && context.measureText(`${value}…`).width > maxWidth) value = value.slice(0, -1);
      return `${value}…`;
    }

    function draw() {
      if (!size) return;
      const radius = size / 2;
      const arc = segmentAngle();
      const fontSize = settings.fontSize > 0 ? settings.fontSize : clamp(Math.round(size / 26), 11, 34);
      context.clearRect(0, 0, size, size);

      segments.forEach((color, index) => {
        const start = angle + index * arc;
        context.beginPath();
        context.moveTo(radius, radius);
        context.arc(radius, radius, radius - 4, start, start + arc);
        context.closePath();
        context.fillStyle = color;
        context.fill();
        if (index === winnerIndex && phase === 'landed') {
          context.fillStyle = 'rgba(255, 255, 255, 0.28)';
          context.fill();
        }
        context.strokeStyle = settings.borderColor || 'rgba(0, 0, 0, 0.18)';
        context.lineWidth = 1.5;
        context.stroke();

        if (settings.showLabels !== false && labels[index]) {
          context.save();
          context.translate(radius, radius);
          context.rotate(start + arc / 2);
          context.textAlign = 'right';
          context.textBaseline = 'middle';
          context.fillStyle = inkFor(color, settings.textColor);
          const text = fitText(labels[index], radius * 0.62, fontSize);
          context.fillText(text, radius - 18, 0);
          context.restore();
        }
      });

      // The rim, then the hub with the event's logo or the organiser's text.
      context.beginPath();
      context.arc(radius, radius, radius - 3, 0, TAU);
      context.lineWidth = 6;
      context.strokeStyle = settings.borderColor || 'rgba(255, 255, 255, 0.85)';
      context.stroke();

      const hub = radius * 0.2;
      context.beginPath();
      context.arc(radius, radius, hub, 0, TAU);
      context.fillStyle = '#0d0f1c';
      context.fill();
      context.lineWidth = 3;
      context.strokeStyle = settings.borderColor || 'rgba(255, 255, 255, 0.85)';
      context.stroke();

      if (logo) {
        const scale = Math.min((hub * 1.4) / logo.width, (hub * 1.4) / logo.height);
        const width = logo.width * scale;
        const height = logo.height * scale;
        context.drawImage(logo, radius - width / 2, radius - height / 2, width, height);
      } else if (settings.centerText) {
        context.fillStyle = '#ffffff';
        context.textAlign = 'center';
        context.textBaseline = 'middle';
        context.fillText(fitText(settings.centerText, hub * 1.7, Math.round(hub * 0.42)), radius, radius);
      }
    }

    /* --------------------------------------------------------------- frames */

    function frame(now) {
      const elapsed = Math.min(now - lastFrameAt, MAX_FRAME_MS);
      lastFrameAt = now;

      if (phase === 'spin') {
        const progress = Math.min(1, (now - spinStartedAt) / SPIN_UP_MS);
        velocity = cruise * progress * progress;
        angle += velocity * elapsed;
        if (progress >= 1) phase = 'cruise';
      } else if (phase === 'cruise' || phase === 'waiting') {
        velocity = cruise;
        angle += velocity * elapsed;
      } else if (phase === 'settle') {
        // Constant deceleration from the speed it had: angle = θ0 + v·t − v·t²/2T.
        const t = Math.min(now - settle.startedAt, settle.duration);
        angle = settle.from + settle.speed * t - (settle.speed * t * t) / (2 * settle.duration);
        velocity = settle.speed * (1 - t / settle.duration);
        if (t >= settle.duration) {
          angle = settle.from + settle.distance;
          finish();
          return;
        }
      }

      wrap.style.setProperty('--wheel-speed', cruise > 0 ? clamp(velocity / cruise, 0, 1).toFixed(3) : '0');
      draw();
      frameId = global.requestAnimationFrame(frame);
    }

    function finish() {
      phase = 'landed';
      velocity = 0;
      frameId = null;
      wrap.classList.add('is-landed');
      wrap.style.setProperty('--wheel-speed', '0');
      draw();
      result.textContent = landingEntry ? renderLabel(landingEntry) : '';
      onLanded();
      const { resolve } = stopping;
      stopping = null;
      global.setTimeout(resolve, LANDED_HOLD_MS);
    }

    /**
     * Picks where to stop, once the winner is known: the segment opposite the
     * pointer is given the winner's label and travels half a turn plus whole
     * turns to arrive, decelerating evenly over about the configured time.
     */
    function planLanding() {
      const arc = segmentAngle();
      winnerIndex = segmentAt(pointerAngle + Math.PI);
      labels[winnerIndex] = renderLabel(landingEntry);

      const speed = Math.max(velocity, cruise * 0.25, 0.0005);
      const target = reducedMotion ? 900 : settings.settleMs || 5000;
      // Where the winner's centre is now, and how far it must go to reach the
      // pointer, in whole turns beyond the first half-turn.
      const centre = angle + (winnerIndex + 0.5) * arc;
      const base = ((((pointerAngle - centre) % TAU) + TAU) % TAU) || TAU;
      const wanted = (speed * target) / 2;
      const turns = Math.max(0, Math.round((wanted - base) / TAU));
      const distance = base + turns * TAU;

      settle = {
        from: angle,
        distance,
        speed,
        duration: (2 * distance) / speed,
        startedAt: global.performance.now(),
      };
      phase = 'settle';
    }

    /* ------------------------------------------------------------------ api */

    function start(_msPerItem) {
      measure();
      const count = Math.max(2, settings.segments || 16);
      segments = Array.from({ length: count }, (_unused, index) => palette[index % palette.length]);
      // An odd colour count that does not divide the segments would put two
      // of the same colour side by side at the seam; nudge the last one.
      if (count % palette.length === 1 && palette.length > 1) segments[count - 1] = palette[1];
      labels = segments.map(() => {
        const entry = deal();
        return entry ? renderLabel(entry) : '';
      });

      angle = Math.random() * TAU;
      winnerIndex = -1;
      landingEntry = null;
      stopping = null;
      settle = null;
      result.textContent = '';
      wrap.classList.remove('is-landed');

      const turnsPerSecond = (settings.speed || 12) / 10;
      cruise = (TAU * turnsPerSecond * (reducedMotion ? 0.15 : 1)) / 1000;

      phase = 'spin';
      spinStartedAt = global.performance.now();
      lastFrameAt = spinStartedAt;
      frameId = global.requestAnimationFrame(frame);
    }

    /** Stop was pressed: keep turning until the winner is named, then land. */
    function settleTo(minimumMs) {
      if (stopping) return Promise.resolve();
      if (phase !== 'spin' && phase !== 'cruise') return Promise.resolve();

      const done = new Promise((resolve) => {
        stopping = { stoppedAt: global.performance.now(), minimumMs: Number(minimumMs) || 0, resolve };
      });
      phase = 'waiting';
      if (landingEntry) planLanding();
      return done;
    }

    function land(entry) {
      if (!entry || landingEntry) return;
      landingEntry = entry;
      if (stopping && phase === 'waiting') planLanding();
    }

    function destroy() {
      if (frameId !== null) global.cancelAnimationFrame(frameId);
      frameId = null;
      settle = null;
      stopping = null;
      phase = 'idle';
    }

    /** A still wheel for previews: drawn once, not spinning. */
    function preview(entries) {
      measure();
      const count = Math.max(2, settings.segments || 16);
      segments = Array.from({ length: count }, (_unused, index) => palette[index % palette.length]);
      if (count % palette.length === 1 && palette.length > 1) segments[count - 1] = palette[1];
      labels = segments.map((_unused, index) => (entries.length ? renderLabel(entries[index % entries.length]) : ''));
      angle = pointerAngle - segmentAngle() / 2;
      draw();
    }

    return { start, settle: settleTo, land, destroy, preview };
  }

  global.createPickoraWheel = createWheel;
})(window, document);

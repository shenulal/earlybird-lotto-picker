/**
 * The celebration for a winner reveal.
 *
 * Four kinds of paper share the air: streamers that twist as they fall and
 * catch the light on each turn, stars that tumble and twinkle, foil rectangles
 * that flip edge-on and back, and small round dots that fill the gaps between
 * them. Two cannons fire up from the bottom corners on the first frame and a
 * softer fall keeps coming from above, so the reveal opens with a bang and
 * then drifts.
 *
 * Kept independent of the board controller so it can be started, stopped and
 * resized on its own.
 */
(function attachConfetti(global) {
  'use strict';

  const GRAVITY = 0.075;
  const TERMINAL = 5.2;
  // How hard the air pulls a piece toward the prevailing drift.
  const DRAG = 0.022;
  // The tail after emission stops, for the last pieces to clear the screen.
  const TAIL_MS = 2200;
  const FADE_MS = 900;
  const RIBBON_SEGMENTS = 14;

  const DEFAULT_PALETTE = ['#ffd54f', '#ff8a65', '#4dd0e1', '#f06292', '#aed581', '#ffffff'];

  // Streamers and foil carry the movement; stars catch the eye; dots fill in.
  const KINDS = [
    { kind: 'foil', share: 0.34 },
    { kind: 'ribbon', share: 0.26 },
    { kind: 'star', share: 0.22 },
    { kind: 'dot', share: 0.18 },
  ];

  function pickKind() {
    let roll = Math.random();
    for (const entry of KINDS) {
      roll -= entry.share;
      if (roll <= 0) return entry.kind;
    }
    return 'foil';
  }

  function random(low, high) {
    return low + Math.random() * (high - low);
  }

  /**
   * The colour of the reverse of a piece.
   *
   * Paper turning over shows its unlit side, and that shift is most of what
   * makes a streamer read as a three-dimensional twist rather than a squiggle.
   */
  function shade(color, amount) {
    const hex = String(color).replace('#', '');
    const full = hex.length === 3 ? hex.split('').map((c) => c + c).join('') : hex;
    const value = Number.parseInt(full, 16);
    if (!Number.isFinite(value)) return color;

    const channel = (shift) => Math.round(((value >> shift) & 255) * amount);
    return `rgb(${channel(16)}, ${channel(8)}, ${channel(0)})`;
  }

  function createPiece(view, palette, options = {}) {
    const color = palette[Math.floor(Math.random() * palette.length)];
    const kind = options.kind || pickKind();
    const size = kind === 'dot' ? random(3, 6) : random(6, 12);

    return {
      kind,
      color,
      back: shade(color, 0.55),
      size,
      x: options.x !== undefined ? options.x : Math.random() * view.width,
      y: options.y !== undefined ? options.y : random(-view.height * 0.5, -10),
      velocityX: options.velocityX !== undefined ? options.velocityX : random(-0.5, 0.5),
      velocityY: options.velocityY !== undefined ? options.velocityY : random(1.2, 3),
      spin: Math.random() * Math.PI * 2,
      spinRate: random(-0.14, 0.14),
      // The tumble: a separate phase, so a piece can spin and turn over at once.
      flip: Math.random() * Math.PI * 2,
      flipRate: random(0.06, 0.17) * (Math.random() < 0.5 ? -1 : 1),
      // Flutter, which is what stops the fall looking like rain.
      swayAmplitude: random(0.25, 1.1),
      swayRate: random(0.02, 0.05),
      swayPhase: Math.random() * Math.PI * 2,
      twinkle: Math.random() * Math.PI * 2,
      waves: random(0.45, 0.95),
      length: random(5.5, 9),
      alpha: random(0.75, 1),
    };
  }

  /** Two cannons at the bottom corners, fired on the opening frame. */
  function createBurstPiece(view, palette, fromLeft) {
    const angle = fromLeft ? random(-1.35, -0.75) : random(-2.39, -1.79);
    const speed = random(9, 17);

    return createPiece(view, palette, {
      x: fromLeft ? random(-20, view.width * 0.12) : random(view.width * 0.88, view.width + 20),
      y: random(view.height * 0.82, view.height + 10),
      velocityX: Math.cos(angle) * speed,
      velocityY: Math.sin(angle) * speed,
    });
  }

  /* ------------------------------------------------------------- drawing */

  function drawStar(context, piece) {
    const outer = piece.size * 0.85;
    const inner = outer * 0.44;

    context.beginPath();
    for (let point = 0; point < 10; point += 1) {
      const radius = point % 2 === 0 ? outer : inner;
      const angle = (point * Math.PI) / 5 - Math.PI / 2;
      const x = Math.cos(angle) * radius;
      const y = Math.sin(angle) * radius;
      if (point === 0) context.moveTo(x, y);
      else context.lineTo(x, y);
    }
    context.closePath();
    context.fill();

    // A bright core, so a star still reads as one at the back of a hall.
    context.globalAlpha *= 0.7;
    context.fillStyle = '#ffffff';
    context.beginPath();
    context.arc(0, 0, inner * 0.5, 0, Math.PI * 2);
    context.fill();
  }

  /**
   * A streamer, drawn segment by segment.
   *
   * The width of each segment follows a sine along the length, so the ribbon
   * pinches to nothing where it turns over; the sign of that sine picks the
   * front or the back colour, which is what gives the twist its depth.
   */
  function drawRibbon(context, piece) {
    const length = piece.size * piece.length;
    const halfWidth = piece.size * 0.42;
    const step = length / RIBBON_SEGMENTS;
    let previousY = -length / 2;
    let previousTwist = Math.sin(piece.flip);
    let previousWave = 0;

    for (let segment = 1; segment <= RIBBON_SEGMENTS; segment += 1) {
      const along = segment / RIBBON_SEGMENTS;
      const y = -length / 2 + segment * step;
      const twist = Math.sin(piece.flip + along * piece.waves * Math.PI * 2);
      const wave = Math.sin(piece.flip * 0.5 + along * Math.PI * 1.6) * halfWidth * 1.6;

      context.fillStyle = twist + previousTwist >= 0 ? piece.color : piece.back;
      context.beginPath();
      context.moveTo(previousWave - halfWidth * previousTwist, previousY);
      context.lineTo(previousWave + halfWidth * previousTwist, previousY);
      context.lineTo(wave + halfWidth * twist, y);
      context.lineTo(wave - halfWidth * twist, y);
      context.closePath();
      context.fill();

      previousY = y;
      previousTwist = twist;
      previousWave = wave;
    }
  }

  function drawPiece(context, piece, fade) {
    context.save();
    context.translate(piece.x, piece.y);
    context.rotate(piece.spin);
    context.globalAlpha = piece.alpha * fade;

    if (piece.kind === 'ribbon') {
      drawRibbon(context, piece);
      context.restore();
      return;
    }

    if (piece.kind === 'star') {
      // Twinkle: the light catching a facet as it turns.
      context.globalAlpha *= 0.7 + 0.3 * Math.sin(piece.twinkle);
      context.fillStyle = piece.color;
      drawStar(context, piece);
      context.restore();
      return;
    }

    if (piece.kind === 'dot') {
      context.fillStyle = piece.color;
      context.beginPath();
      context.arc(0, 0, piece.size * 0.5, 0, Math.PI * 2);
      context.fill();
      context.restore();
      return;
    }

    // Foil: squashed along one axis so it turns edge-on and back, showing its
    // reverse for half of every turn.
    const turn = Math.cos(piece.flip);
    context.fillStyle = turn >= 0 ? piece.color : piece.back;
    context.scale(1, Math.abs(turn) * 0.9 + 0.1);
    context.fillRect(-piece.size * 0.5, -piece.size * 0.7, piece.size, piece.size * 1.4);
    context.restore();
  }

  /* ------------------------------------------------------------- runtime */

  function createConfetti(canvas, options = {}) {
    const context = canvas.getContext('2d');
    const reducedMotion = global.matchMedia && global.matchMedia('(prefers-reduced-motion: reduce)').matches;

    let palette = options.palette && options.palette.length ? options.palette : DEFAULT_PALETTE;
    const view = { width: 0, height: 0 };
    let pieces = [];
    let frameId = null;
    let lastFrameAt = 0;
    let emitUntil = 0;
    let endsAt = 0;

    function resize() {
      const ratio = Math.min(global.devicePixelRatio || 1, 2);
      view.width = global.innerWidth;
      view.height = global.innerHeight;
      canvas.width = view.width * ratio;
      canvas.height = view.height * ratio;
      canvas.style.width = `${view.width}px`;
      canvas.style.height = `${view.height}px`;
      // Everything below works in CSS pixels, so a piece is the same size on
      // a projector as on a retina laptop.
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
    }

    function clear() {
      context.clearRect(0, 0, view.width, view.height);
    }

    function stop() {
      pieces = [];
      if (frameId) {
        cancelAnimationFrame(frameId);
        frameId = null;
      }
      clear();
    }

    function tick(now) {
      // Clamped, so returning to a backgrounded tab does not teleport the fall.
      const delta = Math.min((now - lastFrameAt) / 16.667, 3);
      lastFrameAt = now;

      const remaining = endsAt - now;
      const fade = remaining < FADE_MS ? Math.max(0, remaining / FADE_MS) : 1;
      // A slow breath across the whole field, so it drifts rather than falls.
      const wind = Math.sin(now / 2600) * 0.32 + Math.sin(now / 900) * 0.1;

      clear();

      const terminal = reducedMotion ? TERMINAL * 0.3 : TERMINAL;

      for (const piece of pieces) {
        piece.velocityY = Math.min(piece.velocityY + GRAVITY * delta, terminal);
        piece.velocityX += (wind - piece.velocityX) * DRAG * delta;
        piece.swayPhase += piece.swayRate * delta;
        piece.spin += piece.spinRate * delta;
        piece.flip += piece.flipRate * delta;
        piece.twinkle += 0.09 * delta;

        piece.x += (piece.velocityX + Math.sin(piece.swayPhase) * piece.swayAmplitude) * delta;
        piece.y += piece.velocityY * delta;

        const gone = piece.y > view.height + 60 || piece.x < -80 || piece.x > view.width + 80;
        if (gone && now < emitUntil) {
          // Still celebrating: send it back over the top.
          Object.assign(piece, createPiece(view, palette, { y: random(-60, -10) }));
        } else if (gone) {
          continue;
        }

        drawPiece(context, piece, fade);
      }

      if (now < endsAt) {
        frameId = requestAnimationFrame(tick);
        return;
      }
      stop();
    }

    function start({ count, duration, palette: nextPalette } = {}) {
      stop();
      if (nextPalette && nextPalette.length) palette = nextPalette;

      const total = Math.max(0, Math.round(count || 0));
      if (total === 0) return;

      resize();

      // Reduced motion: a light scatter that drifts down, no cannons.
      if (reducedMotion) {
        pieces = Array.from({ length: Math.min(total, 30) }, () =>
          createPiece(view, palette, { velocityY: random(0.6, 1.2) })
        );
        pieces.forEach((piece) => {
          piece.spinRate *= 0.15;
          piece.flipRate *= 0.15;
          piece.swayAmplitude *= 0.3;
        });
      } else {
        const burst = Math.round(total * 0.45);
        pieces = [
          ...Array.from({ length: burst }, (unused, index) =>
            createBurstPiece(view, palette, index % 2 === 0)
          ),
          ...Array.from({ length: total - burst }, () => createPiece(view, palette)),
        ];
      }

      const runFor = duration > 0 ? duration : 6000;
      // Emission stops early so the last pieces can fall out of frame rather
      // than being cut off mid-air.
      emitUntil = performance.now() + Math.max(0, runFor - TAIL_MS);
      endsAt = performance.now() + runFor;
      lastFrameAt = performance.now();
      frameId = requestAnimationFrame(tick);
    }

    resize();
    global.addEventListener('resize', resize);

    return { start, stop, resize };
  }

  global.createConfetti = createConfetti;
})(window);

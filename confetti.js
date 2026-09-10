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

  /**
   * NEW: the celebrations an organiser can choose between.
   *
   * Each is the same engine under different weather: which shapes are in the
   * air, how heavy they are, which way gravity points and whether the cannons
   * fire. 'classic' is exactly what the board did before any of this existed.
   */
  const RECIPES = {
    classic: {
      kinds: [['foil', 0.34], ['ribbon', 0.26], ['star', 0.22], ['dot', 0.18]],
      burst: 0.45,
    },
    streamers: {
      // Long paper, thrown hard, taking its time coming down.
      kinds: [['ribbon', 0.82], ['foil', 0.18]],
      burst: 0.6,
      gravity: 0.75,
      terminal: 0.8,
      size: 1.15,
      sway: 1.3,
    },
    stars: {
      kinds: [['star', 0.72], ['dot', 0.28]],
      burst: 0.4,
      gravity: 0.7,
      terminal: 0.75,
      spin: 0.7,
      sway: 1.2,
    },
    balloons: {
      // The one that goes the other way.
      kinds: [['balloon', 1]],
      burst: 0,
      gravity: -0.55,
      terminal: 1,
      size: 2.4,
      spin: 0.1,
      sway: 0.8,
      rise: true,
    },
    snow: {
      kinds: [['dot', 0.78], ['star', 0.22]],
      burst: 0,
      gravity: 0.28,
      terminal: 0.3,
      spin: 0.2,
      sway: 1.5,
      size: 0.85,
      palette: ['#ffffff', '#e6f2ff', '#cfe4ff', '#f4f9ff'],
    },
    money: {
      // Notes flutter rather than fall: wide, light, always turning over.
      kinds: [['note', 1]],
      burst: 0.35,
      gravity: 0.6,
      terminal: 0.62,
      size: 1.5,
      spin: 0.5,
      sway: 1.6,
      palette: ['#7bc47f', '#3f9d55', '#d9c86a', '#b9d9a4', '#e8f0d8'],
    },
    none: { kinds: [], burst: 0 },
  };

  // Everything but the two that are not effects in their own right.
  const MIXED = Object.keys(RECIPES).filter((name) => name !== 'none' && name !== 'classic');

  function recipeFor(type) {
    return RECIPES[type] || RECIPES.classic;
  }

  function pickKind(recipe) {
    let roll = Math.random();
    for (const [kind, share] of recipe.kinds) {
      roll -= share;
      if (roll <= 0) return kind;
    }
    return recipe.kinds.length ? recipe.kinds[0][0] : 'foil';
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

  // CHANGED: a piece now belongs to a recipe and carries its own gravity and
  // terminal velocity, which is what lets MIX hold balloons rising through
  // falling snow in one field rather than alternating bursts.
  function createPiece(view, recipe, palette, options = {}) {
    const colors = recipe.palette || palette;
    const color = colors[Math.floor(Math.random() * colors.length)];
    const kind = options.kind || pickKind(recipe);
    const scale = recipe.size || 1;
    const size = (kind === 'dot' ? random(3, 6) : random(6, 12)) * scale;

    return {
      kind,
      color,
      recipe,
      gravity: GRAVITY * (recipe.gravity === undefined ? 1 : recipe.gravity),
      terminal: TERMINAL * (recipe.terminal === undefined ? 1 : recipe.terminal),
      back: shade(color, 0.55),
      size,
      x: options.x !== undefined ? options.x : Math.random() * view.width,
      /* Where it starts. A piece being recycled comes in off-screen — above,
         or below if it rises. The opening field is scattered across the whole
         view instead: a slow effect like snow or balloons would otherwise take
         several seconds to drift into frame, and the reveal is over by then. */
      y:
        options.y !== undefined
          ? options.y
          : options.initial
            ? random(-view.height * 0.3, view.height * 0.95)
            : recipe.rise
              ? random(view.height + 10, view.height * 1.6)
              : random(-view.height * 0.5, -10),
      velocityX: options.velocityX !== undefined ? options.velocityX : random(-0.5, 0.5),
      velocityY:
        options.velocityY !== undefined
          ? options.velocityY
          : recipe.rise
            ? random(-2.2, -0.9)
            : random(1.2, 3),
      spin: Math.random() * Math.PI * 2,
      spinRate: random(-0.14, 0.14) * (recipe.spin === undefined ? 1 : recipe.spin),
      // The tumble: a separate phase, so a piece can spin and turn over at once.
      flip: Math.random() * Math.PI * 2,
      flipRate: random(0.06, 0.17) * (Math.random() < 0.5 ? -1 : 1),
      // Flutter, which is what stops the fall looking like rain.
      swayAmplitude: random(0.25, 1.1) * (recipe.sway === undefined ? 1 : recipe.sway),
      swayRate: random(0.02, 0.05),
      swayPhase: Math.random() * Math.PI * 2,
      twinkle: Math.random() * Math.PI * 2,
      waves: random(0.45, 0.95),
      length: random(5.5, 9),
      alpha: random(0.75, 1),
    };
  }

  /** Two cannons at the bottom corners, fired on the opening frame. */
  function createBurstPiece(view, recipe, palette, fromLeft) {
    const angle = fromLeft ? random(-1.35, -0.75) : random(-2.39, -1.79);
    const speed = random(9, 17);

    return createPiece(view, recipe, palette, {
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

  /** NEW: a balloon — a body, a knot and a string that trails as it rises. */
  function drawBalloon(context, piece) {
    const radius = piece.size * 0.55;

    context.beginPath();
    context.ellipse(0, 0, radius * 0.86, radius, 0, 0, Math.PI * 2);
    context.fill();

    // The knot.
    context.beginPath();
    context.moveTo(-radius * 0.16, radius * 0.96);
    context.lineTo(radius * 0.16, radius * 0.96);
    context.lineTo(0, radius * 1.2);
    context.closePath();
    context.fill();

    // A highlight, which is most of what makes a flat oval read as a balloon.
    context.globalAlpha *= 0.45;
    context.fillStyle = '#ffffff';
    context.beginPath();
    context.ellipse(-radius * 0.3, -radius * 0.34, radius * 0.2, radius * 0.3, -0.4, 0, Math.PI * 2);
    context.fill();

    context.globalAlpha *= 0.8;
    context.strokeStyle = piece.back;
    context.lineWidth = Math.max(0.6, radius * 0.06);
    context.beginPath();
    context.moveTo(0, radius * 1.2);
    context.quadraticCurveTo(radius * 0.5, radius * 2, 0, radius * 2.8);
    context.stroke();
  }

  /** NEW: a banknote, turning over as it flutters down. */
  function drawNote(context, piece) {
    const width = piece.size * 1.7;
    const height = piece.size * 0.82;
    const turn = Math.cos(piece.flip);

    context.scale(1, Math.abs(turn) * 0.85 + 0.15);
    context.fillStyle = turn >= 0 ? piece.color : piece.back;
    context.fillRect(-width / 2, -height / 2, width, height);

    // An oval and a border, at a glance enough to read as a note.
    context.globalAlpha *= 0.5;
    context.strokeStyle = turn >= 0 ? piece.back : piece.color;
    context.lineWidth = Math.max(0.5, piece.size * 0.07);
    context.strokeRect(-width * 0.42, -height * 0.34, width * 0.84, height * 0.68);
    context.beginPath();
    context.ellipse(0, 0, width * 0.16, height * 0.26, 0, 0, Math.PI * 2);
    context.stroke();
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

    if (piece.kind === 'balloon') {
      context.fillStyle = piece.color;
      drawBalloon(context, piece);
      context.restore();
      return;
    }

    if (piece.kind === 'note') {
      drawNote(context, piece);
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

      const slow = reducedMotion ? 0.3 : 1;

      for (const piece of pieces) {
        // CHANGED: gravity and terminal velocity belong to the piece now, so
        // one field can hold balloons rising through falling snow.
        const limit = piece.terminal * slow;
        piece.velocityY += piece.gravity * slow * delta;
        if (piece.gravity >= 0) piece.velocityY = Math.min(piece.velocityY, limit);
        else piece.velocityY = Math.max(piece.velocityY, -limit);
        piece.velocityX += (wind - piece.velocityX) * DRAG * delta;
        piece.swayPhase += piece.swayRate * delta;
        piece.spin += piece.spinRate * delta;
        piece.flip += piece.flipRate * delta;
        piece.twinkle += 0.09 * delta;

        piece.x += (piece.velocityX + Math.sin(piece.swayPhase) * piece.swayAmplitude) * delta;
        piece.y += piece.velocityY * delta;

        const rising = piece.gravity < 0;
        const gone =
          (rising ? piece.y < -piece.size * 4 : piece.y > view.height + 60) ||
          piece.x < -80 ||
          piece.x > view.width + 80;

        if (gone && now < emitUntil) {
          // Still celebrating: send it back to the side it came in from.
          const recipe = piece.recipe;
          Object.assign(
            piece,
            createPiece(view, recipe, palette, {
              y: rising ? random(view.height + 10, view.height + 80) : random(-60, -10),
            })
          );
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

    /**
     * CHANGED: `type` picks the celebration. Anything unknown falls back to
     * classic, which is what an event saved before this existed will send.
     */
    function start({ count, duration, palette: nextPalette, type } = {}) {
      stop();
      if (nextPalette && nextPalette.length) palette = nextPalette;

      const total = Math.max(0, Math.round(count || 0));
      if (total === 0 || type === 'none') return;

      resize();

      // MIX draws each piece from a different effect into one pool. One pool
      // costs the same per frame as one effect, where alternating bursts would
      // mean several fields alive at once for the same visible density.
      const mixed = type === 'mix';
      const base = recipeFor(mixed ? 'classic' : type);
      const recipeAt = () => (mixed ? recipeFor(MIXED[Math.floor(Math.random() * MIXED.length)]) : base);

      if (reducedMotion) {
        // A light scatter that drifts, whichever effect was chosen.
        pieces = Array.from({ length: Math.min(total, 30) }, () => {
          const recipe = recipeAt();
          const piece = createPiece(view, recipe, palette, { initial: true });
          piece.spinRate *= 0.15;
          piece.flipRate *= 0.15;
          piece.swayAmplitude *= 0.3;
          return piece;
        });
      } else {
        pieces = [];
        for (let index = 0; index < total; index += 1) {
          const recipe = recipeAt();
          const fromCannon = Math.random() < (recipe.burst === undefined ? 0.45 : recipe.burst);
          pieces.push(
            fromCannon
              ? createBurstPiece(view, recipe, palette, index % 2 === 0)
              : createPiece(view, recipe, palette, { initial: true })
          );
        }
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
  // The console builds its selector from this, so the two cannot drift apart.
  global.pickoraCelebrations = Object.keys(RECIPES).filter((name) => name !== 'none').concat(['mix', 'none']);
})(window);

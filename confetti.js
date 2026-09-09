/**
 * Canvas confetti used for the winner reveal. Kept independent of the board
 * controller so the animation can be started, stopped and resized on its own.
 */
(function attachConfetti(global) {
  'use strict';

  const GRAVITY = 0.08;
  const DRIFT = 0.6;
  const SHAPES = ['rect', 'circle', 'ribbon'];

  function createPiece(canvas, palette) {
    return {
      x: Math.random() * canvas.width,
      y: -Math.random() * canvas.height * 0.6,
      width: Math.random() * 10 + 5,
      height: Math.random() * 14 + 6,
      velocityY: Math.random() * 2.4 + 1.6,
      velocityX: (Math.random() - 0.5) * DRIFT,
      color: palette[Math.floor(Math.random() * palette.length)],
      rotation: Math.random() * 360,
      rotationSpeed: (Math.random() - 0.5) * 9,
      shape: SHAPES[Math.floor(Math.random() * SHAPES.length)],
      opacity: Math.random() * 0.5 + 0.5,
    };
  }

  function drawPiece(context, piece) {
    context.save();
    context.translate(piece.x, piece.y);
    context.rotate((piece.rotation * Math.PI) / 180);
    context.fillStyle = piece.color;
    context.globalAlpha = piece.opacity;

    if (piece.shape === 'circle') {
      context.beginPath();
      context.arc(0, 0, piece.width / 2, 0, Math.PI * 2);
      context.fill();
    } else if (piece.shape === 'ribbon') {
      context.fillRect(-piece.width / 4, -piece.height / 2, piece.width / 2, piece.height);
    } else {
      context.fillRect(-piece.width / 2, -piece.height / 2, piece.width, piece.height);
    }

    context.restore();
  }

  function createConfetti(canvas, options = {}) {
    const context = canvas.getContext('2d');
    let palette = options.palette && options.palette.length ? options.palette : ['#ffd54f', '#ff8a65', '#4dd0e1', '#f06292', '#aed581', '#ffffff'];
    let pieces = [];
    let frameId = null;
    let stopTimeoutId = null;

    function resize() {
      const ratio = Math.min(global.devicePixelRatio || 1, 2);
      canvas.width = global.innerWidth * ratio;
      canvas.height = global.innerHeight * ratio;
      canvas.style.width = `${global.innerWidth}px`;
      canvas.style.height = `${global.innerHeight}px`;
    }

    function stop() {
      pieces = [];
      if (frameId) {
        cancelAnimationFrame(frameId);
        frameId = null;
      }
      if (stopTimeoutId) {
        clearTimeout(stopTimeoutId);
        stopTimeoutId = null;
      }
      context.clearRect(0, 0, canvas.width, canvas.height);
    }

    function tick() {
      context.clearRect(0, 0, canvas.width, canvas.height);

      pieces.forEach((piece) => {
        piece.velocityY += GRAVITY;
        piece.y += piece.velocityY;
        piece.x += piece.velocityX;
        piece.rotation += piece.rotationSpeed;

        if (piece.y > canvas.height + 40) {
          Object.assign(piece, createPiece(canvas, palette), { y: -20 });
        }

        drawPiece(context, piece);
      });

      if (pieces.length > 0) {
        frameId = requestAnimationFrame(tick);
      }
    }

    function start({ count, duration, palette: nextPalette }) {
      stop();
      if (nextPalette && nextPalette.length) palette = nextPalette;
      if (!count || count <= 0) return;

      resize();
      pieces = Array.from({ length: count }, () => createPiece(canvas, palette));
      tick();

      if (duration > 0) {
        stopTimeoutId = setTimeout(stop, duration);
      }
    }

    resize();
    global.addEventListener('resize', resize);

    return { start, stop, resize };
  }

  global.createConfetti = createConfetti;
})(window);

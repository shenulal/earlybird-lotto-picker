/**
 * The draw reel.
 *
 * A tape of entries that spins up, cruises, and — the moment the operator
 * presses Stop — slows to rest on a whole entry. Three things follow from
 * that shape and are the reason this is hand-driven rather than a CSS loop:
 *
 *  - Stop is felt immediately. The slowdown begins on the keypress, and the
 *    configured minimum roll is served by how long that slowdown takes rather
 *    than by holding the reel at full speed and making the operator wait.
 *  - The deceleration starts at exactly the speed the tape was already
 *    travelling, so there is no jolt at the hand-over.
 *  - The board can name the entry the tape will finish on, so once the server
 *    has drawn, the reel comes to rest on the actual winner instead of a
 *    stranger who is then replaced.
 *
 * The tape is virtual: entries have an index that only goes up, and a handful
 * of list items are recycled underneath it. Only `transform` is animated, so
 * the motion stays on the compositor at any configured speed.
 */
(function reelModule(global, document) {
  'use strict';

  const SPIN_UP_MS = 420;
  const MIN_SETTLE_MS = 950;
  const MAX_SETTLE_MS = 2600;
  // Far enough that the slowdown reads as one movement rather than a stumble.
  const MIN_SETTLE_ITEMS = 4;
  // One entry fills the window; the others cover the soft edges above and
  // below it. Keeping this small lets the landing entry be composed late,
  // which is what gives a slow draw call time to arrive.
  const NODES = 3;
  const MAX_BLUR_PX = 4.5;
  // A beat on the landed entry before the announcement takes the stage.
  const LANDED_HOLD_MS = 520;
  // A frame after the tab was in the background must not teleport the tape.
  const MAX_FRAME_MS = 48;

  function clamp(value, low, high) {
    return Math.min(high, Math.max(low, value));
  }

  /**
   * Creates a reel inside `mount`.
   *
   * `deal()` supplies the next entry to show and `renderItem(entry)` turns one
   * into markup. `reducedMotion` swaps the travelling tape for values that
   * step in place.
   */
  function createReel(mount, options) {
    const { renderItem, deal, reducedMotion = false } = options;

    mount.innerHTML = `
      <div class="reel-window">
        <ul class="reel-strip"></ul>
        <span class="reel-band" aria-hidden="true"></span>
      </div>`;

    const windowEl = mount.querySelector('.reel-window');
    const strip = mount.querySelector('.reel-strip');

    let itemHeight = 0;
    let nodes = [];
    let base = 0; // Tape index of the entry filling the top of the window.
    let travelled = 0; // Pixels since the reel started, only ever increasing.
    let velocity = 0; // Pixels per millisecond.
    let cruise = 0;
    let phase = 'idle';
    let frameId = null;
    let lastFrameAt = 0;
    let spinStartedAt = 0;
    let settle = null;
    let landingEntry = null;
    let stepTimerId = null;

    /* --------------------------------------------------------------- tape */

    /** Fills a list item with the entry belonging at `index` on the tape. */
    function compose(node, index) {
      const isLanding = settle !== null && index === settle.finalIndex;
      const entry = isLanding && landingEntry ? landingEntry : deal();
      node.dataset.index = String(index);
      node.innerHTML = entry ? renderItem(entry) : '';
    }

    /** Recycles the entry that has left the window to the far end of the tape. */
    function advanceTo(index) {
      while (base < index) {
        const node = nodes.shift();
        base += 1;
        compose(node, base + NODES - 1);
        strip.appendChild(node);
        nodes.push(node);
      }
    }

    function paint() {
      advanceTo(Math.floor(travelled / itemHeight));
      const offset = travelled - base * itemHeight;
      strip.style.transform = `translate3d(0, ${-offset}px, 0)`;

      // Blur and veil track the speed, so the tape reads as fast rather than
      // merely moving, and clears as it comes to rest.
      const ratio = cruise > 0 ? clamp(velocity / cruise, 0, 1) : 0;
      windowEl.style.setProperty('--reel-blur', `${(MAX_BLUR_PX * ratio).toFixed(2)}px`);
      windowEl.style.setProperty('--reel-speed', ratio.toFixed(3));
    }

    /* -------------------------------------------------------------- frames */

    function finishSettle() {
      const landed = settle;
      travelled = landed.from + landed.distance;
      // Land flush on the entry: floating point can leave the tape a hair
      // short of the boundary, which would show the previous one instead.
      advanceTo(landed.finalIndex);
      strip.style.transform = 'translate3d(0, 0, 0)';
      windowEl.style.setProperty('--reel-blur', '0px');
      windowEl.style.setProperty('--reel-speed', '0');
      windowEl.classList.add('is-landed');

      phase = 'idle';
      velocity = 0;
      frameId = null;
      settle = null;
      global.setTimeout(landed.resolve, LANDED_HOLD_MS);
    }

    function frame(now) {
      const elapsed = Math.min(now - lastFrameAt, MAX_FRAME_MS);
      lastFrameAt = now;

      if (phase === 'spin') {
        const progress = Math.min(1, (now - spinStartedAt) / SPIN_UP_MS);
        velocity = cruise * progress * progress;
        travelled += velocity * elapsed;
        if (progress >= 1) phase = 'cruise';
      } else if (phase === 'cruise') {
        velocity = cruise;
        travelled += velocity * elapsed;
      } else if (phase === 'settle') {
        const progress = Math.min(1, (now - settle.startedAt) / settle.duration);
        const remaining = 1 - progress;
        travelled = settle.from + settle.distance * (1 - remaining * remaining * remaining);
        velocity = ((3 * settle.distance) / settle.duration) * remaining * remaining;
        if (progress >= 1) {
          finishSettle();
          return;
        }
      }

      paint();
      frameId = global.requestAnimationFrame(frame);
    }

    /* ---------------------------------------------------------------- api */

    function start(msPerItem) {
      itemHeight = windowEl.getBoundingClientRect().height || 160;
      // A floor on the period keeps a mis-set speed from asking for travel no
      // display can resolve.
      cruise = itemHeight / Math.max(24, Number(msPerItem) || 60);

      base = 0;
      travelled = 0;
      velocity = 0;
      settle = null;
      landingEntry = null;
      windowEl.classList.remove('is-landed');

      strip.innerHTML = '';
      nodes = Array.from({ length: NODES }, (unused, index) => {
        const node = document.createElement('li');
        node.className = 'reel-item';
        compose(node, index);
        strip.appendChild(node);
        return node;
      });

      if (reducedMotion) {
        // No travel at all: the entry in the window is replaced on a slow
        // timer, so the board still reads as live without sustained motion.
        phase = 'static';
        windowEl.classList.add('is-static');
        stepTimerId = global.setInterval(() => compose(nodes[0], base), Math.max(msPerItem * 8, 420));
        return;
      }

      phase = 'spin';
      spinStartedAt = global.performance.now();
      lastFrameAt = spinStartedAt;
      frameId = global.requestAnimationFrame(frame);
    }

    /**
     * Begins the slowdown and resolves once the tape has landed and held.
     *
     * `minimumMs` is what is left of the configured minimum roll. The tape
     * takes at least that long to stop, which honours the setting without
     * making the operator wait for their own keypress to register.
     */
    function settleTo(minimumMs) {
      if (phase === 'static') {
        global.clearInterval(stepTimerId);
        stepTimerId = null;
        phase = 'idle';
        windowEl.classList.add('is-landed');
        return new Promise((resolve) => global.setTimeout(resolve, LANDED_HOLD_MS));
      }

      if (phase !== 'spin' && phase !== 'cruise') return Promise.resolve();

      const target = clamp(Number(minimumMs) || 0, MIN_SETTLE_MS, MAX_SETTLE_MS);
      // An ease-out over distance D in time T leaves the tape 3D/T at the
      // start, so this is the distance whose slowdown begins at exactly the
      // speed it is already travelling.
      const wanted = (velocity * target) / 3;
      const items = Math.max(MIN_SETTLE_ITEMS, Math.round(wanted / itemHeight));
      const toBoundary = (base + 1) * itemHeight - travelled;
      const distance = toBoundary + items * itemHeight;

      settle = {
        from: travelled,
        distance,
        duration: clamp((3 * distance) / Math.max(velocity, 0.001), MIN_SETTLE_MS, MAX_SETTLE_MS),
        startedAt: global.performance.now(),
        finalIndex: base + 1 + items,
        resolve: null,
      };
      phase = 'settle';

      return new Promise((resolve) => {
        settle.resolve = resolve;
      });
    }

    /**
     * Names the entry the tape should finish on.
     *
     * Called as soon as the server has drawn. If that entry is still ahead of
     * the window it is simply composed in place; if it has already been
     * composed it is rewritten, which is invisible behind the blur and worth
     * far more than landing on someone who did not win.
     */
    function land(entry) {
      landingEntry = entry;
      if (!settle) return;
      const node = nodes.find((candidate) => Number(candidate.dataset.index) === settle.finalIndex);
      if (node) node.innerHTML = renderItem(entry);
    }

    function destroy() {
      if (frameId !== null) global.cancelAnimationFrame(frameId);
      if (stepTimerId !== null) global.clearInterval(stepTimerId);
      frameId = null;
      stepTimerId = null;
      settle = null;
      phase = 'idle';
    }

    return { start, settle: settleTo, land, destroy };
  }

  global.createPickoraReel = createReel;
})(window, document);

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
 *  - The tape never commits to an entry before the server has drawn. Stop
 *    eases it down to a gentle roll; only once the winner is named does it
 *    choose a resting place, one still out of sight below the window, and
 *    glide onto it. The entry the room watches come to rest is the winner, so
 *    nothing is ever swapped in view and the reel never speeds up again.
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
  // While the draw is still in flight the tape eases towards this pace: slow
  // enough to read as stopping, fast enough that nothing looks chosen yet.
  const CRAWL_MS_PER_ITEM = 180;
  const BRAKE_EASE_MS = 260;
  // The landing entry must start wholly below the window — the first slot
  // that can be (re)written without anyone seeing it change.
  const LANDING_LEAD_ITEMS = 2;
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
    let crawl = 0;
    let settle = null;
    let stopping = null; // { stoppedAt, minimumMs, resolve } once Stop is pressed.
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
      resolveStop();
    }

    function resolveStop() {
      const { resolve } = stopping;
      stopping = null;
      global.setTimeout(resolve, LANDED_HOLD_MS);
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
      } else if (phase === 'brake') {
        // Eases towards the crawl from whatever speed Stop caught it at.
        velocity = crawl + (velocity - crawl) * Math.exp(-elapsed / BRAKE_EASE_MS);
        travelled += velocity * elapsed;
      } else if (phase === 'settle') {
        // A cubic that leaves at the tape's current speed and arrives at rest
        // exactly on the landing entry. The duration is kept where the speed
        // only ever falls, so the tape cannot surge before it stops.
        const u = Math.min(1, (now - settle.startedAt) / settle.duration);
        const { distance: d, launch: a } = settle;
        travelled = settle.from + a * (u * u * u - 2 * u * u + u) + d * (3 * u * u - 2 * u * u * u);
        velocity = (a * (3 * u * u - 4 * u + 1) + d * (6 * u - 6 * u * u)) / settle.duration;
        if (u >= 1) {
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
      crawl = Math.min(cruise, itemHeight / CRAWL_MS_PER_ITEM);

      base = 0;
      travelled = 0;
      velocity = 0;
      settle = null;
      stopping = null;
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
     * Begins the slowdown and resolves once the tape has landed on the winner
     * and held.
     *
     * The tape eases off at once, so Stop is felt on the keypress, but it does
     * not pick where to stop until `land()` names the winner. `minimumMs` is
     * what is left of the configured minimum roll; the slowdown takes at least
     * that long, which honours the setting without making the operator wait.
     */
    function settleTo(minimumMs) {
      if (stopping) return Promise.resolve();
      if (phase !== 'static' && phase !== 'spin' && phase !== 'cruise') return Promise.resolve();

      const done = new Promise((resolve) => {
        stopping = {
          stoppedAt: global.performance.now(),
          minimumMs: Number(minimumMs) || 0,
          resolve,
        };
      });

      if (phase === 'static') {
        // Nothing travels here, so stopping on a stand-in would read as a
        // result. The window clears instead, and the next entry in it is the
        // winner.
        global.clearInterval(stepTimerId);
        stepTimerId = null;
        nodes[0].innerHTML = '';
      } else {
        phase = 'brake';
      }
      if (landingEntry) planLanding();
      return done;
    }

    /**
     * Chooses the resting place once the winner is known, and starts the
     * final glide onto it.
     *
     * The entry is placed at least LANDING_LEAD_ITEMS ahead, so it is composed
     * — or rewritten — while still out of sight, and then travels into the
     * window as the winner from the moment anyone can see it.
     */
    function planLanding() {
      if (phase === 'static') {
        phase = 'idle';
        nodes[0].innerHTML = renderItem(landingEntry);
        windowEl.classList.add('is-landed');
        resolveStop();
        return;
      }

      const now = global.performance.now();
      const speed = Math.max(velocity, 0.001);
      const waited = now - stopping.stoppedAt;
      const target = clamp(stopping.minimumMs - waited, MIN_SETTLE_MS, MAX_SETTLE_MS);

      // A glide over D that leaves at the current speed can take anywhere
      // from 1.5·D/v to 3·D/v and still only slow down. Pick the nearest
      // entry far enough out for the target to sit in that range.
      const reach = travelled + (speed * target) / 3;
      const finalIndex = Math.max(base + LANDING_LEAD_ITEMS, Math.ceil(reach / itemHeight));
      const distance = finalIndex * itemHeight - travelled;
      const duration = clamp(target, (1.5 * distance) / speed, (3 * distance) / speed);

      settle = {
        from: travelled,
        distance,
        duration,
        launch: speed * duration,
        startedAt: now,
        finalIndex,
      };
      phase = 'settle';

      const node = nodes.find((candidate) => Number(candidate.dataset.index) === finalIndex);
      if (node) node.innerHTML = renderItem(landingEntry);
    }

    /**
     * Names the entry the tape will finish on.
     *
     * Called as soon as the server has drawn. Until then the tape only rolls
     * slowly; from here it comes to rest on this entry and no other.
     */
    function land(entry) {
      if (!entry || landingEntry) return;
      landingEntry = entry;
      if (stopping && (phase === 'brake' || phase === 'static')) planLanding();
    }

    function destroy() {
      if (frameId !== null) global.cancelAnimationFrame(frameId);
      if (stepTimerId !== null) global.clearInterval(stepTimerId);
      frameId = null;
      stepTimerId = null;
      settle = null;
      stopping = null;
      phase = 'idle';
    }

    return { start, settle: settleTo, land, destroy };
  }

  global.createPickoraReel = createReel;
})(window, document);

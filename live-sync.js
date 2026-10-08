/**
 * The live channel, as a screen sees it.
 *
 * Checks in with the server on the organiser's interval, hands each new event
 * to the page, and — on the one board holding control — the commands a phone
 * remote has sent. Nothing here decides what an event means; the page does.
 *
 * A screen's identity lives for the life of its tab (sessionStorage), so the
 * controller stays the controller when it moves to the welcome or prize
 * screen and back. A board opened at /?role=main asks to be the main one.
 */
(function liveModule(global, document) {
  'use strict';

  const ID_KEY = 'pickora-screen-id';
  const ROLE_KEY = 'pickora-screen-role';
  // The secret the server gave this tab when it took control. Kept for the
  // life of the tab, so control survives moving to another screen and back.
  const TOKEN_KEY = 'pickora-lease-token';
  // A command older than this when it arrives was meant for a moment that has
  // passed — say, one queued while no board was listening.
  const STALE_COMMAND_MS = 15000;
  const MAX_BACKOFF_MS = 15000;

  function randomId() {
    const bytes = new Uint8Array(18);
    global.crypto.getRandomValues(bytes);
    return `scr-${Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')}`;
  }

  function sessionValue(key, create) {
    try {
      const existing = global.sessionStorage.getItem(key);
      if (existing) return existing;
      const value = create();
      global.sessionStorage.setItem(key, value);
      return value;
    } catch (_error) {
      return create();
    }
  }

  function screenRole() {
    const asked = new URLSearchParams(global.location.search).get('role');
    if (asked === 'main' || asked === 'auto') {
      try {
        global.sessionStorage.setItem(ROLE_KEY, asked);
      } catch (_error) {
        /* the role lasts for this page only */
      }
      return asked;
    }
    try {
      return global.sessionStorage.getItem(ROLE_KEY) || 'auto';
    } catch (_error) {
      return 'auto';
    }
  }

  /**
   * Creates the channel for one page.
   *   onEvent(event)       — something happened elsewhere
   *   onCommand(command)   — the remote asked this screen to act (controller only)
   *   onRevision()         — the organiser changed the settings
   *   onResync()           — too far behind to catch up; reload the state
   *   onRoleChange(isYou)  — this screen gained or lost control
   */
  function readToken() {
    try {
      return global.sessionStorage.getItem(TOKEN_KEY) || '';
    } catch (_error) {
      return '';
    }
  }

  function writeToken(token) {
    try {
      if (token) global.sessionStorage.setItem(TOKEN_KEY, token);
      else global.sessionStorage.removeItem(TOKEN_KEY);
    } catch (_error) {
      /* kept in memory for this page only */
    }
  }

  function createLive({
    page,
    onEvent = () => {},
    onCommand = () => {},
    onRevision = () => {},
    onResync = () => {},
    onRoleChange = () => {},
    onStatus = () => {},
  }) {
    const boardId = sessionValue(ID_KEY, randomId);
    const role = screenRole();
    let settings = null;
    let timer = null;
    let cursor = null;
    let commandCursor = null;
    let revision = null;
    let isController = false;
    let controllerActive = false;
    let failures = 0;
    let lastPublished = '';
    let running = false;
    // Until the first answer, nobody knows whether this screen is in control;
    // the page waits for it rather than guessing "follower" and hiding the
    // main board's own buttons for a moment.
    let checkedIn = false;
    let leaseToken = readToken();
    // One check-in at a time: a second, started while the first is still on
    // its way, would hand the page the same events twice.
    let inFlight = false;

    function wanted() {
      if (!settings) return false;
      const syncHere = settings.liveSync.enabled && settings.liveSync.screens[page];
      return Boolean(syncHere || settings.remote.enabled);
    }

    function interval() {
      const candidates = [];
      if (settings.liveSync.enabled) candidates.push(settings.liveSync.pollMs);
      if (settings.remote.enabled) candidates.push(settings.remote.pollMs);
      const base = candidates.length ? Math.min(...candidates) : 2000;
      // Back off while the server is unreachable, so a flaky connection is
      // not hammered; one success resets it.
      return Math.min(MAX_BACKOFF_MS, base * 2 ** Math.min(failures, 4));
    }

    function schedule() {
      global.clearTimeout(timer);
      if (running) timer = global.setTimeout(tick, interval());
    }

    async function tick() {
      if (inFlight) return;
      inFlight = true;
      try {
        const response = await fetch('/api/live/poll', {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({ boardId, role, page, leaseToken, after: cursor, commandsAfter: commandCursor }),
        });
        if (!response.ok) throw new Error(`Live check failed (${response.status})`);
        handle(await response.json());
        failures = 0;
      } catch (_error) {
        failures += 1;
      } finally {
        inFlight = false;
      }
      schedule();
    }

    function handle(data) {
      if (!data || !data.ok) return;

      if (data.leaseToken) {
        leaseToken = data.leaseToken;
        writeToken(leaseToken);
      }
      const wasController = isController;
      const firstAnswer = !checkedIn;
      checkedIn = true;
      isController = Boolean(data.controller && data.controller.isYou);
      controllerActive = Boolean(data.controller && data.controller.active);
      if (wasController !== isController || firstAnswer) {
        // A screen newly in control starts from the queue as it is now; it
        // does not replay what was meant for its predecessor.
        if (isController && wasController !== isController) commandCursor = data.commandSeq;
        if (!isController && wasController) writeToken('');
        onRoleChange(isController);
      }

      if (revision !== null && data.revision !== revision) onRevision();
      revision = data.revision;

      if (cursor === null || data.resync) {
        if (data.resync) onResync();
        cursor = data.seq;
      } else {
        data.events.forEach((event) => {
          // FIX: never the same event twice, whatever the network did.
          if (event.seq <= cursor) return;
          cursor = event.seq;
          if (event.mine) return;
          onEvent(event);
        });
        cursor = Math.max(cursor, data.seq);
      }

      onStatus(data.status, controllerActive);

      if (isController) {
        if (commandCursor === null) commandCursor = data.commandSeq;
        const now = Date.parse(data.serverTime) || Date.now();
        data.commands.forEach((command) => {
          if (command.seq <= commandCursor) return;
          commandCursor = command.seq;
          if (now - Date.parse(command.at) > STALE_COMMAND_MS) return;
          onCommand(command);
        });
        if (data.commandSeq !== null && data.commandSeq !== undefined) commandCursor = Math.max(commandCursor, data.commandSeq);
      }
    }

    /** Tells the followers what the controller is doing. Ignored elsewhere. */
    function publish(status) {
      if (!isController) return;
      const key = JSON.stringify(status);
      if (key === lastPublished) return;
      lastPublished = key;
      fetch('/api/live/status', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ boardId, leaseToken, ...status }),
      }).catch(() => {
        lastPublished = '';
      });
    }

    /** Takes the latest settings, starting or stopping the check-ins. */
    function update(next) {
      settings = next;
      const shouldRun = wanted();
      if (shouldRun && !running) {
        running = true;
        tick();
      } else if (!shouldRun && running) {
        running = false;
        global.clearTimeout(timer);
        if (isController) {
          isController = false;
          onRoleChange(false);
        }
      }
    }

    // Moving between screens is the controller's own doing: tell the server
    // straight away rather than on the next tick.
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && running) {
        global.clearTimeout(timer);
        tick();
      }
    });

    return {
      update,
      publish,
      boardId,
      role,
      isController: () => isController,
      hasCheckedIn: () => checkedIn,
      controllerActive: () => controllerActive,
      isRunning: () => running,
    };
  }

  /** The address of a screen, keeping this tab's role in it. */
  function screenUrl(screen) {
    const path = screen === 'board' ? '/' : `/${screen}`;
    const role = screenRole();
    return role === 'main' ? `${path}?role=main` : path;
  }

  global.createPickoraLive = createLive;
  global.pickoraScreenUrl = screenUrl;
})(window, document);

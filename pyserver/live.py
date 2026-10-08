"""The live channel between screens: a short feed of what has happened, which
board is in control, and the commands a phone remote has sent.

Every screen checks in on a timer (:func:`poll`). One draw board at a time
holds a lease and is the *controller*: it runs the draw and carries out remote
commands. The others are followers, mirroring what the feed tells them. The
draw itself is still made once, on the server, by whoever asks — so two screens
can never pick two winners for one press.

Writes are kept rare on purpose. A check-in is a read; the lease is renewed
only every third of its length, and the feed is written only when something
actually happens. Mirrors ``server/live.js``; the feed lives in ``live.json``
and the remote's commands in ``remote.json`` beside the other data files.
"""

import hashlib
import hmac
import re
import secrets
import threading
import time
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

from .coerce import as_object, js_date_parse, js_now_iso, js_number
from .paths import LIVE_PATH, REMOTE_PATH
from .store import read_json, write_json

MAX_EVENTS = 100
MAX_COMMANDS = 50
BOARD_ID = re.compile(r"^[A-Za-z0-9_-]{16,64}$")
ROLES = ("auto", "main")
PAGES = ("board", "welcome", "prizes")
STATES = ("idle", "announcing", "rolling", "revealing", "complete")

# Node answers one request at a time; Flask may not. Every read-modify-write of
# the feed holds this, so two screens can never be handed the same sequence
# number or lose each other's news.
_LOCK = threading.RLock()

_EPOCH = datetime(1970, 1, 1, tzinfo=timezone.utc)


def _now_ms() -> float:
    return time.time() * 1000


def _iso(milliseconds: float) -> str:
    """``new Date(ms).toISOString()``."""
    moment = _EPOCH + timedelta(milliseconds=int(milliseconds))
    return moment.isoformat(timespec="milliseconds").replace("+00:00", "Z")


def _count(value: Any) -> Any:
    """``Number(value) || 0``, written back as a whole number when it is one."""
    number = js_number(value)
    if number != number or number == 0:  # NaN, or zero
        return 0
    return int(number) if number.is_integer() else number


def _number_or_none(value: Any) -> Any:
    """``Number(value) || null``."""
    number = _count(value)
    return number if number else None


def _seq_of(entry: Any) -> float:
    number = js_number(as_object(entry).get("seq"))
    return number


def as_board_id(value: Any) -> Optional[str]:
    """A board id as given, if it looks like one; anything else is nobody."""
    return value if isinstance(value, str) and BOARD_ID.fullmatch(value) else None


def _hash_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def _holds_lease(controller: Optional[Dict[str, Any]], board_id: Optional[str], token: Any) -> bool:
    """Whether a request speaks for the board holding control: its id and the
    lease token it was given when it claimed — compared as hashes, in constant
    time. The id alone is not proof; ids are not secrets."""
    if not controller or not board_id or controller.get("boardId") != board_id or not isinstance(token, str) or not token:
        return False
    try:
        expected = bytes.fromhex(str(controller.get("tokenHash") or ""))
    except ValueError:
        # Only this module writes the hash; one that is not hex matches nothing.
        return False
    return hmac.compare_digest(expected, bytes.fromhex(_hash_token(token)))


def lease_ms(app_settings: Dict[str, Any]) -> float:
    """How long a claim on control lasts without a check-in. Never shorter
    than a few check-ins, whatever was configured, or control would flap
    between boards whenever a check-in ran a little late."""
    live_sync = app_settings["liveSync"]
    remote = app_settings["remote"]
    slowest = max(live_sync["pollMs"], remote["pollMs"] if remote["enabled"] else 0)
    return max(live_sync["leaseSeconds"] * 1000, slowest * 4)


def read_live() -> Dict[str, Any]:
    live = read_json(LIVE_PATH, {}) or {}
    live = live if isinstance(live, dict) else {}
    controller = live.get("controller")
    status = live.get("status")
    return {
        "seq": _count(live.get("seq")),
        "revision": _count(live.get("revision")),
        "events": live["events"] if isinstance(live.get("events"), list) else [],
        "controller": controller if isinstance(controller, dict) else None,
        "status": status if isinstance(status, dict) else None,
    }


def _read_remote() -> Dict[str, Any]:
    remote = read_json(REMOTE_PATH, {}) or {}
    remote = remote if isinstance(remote, dict) else {}
    commands = remote.get("commands")
    return {"seq": _count(remote.get("seq")), "commands": commands if isinstance(commands, list) else []}


def append_event(event_type: str, data: Optional[Dict[str, Any]] = None, origin: Any = None) -> Dict[str, Any]:
    """Adds something that happened to the feed. ``origin`` is the board that
    caused it, so that board does not act on its own news a second time."""
    with _LOCK:
        live = read_live()
        event = {
            "seq": live["seq"] + 1,
            "type": event_type,
            "at": js_now_iso(),
            # Only a well-formed id is kept, so a caller cannot park arbitrary
            # data in the shared feed.
            "origin": as_board_id(origin),
            "data": {} if data is None else data,
        }
        write_json(LIVE_PATH, {**live, "seq": event["seq"], "events": [*live["events"], event][-MAX_EVENTS:]})
        return event


def bump_revision() -> None:
    """Tells every screen the settings changed, so each reloads them."""
    with _LOCK:
        live = read_live()
        write_json(LIVE_PATH, {**live, "revision": live["revision"] + 1})


def _lease_is_live(controller: Optional[Dict[str, Any]], app_settings: Dict[str, Any], now: float) -> bool:
    if not controller:
        return False
    seen = js_date_parse(controller.get("seenAt"))
    return seen is not None and now - seen < lease_ms(app_settings)


def poll(
    payload: Dict[str, Any], app_settings: Dict[str, Any], now: Optional[float] = None, signed_in: bool = False
) -> Dict[str, Any]:
    """One screen checking in.

    Claims or renews the controller lease where the rules allow, and answers
    with what happened since ``after``, the controller's status, and — for the
    controller only — remote commands since ``commandsAfter``.

    Taking control needs an organiser sign-in in that browser, unless the
    organiser chose otherwise: control is what the phone remote's commands go
    to, and what decides which screens show Start and Stop.
    """
    moment = _now_ms() if now is None else now
    live_sync = app_settings["liveSync"]
    remote = app_settings["remote"]

    board_id = as_board_id(payload.get("boardId"))
    role = payload.get("role") if payload.get("role") in ROLES else "auto"
    page = payload.get("page") if payload.get("page") in PAGES else "board"
    # No cursor at all is a screen's first check-in: it takes the current
    # position and is sent no history. Zero is a real position — "seen nothing
    # yet" on a brand-new feed — and must still receive what follows.
    raw_after = payload.get("after")
    initial = raw_after is None or (isinstance(raw_after, str) and raw_after == "")
    after = 0 if initial else max(0, _count(raw_after))
    commands_after = max(0, _count(payload.get("commandsAfter")))

    with _LOCK:
        live = read_live()
        needs_controller = bool(live_sync["enabled"] or remote["enabled"])
        lease_live = _lease_is_live(live["controller"], app_settings, moment)
        controller = live["controller"] if lease_live else None
        is_controller = _holds_lease(controller, board_id, payload.get("leaseToken"))
        lease_token = None
        wrote = False

        may_claim = signed_in or not live_sync["claimRequiresSignIn"]
        if needs_controller and board_id and not is_controller and may_claim and page == "board":
            allowed_role = live_sync["controllerMode"] == "auto" or role == "main"
            # A board opened as the main one takes over from one that only
            # claimed control by being first.
            outranks = role == "main" and controller is not None and controller.get("role") != "main"
            if allowed_role and (controller is None or outranks):
                lease_token = secrets.token_urlsafe(24)
                controller = {
                    "boardId": board_id,
                    "role": role,
                    "page": page,
                    "tokenHash": _hash_token(lease_token),
                    "seenAt": _iso(moment),
                }
                is_controller = True
                wrote = True
        elif is_controller:
            # Renewed only now and then: a check-in is otherwise a pure read.
            seen = js_date_parse(controller.get("seenAt"))
            stale = seen is not None and moment - seen > lease_ms(app_settings) / 3
            if stale or controller.get("page") != page:
                controller = {**controller, "page": page, "seenAt": _iso(moment)}
                wrote = True

        if wrote:
            write_json(LIVE_PATH, {**live, "controller": controller})

    events = live["events"]
    oldest = _seq_of(events[0]) if events else live["seq"] + 1
    remote_doc = _read_remote() if is_controller and remote["enabled"] else None

    return {
        "wrote": wrote,
        "response": {
            "ok": True,
            "enabled": needs_controller,
            "seq": live["seq"],
            "revision": live["revision"],
            # Too far behind to catch up from the feed: start again from the state.
            "resync": (not initial) and (after > live["seq"] or after < oldest - 1),
            # Which board caused an event is never sent out — only whether it
            # was the one asking, so it can skip its own news.
            "events": []
            if initial
            else [
                {
                    **{name: value for name, value in as_object(event).items() if name != "origin"},
                    "mine": bool(board_id and as_object(event).get("origin") == board_id),
                }
                for event in events
                if _seq_of(event) > after
            ],
            "status": live["status"],
            "controller": {
                "active": bool(controller),
                "isYou": is_controller,
                "page": controller.get("page") if controller else None,
            },
            # Only ever sent to the board that has just claimed control.
            "leaseToken": lease_token,
            "commandSeq": remote_doc["seq"] if remote_doc else None,
            "commands": [command for command in remote_doc["commands"] if _seq_of(command) > commands_after]
            if remote_doc
            else [],
            "serverTime": _iso(moment),
        },
    }


def publish_status(payload: Dict[str, Any], app_settings: Dict[str, Any], now: Optional[float] = None) -> Dict[str, Any]:
    """The controller saying what it is doing. Followers are told when it
    starts rolling and when it moves to another screen; everything else is
    status."""
    moment = _now_ms() if now is None else now
    with _LOCK:
        live = read_live()
        lease_live = _lease_is_live(live["controller"], app_settings, moment)
        controller = live["controller"] if lease_live else None
        if not _holds_lease(controller, as_board_id(payload.get("boardId")), payload.get("leaseToken")):
            return {"ok": False, "reason": "not-controller"}

        state = payload.get("state") if payload.get("state") in STATES else "idle"
        screen = payload.get("screen") if payload.get("screen") in PAGES else "board"
        previous = live["status"] or {}
        status = {
            "state": state,
            "screen": screen,
            "prizeNumber": _number_or_none(payload.get("prizeNumber")),
            "updatedAt": _iso(moment),
        }

        happened: List[Dict[str, Any]] = []
        if state == "rolling" and previous.get("state") != "rolling":
            happened.append({"type": "roll", "data": {"prizeNumber": status["prizeNumber"]}})
        if screen != previous.get("screen") and previous.get("screen"):
            happened.append({"type": "screen", "data": {"screen": screen}})

        seq = live["seq"]
        appended = []
        for event in happened:
            seq += 1
            appended.append(
                {
                    "seq": seq,
                    "type": event["type"],
                    "at": status["updatedAt"],
                    "origin": controller.get("boardId"),
                    "data": event["data"],
                }
            )

        write_json(
            LIVE_PATH,
            {
                **live,
                "seq": seq,
                "status": status,
                "controller": {**controller, "seenAt": status["updatedAt"]},
                "events": [*live["events"], *appended][-MAX_EVENTS:],
            },
        )
        return {"ok": True, "status": status}


def push_command(action: str, value: Any = None) -> Dict[str, Any]:
    """Queues a command from the phone remote for the controller to carry out."""
    with _LOCK:
        remote = _read_remote()
        command = {"seq": remote["seq"] + 1, "action": action, "value": value, "at": js_now_iso()}
        write_json(REMOTE_PATH, {"seq": command["seq"], "commands": [*remote["commands"], command][-MAX_COMMANDS:]})
        return command


def controller_active(app_settings: Dict[str, Any], now: Optional[float] = None) -> bool:
    """Whether a controller is listening right now."""
    moment = _now_ms() if now is None else now
    return _lease_is_live(read_live()["controller"], app_settings, moment)


def clear_remote() -> None:
    """Forgets every command — after a reset or a new key."""
    with _LOCK:
        write_json(REMOTE_PATH, {"seq": _read_remote()["seq"], "commands": []})

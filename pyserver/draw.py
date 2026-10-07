"""Server-side draw execution and persistence of the running draw state.

Mirrors ``server/draw.js``: the same state shape, the same prize order and the
same pool fingerprint, so either runtime can pick up a draw the other began.
"""

import hashlib
import math
import secrets
from decimal import Decimal
from typing import Any, Dict, List, Optional, Sequence

from .coerce import js_now_iso, js_number
from .paths import DRAW_STATE_PATH
from .store import read_json, write_json
from .tickets import load_ticket_source

EMPTY_STATE: Dict[str, Any] = {"winners": [], "absent": [], "startedAt": None, "updatedAt": None}


def _now() -> str:
    # CHANGED: written as JavaScript writes it (millisecond precision, a Z), so
    # a results file reads the same whichever runtime recorded it.
    return js_now_iso()


def _as_index(value: Any) -> float:
    """``Number(value)``, for comparing the draw indexes and prize numbers stored."""
    return js_number(value)


def load_draw_state() -> Dict[str, Any]:
    """The draw as recorded.

    ``absent`` holds winners struck off as not present. ``sequence`` counts
    every draw ever made, so a draw index is never reused once a winner is
    struck off and the prize drawn again. A file written before either existed
    reads as having none.
    """
    state = read_json(DRAW_STATE_PATH, EMPTY_STATE) or EMPTY_STATE
    winners = state.get("winners") if isinstance(state.get("winners"), list) else []
    absent = state.get("absent") if isinstance(state.get("absent"), list) else []

    highest = 0
    for entry in [*winners, *absent]:
        index = _as_index((entry or {}).get("drawIndex"))
        if math.isfinite(index) and index > highest:
            highest = index
    stored_sequence = _as_index(state.get("sequence"))
    sequence = max(stored_sequence if math.isfinite(stored_sequence) else 0, highest)

    pool_size = state.get("poolSize")
    pool_size_number = _as_index(pool_size)

    return {
        "winners": winners,
        "absent": absent,
        "sequence": int(sequence),
        "poolFingerprint": state.get("poolFingerprint") if isinstance(state.get("poolFingerprint"), str) else None,
        "poolSize": int(pool_size_number)
        if pool_size is not None and math.isfinite(pool_size_number)
        else None,
        "startedAt": state.get("startedAt") or None,
        "updatedAt": state.get("updatedAt") or None,
    }


def save_draw_state(state: Dict[str, Any]) -> None:
    write_json(DRAW_STATE_PATH, {**state, "updatedAt": _now()})


def read_tickets(app_settings: Dict[str, Any]) -> Dict[str, Any]:
    return load_ticket_source(app_settings["data"], app_settings["data"]["duplicatePolicy"])


def _js_float_string(value: float) -> str:
    """``Number.prototype.toString`` for a finite float: the shortest digits
    that round-trip (as repr finds them), laid out by JavaScript's rules —
    fixed notation from 1e-7 up to 1e21, exponential outside it."""
    if value == 0:
        return "0"
    sign, digit_tuple, exponent = Decimal(repr(abs(value))).as_tuple()
    digits = "".join(str(d) for d in digit_tuple).rstrip("0")
    exponent += len(digit_tuple) - len(digits)
    k = len(digits)
    n = exponent + k
    prefix = "-" if value < 0 else ""

    if k <= n <= 21:
        return prefix + digits + "0" * (n - k)
    if 0 < n <= 21:
        return prefix + digits[:n] + "." + digits[n:]
    if -6 < n <= 0:
        return prefix + "0." + "0" * (-n) + digits
    power = n - 1
    mantissa = digits if k == 1 else digits[0] + "." + digits[1:]
    return f"{prefix}{mantissa}e{'+' if power >= 0 else '-'}{abs(power)}"


def _js_string(value: Any) -> str:
    """``String(value)`` for the values a JSON record can hold."""
    if value is None:
        return "null"
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, int):
        return str(value)
    if isinstance(value, float):
        if math.isnan(value):
            return "NaN"
        if math.isinf(value):
            return "Infinity" if value > 0 else "-Infinity"
        return _js_float_string(value)
    if isinstance(value, list):
        return ",".join("" if item is None else _js_string(item) for item in value)
    if isinstance(value, dict):
        return "[object Object]"
    return str(value)


def _identity(record: Any, identifier: str) -> str:
    value = record.get(identifier) if isinstance(record, dict) else None
    return ("" if value is None else _js_string(value)).lower()


def _ticket_identity(ticket: Dict[str, Any], identifier: str) -> str:
    # `ticket[identifier] || ''` — any falsy value reads as empty.
    value = ticket.get(identifier)
    return _js_string(value).lower() if value not in (None, "", 0, False) else ""


def remaining_pool(
    tickets: Sequence[Dict[str, Any]],
    winners: Sequence[Dict[str, Any]],
    identifier: str,
    absent: Sequence[Dict[str, Any]] = (),
) -> List[Dict[str, Any]]:
    """Entries still in the draw: everyone not yet drawn and, unless the
    organiser returns them to the pool, not struck off as absent either."""
    drawn = {_identity((entry or {}).get("record"), identifier) for entry in [*winners, *absent]}
    return [ticket for ticket in tickets if _ticket_identity(ticket, identifier) not in drawn]


def _excluded_absent(app_settings: Dict[str, Any], absent: Sequence[Dict[str, Any]]) -> Sequence[Dict[str, Any]]:
    redraw = app_settings.get("redraw") or {}
    return [] if redraw.get("returnToPool") else absent


def _prize_order(app_settings: Dict[str, Any]) -> List[int]:
    """The prize position each draw awards, in the order the organiser chose:
    highest-first runs 1, 2, 3…, lowest-first counts back from the last prize
    so the evening builds to the top one."""
    ascending = list(range(1, app_settings["totalPrizes"] + 1))
    return ascending[::-1] if app_settings["prizes"]["drawOrder"] == "lowest-first" else ascending


def next_prize_number(app_settings: Dict[str, Any], winners: Sequence[Dict[str, Any]]) -> Optional[int]:
    """The prize the next draw awards: the first in order that nobody holds.

    With no winner ever struck off this is exactly the next position in the
    sequence. Once a winner is marked absent their prize is open again, and it
    is the one drawn next — the room redraws the prize it was just watching.
    """
    awarded = {_as_index(winner.get("prizeNumber")) for winner in winners}
    return next((prize for prize in _prize_order(app_settings) if prize not in awarded), None)


def prize_number_for_draw(app_settings: Dict[str, Any], draw_index: int) -> int:
    """Kept for callers that think in draw positions rather than prizes held."""
    order = _prize_order(app_settings)
    if not order:
        return 1
    return order[min(draw_index, len(order) - 1)] or 1


def _utf16_key(text: str) -> bytes:
    # JavaScript sorts strings by UTF-16 code unit, Python by code point; the
    # two differ only above U+FFFF, but a fingerprint has to agree everywhere.
    return text.encode("utf-16-be", "surrogatepass")


def pool_fingerprint(tickets: Sequence[Dict[str, Any]]) -> str:
    """A fingerprint of the entry list, independent of row order.

    Each record is written as its fields in key order, the records are sorted,
    and the lot is hashed. Recorded when the first winner is drawn, so the
    certificate can show exactly which list the draw ran against — and anyone
    holding that list can recompute it. Produces the same hash as Node.
    """
    lines = sorted(
        (
            "\u001f".join(
                f"{key}={'' if ticket[key] is None else _js_string(ticket[key])}"
                for key in sorted(ticket.keys(), key=_utf16_key)
            )
            for ticket in tickets
        ),
        key=_utf16_key,
    )
    return hashlib.sha256("\n".join(lines).encode("utf-8", "surrogatepass")).hexdigest()


def build_stats(
    app_settings: Dict[str, Any],
    tickets: Sequence[Dict[str, Any]],
    winners: Sequence[Dict[str, Any]],
    absent: Sequence[Dict[str, Any]] = (),
) -> Dict[str, Any]:
    total_prizes = app_settings["totalPrizes"]
    excluded = _excluded_absent(app_settings, absent)
    remaining_tickets = len(remaining_pool(tickets, winners, app_settings["data"]["identifier"], excluded))
    return {
        "totalPrizes": total_prizes,
        "winnersCount": len(winners),
        "absentCount": len(absent),
        "remainingPrizes": max(0, total_prizes - len(winners)),
        "totalTickets": len(tickets),
        "remainingTickets": remaining_tickets,
        "isComplete": len(winners) >= total_prizes or remaining_tickets == 0,
        # What the next Start will award, so the board can announce it first.
        "nextPrizeNumber": next_prize_number(app_settings, winners) if len(winners) < total_prizes else None,
    }


def stats_for(app_settings: Dict[str, Any], tickets: Sequence[Dict[str, Any]], state: Dict[str, Any]) -> Dict[str, Any]:
    return build_stats(app_settings, tickets, state["winners"], state["absent"])


def draw_winner(app_settings: Dict[str, Any]) -> Dict[str, Any]:
    """Draw once and persist. Exhausted prizes are a result, not an exception."""
    tickets = read_tickets(app_settings)["tickets"]
    state = load_draw_state()

    if not tickets:
        return {"ok": False, "reason": "no-tickets", "message": "No participants have been uploaded yet."}

    prize_number = next_prize_number(app_settings, state["winners"])
    if len(state["winners"]) >= app_settings["totalPrizes"] or prize_number is None:
        return {"ok": False, "reason": "prizes-exhausted", "message": "All prizes have already been awarded."}

    pool = remaining_pool(
        tickets, state["winners"], app_settings["data"]["identifier"], _excluded_absent(app_settings, state["absent"])
    )
    if not pool:
        return {"ok": False, "reason": "pool-empty", "message": "Every ticket has already been drawn."}

    # secrets.randbelow is uniform and cryptographically sound, which matters
    # for a draw whose fairness has to be defensible.
    selected = pool[secrets.randbelow(len(pool))]
    is_first_draw = not state["winners"] and not state["absent"]
    winner = {
        "prizeNumber": prize_number,
        "drawIndex": state["sequence"] + 1,
        "drawnAt": _now(),
        # How many entries this draw chose from — the odds the room actually had.
        "poolSize": len(pool),
        "record": selected,
    }

    next_state = {
        **state,
        "sequence": winner["drawIndex"],
        "startedAt": state["startedAt"] or winner["drawnAt"],
        "poolFingerprint": pool_fingerprint(tickets)
        if is_first_draw or not state["poolFingerprint"]
        else state["poolFingerprint"],
        "poolSize": len(tickets) if is_first_draw or state["poolSize"] is None else state["poolSize"],
        "winners": [*state["winners"], winner],
    }
    save_draw_state(next_state)

    return {"ok": True, "winner": winner, "stats": stats_for(app_settings, tickets, next_state)}


def mark_absent(app_settings: Dict[str, Any], draw_index: Any = None) -> Dict[str, Any]:
    """Strike a winner off as not present, opening their prize again.

    ``draw_index`` names the winner; without it the most recent is meant, which
    is the one on the board. The entry is kept in ``absent`` with when it
    happened, so the result stays auditable rather than quietly disappearing.
    """
    redraw = app_settings.get("redraw") or {}
    if not redraw.get("enabled"):
        return {
            "ok": False,
            "reason": "redraw-disabled",
            "message": "Redrawing for a winner who is not present is switched off.",
        }

    state = load_draw_state()
    if not state["winners"]:
        return {"ok": False, "reason": "no-winner", "message": "There is no winner to mark as not present."}

    if draw_index is None or draw_index == "":
        target_position: Optional[int] = len(state["winners"]) - 1
    else:
        wanted = _as_index(draw_index)
        target_position = next(
            (i for i, winner in enumerate(state["winners"]) if _as_index(winner.get("drawIndex")) == wanted),
            None,
        )
    if target_position is None:
        return {"ok": False, "reason": "not-found", "message": "That winner is no longer in the results."}

    target = state["winners"][target_position]
    redrawn = sum(
        1 for entry in state["absent"] if _as_index(entry.get("prizeNumber")) == _as_index(target.get("prizeNumber"))
    )
    max_per_prize = redraw.get("maxPerPrize") or 0
    if max_per_prize > 0 and redrawn >= max_per_prize:
        return {
            "ok": False,
            "reason": "redraw-limit",
            "message": f"This prize has already been redrawn {redrawn} time(s), the most allowed.",
        }

    struck = {**target, "absentAt": _now()}
    next_state = {
        **state,
        "winners": [winner for i, winner in enumerate(state["winners"]) if i != target_position],
        "absent": [*state["absent"], struck],
    }
    save_draw_state(next_state)

    tickets = read_tickets(app_settings)["tickets"]
    return {"ok": True, "absent": struck, "stats": stats_for(app_settings, tickets, next_state)}


def restore_absent(app_settings: Dict[str, Any], draw_index: Any) -> Dict[str, Any]:
    """Put a winner struck off by mistake back in the results.

    Only while their prize is still open and they have not been drawn again
    since — otherwise two people would hold one prize, or one person two.
    """
    state = load_draw_state()
    wanted = _as_index(draw_index)
    position = next(
        (i for i, entry in enumerate(state["absent"]) if _as_index(entry.get("drawIndex")) == wanted), None
    )
    if position is None:
        return {"ok": False, "reason": "not-found", "message": "That entry is not in the not-present list."}

    target = state["absent"][position]
    identifier = app_settings["data"]["identifier"]
    if any(_as_index(w.get("prizeNumber")) == _as_index(target.get("prizeNumber")) for w in state["winners"]):
        return {"ok": False, "reason": "prize-taken", "message": "That prize has already been drawn again."}
    if any(
        _identity(w.get("record"), identifier) == _identity(target.get("record"), identifier) for w in state["winners"]
    ):
        return {"ok": False, "reason": "already-winner", "message": "That entry has since won another prize."}

    restored = {key: value for key, value in target.items() if key != "absentAt"}
    winners = sorted([*state["winners"], restored], key=lambda entry: _as_index(entry.get("drawIndex")))
    next_state = {
        **state,
        "winners": winners,
        "absent": [entry for i, entry in enumerate(state["absent"]) if i != position],
    }
    save_draw_state(next_state)

    tickets = read_tickets(app_settings)["tickets"]
    return {"ok": True, "restored": restored, "stats": stats_for(app_settings, tickets, next_state)}


def undo_last_winner(app_settings: Dict[str, Any]) -> Dict[str, Any]:
    state = load_draw_state()
    if not state["winners"]:
        return {"ok": False, "reason": "nothing-to-undo", "message": "There are no draws to undo."}

    removed = state["winners"][-1]
    next_state = {**state, "winners": state["winners"][:-1]}
    save_draw_state(next_state)

    tickets = read_tickets(app_settings)["tickets"]
    return {"ok": True, "removed": removed, "stats": stats_for(app_settings, tickets, next_state)}


def reset_draw(app_settings: Dict[str, Any]) -> Dict[str, Any]:
    save_draw_state(
        {"winners": [], "absent": [], "sequence": 0, "poolFingerprint": None, "poolSize": None, "startedAt": None}
    )
    return {"ok": True, "stats": build_stats(app_settings, read_tickets(app_settings)["tickets"], [], [])}

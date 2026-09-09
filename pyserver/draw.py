"""Server-side draw execution and persistence of the running draw state."""

import secrets
from datetime import datetime, timezone
from typing import Any, Dict, List, Sequence

from .paths import DRAW_STATE_PATH
from .store import read_json, write_json
from .tickets import load_ticket_source

EMPTY_STATE: Dict[str, Any] = {"winners": [], "startedAt": None, "updatedAt": None}


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def load_draw_state() -> Dict[str, Any]:
    state = read_json(DRAW_STATE_PATH, EMPTY_STATE) or EMPTY_STATE
    winners = state.get("winners")
    return {
        "winners": winners if isinstance(winners, list) else [],
        "startedAt": state.get("startedAt"),
        "updatedAt": state.get("updatedAt"),
    }


def save_draw_state(state: Dict[str, Any]) -> None:
    write_json(DRAW_STATE_PATH, {**state, "updatedAt": _now()})


def read_tickets(app_settings: Dict[str, Any]) -> Dict[str, Any]:
    return load_ticket_source(app_settings["data"], app_settings["data"]["duplicatePolicy"])


def remaining_pool(
    tickets: Sequence[Dict[str, Any]], winners: Sequence[Dict[str, Any]], identifier: str
) -> List[Dict[str, Any]]:
    drawn = {str((winner.get("record") or {}).get(identifier, "")).lower() for winner in winners}
    return [ticket for ticket in tickets if str(ticket.get(identifier, "")).lower() not in drawn]


def build_stats(
    app_settings: Dict[str, Any], tickets: Sequence[Dict[str, Any]], winners: Sequence[Dict[str, Any]]
) -> Dict[str, Any]:
    total_prizes = app_settings["totalPrizes"]
    remaining_tickets = len(remaining_pool(tickets, winners, app_settings["data"]["identifier"]))
    return {
        "totalPrizes": total_prizes,
        "winnersCount": len(winners),
        "remainingPrizes": max(0, total_prizes - len(winners)),
        "totalTickets": len(tickets),
        "remainingTickets": remaining_tickets,
        "isComplete": len(winners) >= total_prizes or remaining_tickets == 0,
    }


def draw_winner(app_settings: Dict[str, Any]) -> Dict[str, Any]:
    """Draw once and persist. Exhausted prizes are a result, not an exception."""
    tickets = read_tickets(app_settings)["tickets"]
    state = load_draw_state()

    if not tickets:
        return {"ok": False, "reason": "no-tickets", "message": "No participants have been uploaded yet."}

    if len(state["winners"]) >= app_settings["totalPrizes"]:
        return {"ok": False, "reason": "prizes-exhausted", "message": "All prizes have already been awarded."}

    pool = remaining_pool(tickets, state["winners"], app_settings["data"]["identifier"])
    if not pool:
        return {"ok": False, "reason": "pool-empty", "message": "Every ticket has already been drawn."}

    # secrets.randbelow is uniform and cryptographically sound, which matters
    # for a draw whose fairness has to be defensible.
    selected = pool[secrets.randbelow(len(pool))]
    winner = {"prizeNumber": len(state["winners"]) + 1, "drawnAt": _now(), "record": selected}

    next_state = {
        **state,
        "startedAt": state["startedAt"] or winner["drawnAt"],
        "winners": [*state["winners"], winner],
    }
    save_draw_state(next_state)

    return {"ok": True, "winner": winner, "stats": build_stats(app_settings, tickets, next_state["winners"])}


def undo_last_winner(app_settings: Dict[str, Any]) -> Dict[str, Any]:
    state = load_draw_state()
    if not state["winners"]:
        return {"ok": False, "reason": "nothing-to-undo", "message": "There are no draws to undo."}

    removed = state["winners"][-1]
    next_state = {**state, "winners": state["winners"][:-1]}
    save_draw_state(next_state)

    tickets = read_tickets(app_settings)["tickets"]
    return {"ok": True, "removed": removed, "stats": build_stats(app_settings, tickets, next_state["winners"])}


def reset_draw(app_settings: Dict[str, Any]) -> Dict[str, Any]:
    save_draw_state({"winners": [], "startedAt": None})
    return {"ok": True, "stats": build_stats(app_settings, read_tickets(app_settings)["tickets"], [])}

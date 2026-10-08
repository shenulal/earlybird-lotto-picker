"""Endpoints for live sync between screens, the phone remote, sponsor logos
and "Reset event".

Registered on the same blueprint as everything else by
:func:`register_stage_routes`, which is handed the sign-in helpers rather than
importing them, so this module and ``routes.py`` do not import each other.
Mirrors ``server/stage-routes.js``.
"""

from datetime import datetime, timedelta, timezone
from typing import Any, Callable, Dict, Optional, Sequence

from flask import Blueprint, jsonify, request

from . import draw, images, live, reset, schema, templates
from . import stage_features as stage
from .auth import LoginThrottle, verify_password
from .coerce import js_number, js_truthy
from .draw import _js_string
from .settings import active_admin_credential, load_settings_file, normalize_app_settings, save_settings_file

PAGES = ("board", "welcome", "prizes")

# What the phone remote may ask for, and which switch allows it.
REMOTE_COMMANDS = {
    "toggle": "draw",
    "start": "draw",
    "stop": "draw",
    "notPresent": "notPresent",
    "screen": "screens",
    "mute": "sound",
}


def _payload() -> Dict[str, Any]:
    payload = request.get_json(silent=True)
    return payload if isinstance(payload, dict) else {}


def _js_text(value: Any) -> str:
    """``String(value || '')``."""
    return _js_string(value) if js_truthy(value) else ""


def _iso(moment: datetime) -> str:
    return moment.isoformat(timespec="milliseconds").replace("+00:00", "Z")


def register_stage_routes(
    api: Blueprint,
    require_auth: Callable,
    current_username: Callable[[], Any],
    public_winner: Callable[[Dict[str, Any], Sequence[str]], Dict[str, Any]],
    throttle: LoginThrottle,
) -> None:
    """Adds the live, remote, sponsor-logo and reset endpoints to the API
    blueprint. ``throttle`` is the sign-in lockout, shared so wrong pairing
    keys and wrong reset passwords count the same way wrong passwords do."""

    # ------------------------------------------------------------ live sync

    @api.post("/live/poll")
    def post_live_poll():
        """Every screen checks in here on a timer. Writes only when it claims
        or renews control, so most calls are reads."""
        app_settings = load_settings_file()["appSettings"]
        result = live.poll(_payload(), app_settings, signed_in=bool(current_username()))
        response = jsonify(result["response"])
        response.headers["Cache-Control"] = "no-store"
        return response

    @api.post("/live/status")
    def post_live_status():
        """The controller saying what it is doing: rolling, revealing, which
        screen it is on. Only the board holding control is listened to."""
        app_settings = load_settings_file()["appSettings"]
        result = live.publish_status(_payload(), app_settings)
        return jsonify(result), (200 if result["ok"] else 409)

    # --------------------------------------------------------- phone remote

    def remote_access(app_settings: Dict[str, Any], presented_key: Any) -> Dict[str, Any]:
        """Whether this request may use the remote: a signed-in organiser
        always may; otherwise the pairing key, unless the organiser requires
        sign-in. Wrong keys count towards the same lockout as wrong passwords."""
        remote = app_settings["remote"]
        if not remote["enabled"]:
            return {"ok": False, "status": 403, "error": "The phone remote is switched off."}
        if current_username():
            return {"ok": True}
        if remote["requireSignIn"]:
            return {"ok": False, "status": 401, "error": "Sign in on this phone to use the remote."}

        client_key = f"remote:{request.remote_addr or 'unknown'}"
        if throttle.is_locked_out(client_key):
            return {"ok": False, "status": 429, "error": "Too many attempts. Try again in 15 minutes."}
        if not stage.remote_key_matches(remote, presented_key):
            throttle.register_failure(client_key)
            return {
                "ok": False,
                "status": 401,
                "error": "This remote link is not valid any more. Scan the code in the console again.",
            }
        throttle.clear(client_key)
        return {"ok": True}

    def refused(access: Dict[str, Any]):
        return jsonify({"ok": False, "error": access["error"]}), access["status"]

    def remote_snapshot(app_settings: Dict[str, Any]) -> Dict[str, Any]:
        tickets = draw.read_tickets(app_settings)["tickets"]
        state = draw.load_draw_state()
        stats = draw.stats_for(app_settings, tickets, state)
        allowed = schema.public_field_keys(app_settings["display"])
        last = state["winners"][-1] if state["winners"] else None
        copy = app_settings["copy"]

        def prize_at(number: Any) -> Optional[Dict[str, Any]]:
            if not app_settings["prizes"]["enabled"] or not number:
                return None
            items = app_settings["prizes"]["items"]
            position = int(number) - 1 if isinstance(number, (int, float)) and float(number).is_integer() else -1
            return items[position] if 0 <= position < len(items) else None

        return {
            "eventName": app_settings["eventName"],
            "stats": stats,
            "status": live.read_live()["status"],
            "controller": live.controller_active(app_settings),
            "nextPrize": prize_at(stats.get("nextPrizeNumber")),
            "lastWinner": {**public_winner(last, allowed), "prize": prize_at(last.get("prizeNumber"))} if last else None,
            "labels": [
                {"key": field["key"], "label": field["label"]}
                for field in app_settings["data"]["fields"]
                if field["key"] in allowed
            ],
            "cardFields": [line["field"] for line in app_settings["display"]["card"]["lines"]],
            "remote": stage.public_remote(app_settings["remote"]),
            "notPresentAvailable": app_settings["redraw"]["enabled"],
            "copy": {
                name: copy[name]
                for name in (
                    "startButton",
                    "stopButton",
                    "notPresentButton",
                    "notPresentConfirm",
                    "prizeLabel",
                    "welcomeToggle",
                    "boardToggle",
                    "prizesToggle",
                    "soundToggle",
                )
            },
        }

    @api.get("/remote/state")
    def get_remote_state():
        app_settings = load_settings_file()["appSettings"]
        # The key travels in a header, not the address, so access logs and
        # proxies along the way do not record it.
        access = remote_access(app_settings, request.headers.get("X-Pickora-Remote-Key"))
        if not access["ok"]:
            return refused(access)
        response = jsonify({"ok": True, **remote_snapshot(app_settings)})
        response.headers["Cache-Control"] = "no-store"
        return response

    @api.post("/remote/command")
    def post_remote_command():
        app_settings = load_settings_file()["appSettings"]
        payload = _payload()
        access = remote_access(app_settings, payload.get("key"))
        if not access["ok"]:
            return refused(access)

        action = _js_text(payload.get("action"))
        permission = REMOTE_COMMANDS.get(action)
        if not permission:
            return jsonify({"ok": False, "error": "Unknown command."}), 400
        if not app_settings["remote"]["actions"][permission]:
            return jsonify({"ok": False, "error": "The organiser has not allowed that from the remote."}), 403

        # "Not present" is carried out here and now, by the server: the remote
        # is already an authorised channel, and the board learns of it from the
        # live feed whether or not it is signed in.
        if action == "notPresent":
            if not app_settings["redraw"]["enabled"]:
                return (
                    jsonify({"ok": False, "error": "Redrawing for a winner who is not present is switched off."}),
                    403,
                )
            # The remote names the winner it is showing, and only that winner —
            # still the latest, and not mid-spin — can be struck off. A second
            # tap, or a second phone, must not strike the previous prize's winner.
            winners = draw.load_draw_state()["winners"]
            latest = winners[-1] if winners else None
            status = live.read_live()["status"]
            if not latest or js_number(payload.get("value")) != js_number(latest.get("drawIndex")):
                return (
                    jsonify(
                        {
                            "ok": False,
                            "reason": "not-latest",
                            "error": "That winner is no longer the latest. Nothing was changed.",
                        }
                    ),
                    409,
                )
            if status and status.get("state") == "rolling":
                return jsonify({"ok": False, "reason": "rolling", "error": "Wait for the draw to finish."}), 409
            result = draw.mark_absent(app_settings, latest.get("drawIndex"))
            if not result["ok"]:
                return jsonify(result), 409
            live.append_event(
                "absent",
                {
                    "absent": public_winner(result["absent"], schema.public_field_keys(app_settings["display"])),
                    "autoRedraw": app_settings["redraw"]["autoRedraw"],
                    "source": "remote",
                },
            )
            return jsonify({"ok": True, "delivered": True, **remote_snapshot(app_settings)})

        value: Any = None
        if action == "screen":
            if payload.get("value") not in PAGES:
                return jsonify({"ok": False, "error": "Unknown screen."}), 400
            value = payload["value"]
        if action == "mute":
            value = payload["value"] if isinstance(payload.get("value"), bool) else "toggle"

        live.push_command(action, value)
        delivered = live.controller_active(app_settings)
        return jsonify(
            {
                "ok": True,
                "delivered": delivered,
                "message": "" if delivered else "No draw board is listening. Open the draw board on the event computer.",
                **remote_snapshot(app_settings),
            }
        )

    @api.post("/admin/remote/key")
    @require_auth
    def post_remote_key():
        """A fresh pairing key, valid for the organiser's chosen number of
        hours. Making one replaces the last, so an old link stops working at
        once."""
        settings_file = load_settings_file()
        remote = settings_file["appSettings"]["remote"]
        now = datetime.now(timezone.utc)
        hours = remote["expiryHours"]
        expires = _iso(now + timedelta(hours=hours)) if hours > 0 else ""
        app_settings = normalize_app_settings(
            {
                **settings_file["appSettings"],
                "remote": {
                    **remote,
                    "enabled": True,
                    "key": stage.new_remote_key(),
                    "keyCreatedAt": _iso(now),
                    "keyExpiresAt": expires,
                },
            }
        )
        save_settings_file({**settings_file, "appSettings": app_settings})
        live.clear_remote()
        return jsonify({"ok": True, "appSettings": app_settings})

    @api.delete("/admin/remote/key")
    @require_auth
    def delete_remote_key():
        settings_file = load_settings_file()
        app_settings = normalize_app_settings(
            {
                **settings_file["appSettings"],
                "remote": {**settings_file["appSettings"]["remote"], "key": "", "keyCreatedAt": "", "keyExpiresAt": ""},
            }
        )
        save_settings_file({**settings_file, "appSettings": app_settings})
        live.clear_remote()
        return jsonify({"ok": True, "appSettings": app_settings})

    # -------------------------------------------------------- sponsor logos

    def with_logo(sponsors: Dict[str, Any], sponsor_id: str, logo: Dict[str, Any]) -> Dict[str, Any]:
        return {
            **sponsors,
            "items": [{**item, "logo": logo} if item["id"] == sponsor_id else item for item in sponsors["items"]],
        }

    @api.post("/admin/sponsors/<sponsor_id>/logo")
    @require_auth
    def add_sponsor_logo(sponsor_id: str):
        settings_file = load_settings_file()
        sponsors = settings_file["appSettings"]["sponsors"]
        sponsor = next((item for item in sponsors["items"] if item["id"] == sponsor_id), None)
        if sponsor is None:
            return jsonify({"ok": False, "error": "Save the sponsor first, then add its logo."}), 404

        payload = _payload()
        try:
            asset = images.save_image_asset("sponsor", payload.get("content"), payload.get("name"))
        except ValueError as error:
            return jsonify({"ok": False, "error": str(error)}), 400

        previous = sponsor["logo"]["src"]
        logo = {"src": asset["src"], "width": asset["width"], "height": asset["height"]}
        app_settings = normalize_app_settings(
            {**settings_file["appSettings"], "sponsors": with_logo(sponsors, sponsor["id"], logo)}
        )
        save_settings_file({**settings_file, "appSettings": app_settings})
        if previous and previous != asset["src"]:
            templates.remove_if_unused(previous, app_settings)
        return jsonify({"ok": True, "asset": asset, "appSettings": app_settings})

    @api.delete("/admin/sponsors/<sponsor_id>/logo")
    @require_auth
    def delete_sponsor_logo(sponsor_id: str):
        settings_file = load_settings_file()
        sponsors = settings_file["appSettings"]["sponsors"]
        sponsor = next((item for item in sponsors["items"] if item["id"] == sponsor_id), None)
        if sponsor is None:
            return jsonify({"ok": False, "error": "That sponsor no longer exists."}), 404

        logo = {"src": "", "width": None, "height": None}
        app_settings = normalize_app_settings(
            {**settings_file["appSettings"], "sponsors": with_logo(sponsors, sponsor["id"], logo)}
        )
        save_settings_file({**settings_file, "appSettings": app_settings})
        templates.remove_if_unused(sponsor["logo"]["src"], app_settings)
        return jsonify({"ok": True, "appSettings": app_settings})

    # ---------------------------------------------------------- reset event

    @api.post("/admin/reset-event")
    @require_auth
    def post_reset_event():
        """Clears the chosen parts of the event. Guarded twice over: the
        organiser must type the event's name exactly, and give the console
        password again — checked here, and counted towards the sign-in lockout
        when wrong. A session left open on an unattended laptop is not enough."""
        payload = _payload()
        client_key = f"reset:{request.remote_addr or 'unknown'}"
        if throttle.is_locked_out(client_key):
            return jsonify({"ok": False, "error": "Too many failed attempts. Try again in 15 minutes."}), 429

        settings_file = load_settings_file()
        app_settings = settings_file["appSettings"]
        if not reset.as_scope(payload.get("scope")):
            return jsonify({"ok": False, "error": "Choose at least one thing to clear."}), 400

        typed = _js_text(payload.get("confirmText")).strip()
        if typed.lower() != app_settings["eventName"].strip().lower():
            return (
                jsonify(
                    {
                        "ok": False,
                        "reason": "confirm-text",
                        "error": f"Type the event name — {app_settings['eventName']} — to confirm.",
                    }
                ),
                400,
            )

        if not verify_password(_js_text(payload.get("password")), active_admin_credential(settings_file)):
            throttle.register_failure(client_key)
            return jsonify({"ok": False, "reason": "password", "error": "That password is not correct."}), 401
        throttle.clear(client_key)

        result = reset.reset_event(
            payload.get("scope"),
            app_settings,
            lambda following: save_settings_file({**settings_file, "appSettings": following}),
        )
        return jsonify(result), (200 if result["ok"] else 400)

"""HTTP API shared by the public board and the organiser console."""

from datetime import datetime, timezone
from functools import wraps
from typing import Any, Callable, Dict, List, Optional, Sequence, Tuple

from flask import Blueprint, Response, jsonify, request, session

from . import draw, images, live, schema, sheets, templates, tickets as ticket_store
from . import stage_features as stage
from .build import BUILD
from .auth import LoginThrottle, hash_password, verify_password
from .coerce import js_now_iso, js_number, js_truthy
from .feature_routes import public_draw, register_feature_routes
from .features import countdown_locks_draw
from .stage_routes import register_stage_routes
from .settings import (
    MAX_PRIZE_IMAGES,
    MAX_WELCOME_IMAGES,
    active_admin_credential,
    ensure_admin_credentials,
    load_settings_file,
    normalize_app_settings,
    save_settings_file,
)
from .store import StorageError

MIN_PASSWORD_LENGTH = 8
SESSION_KEY = "admin_username"
ASSET_KINDS = ("logo", "background")

api = Blueprint("api", __name__)
throttle = LoginThrottle()


def current_username() -> Optional[str]:
    return session.get(SESSION_KEY)


def require_auth(view: Callable) -> Callable:
    @wraps(view)
    def wrapper(*args, **kwargs):
        if not current_username():
            return jsonify({"ok": False, "error": "Sign in to continue."}), 401
        return view(*args, **kwargs)

    return wrapper


def public_winner(winner: Dict[str, Any], allowed_keys: Sequence[str]) -> Dict[str, Any]:
    """The board only ever receives the fields its own display slots reference."""
    return {
        "prizeNumber": winner.get("prizeNumber"),
        "drawIndex": winner.get("drawIndex") or winner.get("prizeNumber"),
        "drawnAt": winner.get("drawnAt"),
        "record": schema.project_record(winner.get("record") or {}, allowed_keys),
    }


def merge_settings(stored: Dict[str, Any], incoming: Dict[str, Any]) -> Dict[str, Any]:
    """Merge an update over what is stored, one level into each section.

    A payload naming only ``prizes.drawOrder`` must not take the prize list
    with it, so sections are merged rather than replaced. Lists are replaced
    whole — a caller sending a list means that list.
    """
    merged = dict(stored)
    for key, value in incoming.items():
        previous = stored.get(key)
        if isinstance(value, dict) and isinstance(previous, dict):
            merged[key] = {**previous, **value}
        else:
            merged[key] = value
    return merged


def export_columns(app_settings: Dict[str, Any], with_status: bool = False) -> List[Tuple[str, str]]:
    return [
        ("prizeNumber", "Prize #"),
        *[(f["key"], f["label"]) for f in app_settings["data"]["fields"] if f["includeInExport"]],
        ("drawnAt", "Drawn At"),
        # NEW: once anyone has been struck off as not present, the export says
        # who, so the file is a complete record rather than only the survivors.
        *([("status", "Status"), ("absentAt", "Marked Not Present At")] if with_status else []),
    ]


def remove_if_unused(src: Any, app_settings: Dict[str, Any]) -> None:
    """Deletes an uploaded file once neither the event nor a template uses it."""
    templates.remove_if_unused(src, app_settings)


def body() -> Dict[str, Any]:
    payload = request.get_json(silent=True)
    return payload if isinstance(payload, dict) else {}


def board_origin() -> Any:
    """NEW: the board that sent this request, named in the live feed so it does
    not act on its own news twice — ``body.boardId || null``."""
    board_id = body().get("boardId")
    return board_id if js_truthy(board_id) else None


@api.errorhandler(StorageError)
def handle_storage_error(error: StorageError):
    return jsonify({"ok": False, "error": str(error)}), 500


# ------------------------------------------------------------------ public


@api.get("/settings")
def get_settings():
    app_settings = load_settings_file()["appSettings"]
    public_keys = schema.public_field_keys(app_settings["display"])
    data = app_settings["data"]

    # Field metadata the board needs for labels, without export or sensitivity
    # flags that are an organiser concern.
    # CHANGED: the certificate's settings — signatories, venue, notes — are the
    # organiser's document, not the board's, and stay off this response.
    exposed = {
        **{key: value for key, value in app_settings.items() if key not in ("data", "certificate")},
        # NEW: the remote's pairing key is a secret; screens see the rest.
        "remote": stage.public_remote(app_settings["remote"]),
        "data": {
            "identifier": data["identifier"],
            "fields": [
                {"key": f["key"], "label": f["label"]} for f in data["fields"] if f["key"] in public_keys
            ],
        },
    }

    return jsonify(
        {
            "ok": True,
            "appSettings": exposed,
            "session": {"authenticated": bool(current_username())},
            # NEW: the countdown runs against the server's clock, not the
            # screen's, so every screen in the room reaches zero together.
            "serverTime": js_now_iso(),
        }
    )


@api.get("/pool")
def get_pool():
    app_settings = load_settings_file()["appSettings"]
    source = draw.read_tickets(app_settings)
    state = draw.load_draw_state()
    # The reel animates over live records, so only reel fields are sent — plus
    # the wheel's label field, when the wheel is the draw style.
    wheel = app_settings["wheel"]
    wheel_key = [wheel["labelField"]] if wheel["style"] == "wheel" and wheel["labelField"] else []
    reel_keys = list(dict.fromkeys([*(line["field"] for line in app_settings["display"]["reel"]["lines"]), *wheel_key]))

    excluded = [] if app_settings["redraw"]["returnToPool"] else state["absent"]
    pool = draw.remaining_pool(source["tickets"], state["winners"], app_settings["data"]["identifier"], excluded)
    return jsonify(
        {
            "ok": True,
            "pool": [schema.project_record(ticket, reel_keys) for ticket in pool],
            "stats": draw.stats_for(app_settings, source["tickets"], state),
        }
    )


@api.get("/state")
def get_state():
    app_settings = load_settings_file()["appSettings"]
    source = draw.read_tickets(app_settings)
    state = draw.load_draw_state()

    return jsonify(
        {
            "ok": True,
            **public_draw(app_settings, state, public_winner),
            "stats": draw.stats_for(app_settings, source["tickets"], state),
        }
    )


@api.post("/draw")
def post_draw():
    app_settings = load_settings_file()["appSettings"]
    is_admin = bool(current_username())

    if not app_settings["draw"]["publicDrawEnabled"] and not is_admin:
        return jsonify({"ok": False, "error": "Draws are currently paused by the organiser."}), 403
    if app_settings["draw"]["requireAuthForDraw"] and not is_admin:
        return jsonify({"ok": False, "error": "Sign in as an organiser to run the draw."}), 401
    # NEW: the countdown can hold the draw until it reaches zero. Enforced here
    # as well as on the board, so a second tab cannot jump the gun.
    if countdown_locks_draw(app_settings["countdown"]) and not is_admin:
        return (
            jsonify({"ok": False, "reason": "countdown", "error": "The draw opens when the countdown ends."}),
            423,
        )

    result = draw.draw_winner(app_settings)
    if not result["ok"]:
        return jsonify(result), 409

    # NEW: every following screen reveals the same winner. The board that
    # asked names itself, so it does not act on its own news twice.
    winner = public_winner(result["winner"], schema.public_field_keys(app_settings["display"]))
    live.append_event("draw", {"winner": winner, "stats": result["stats"]}, board_origin())
    return jsonify({**result, "winner": winner})


@api.post("/draw/reset")
def post_board_reset():
    """Clearing the draw from the board itself.

    Refused unless the organiser allowed it in the settings, or is signed in on
    this browser — otherwise any viewer could wipe the results mid-event.
    """
    app_settings = load_settings_file()["appSettings"]
    if not app_settings["draw"]["allowResetFromBoard"] and not current_username():
        return jsonify({"ok": False, "error": "Sign in as an organiser to start a new draw."}), 403

    result = draw.reset_draw(app_settings)
    live.append_event("reset", {"scope": ["results"]}, board_origin())
    return jsonify(result)


# -------------------------------------------------------------------- auth


@api.get("/auth/session")
def get_session():
    credential = ensure_admin_credentials()["settingsFile"].get("adminAuth") or {}
    username = current_username()
    return jsonify(
        {
            "ok": True,
            "authenticated": bool(username),
            "username": username,
            "usingDefaultPassword": bool(credential.get("isDefaultPassword")),
            "credentialSource": credential.get("source", "file"),
        }
    )


@api.post("/auth/login")
def post_login():
    client_key = request.remote_addr or "unknown"
    if throttle.is_locked_out(client_key):
        return jsonify({"ok": False, "error": "Too many failed attempts. Try again in 15 minutes."}), 429

    payload = body()
    username = str(payload.get("username") or "").strip()
    password = str(payload.get("password") or "")
    credential = ensure_admin_credentials()["settingsFile"].get("adminAuth") or {}

    if username.lower() != str(credential.get("username", "")).lower() or not verify_password(password, credential):
        throttle.register_failure(client_key)
        return jsonify({"ok": False, "error": "Incorrect username or password."}), 401

    throttle.clear(client_key)
    session.permanent = True
    session[SESSION_KEY] = credential["username"]

    return jsonify(
        {"ok": True, "username": credential["username"], "usingDefaultPassword": bool(credential.get("isDefaultPassword"))}
    )


@api.post("/auth/logout")
def post_logout():
    session.pop(SESSION_KEY, None)
    return jsonify({"ok": True})


# ------------------------------------------------------------------- admin


@api.get("/admin/overview")
@require_auth
def get_overview():
    settings_file = load_settings_file()
    app_settings = settings_file["appSettings"]
    credential = active_admin_credential(settings_file)
    source = draw.read_tickets(app_settings)
    state = draw.load_draw_state()

    return jsonify(
        {
            "ok": True,
            "appSettings": app_settings,
            "account": {
                "username": credential.get("username", "admin"),
                "usingDefaultPassword": bool(credential.get("isDefaultPassword")),
                "credentialSource": credential.get("source", "file"),
            },
            "data": {
                "rawCount": source["rawCount"],
                "ticketCount": len(source["tickets"]),
                "issues": source["issues"],
                "sample": source["tickets"][:8],
            },
            "limits": {"storage": "filesystem", "maxUploadBytes": images.MAX_BYTES},
            "stats": draw.stats_for(app_settings, source["tickets"], state),
            "winners": state["winners"],
            # NEW: winners struck off as not present, and the record of the list
            # the draw ran against.
            "absent": state["absent"],
            "poolFingerprint": state["poolFingerprint"],
            "poolSize": state["poolSize"],
            "startedAt": state["startedAt"],
            "updatedAt": state["updatedAt"],
        }
    )


@api.put("/admin/settings")
@require_auth
def put_settings():
    payload = body()
    settings_file = load_settings_file()
    incoming = payload.get("appSettings") or payload or {}
    merged = normalize_app_settings(merge_settings(settings_file["appSettings"], incoming))
    # NEW: the remote's pairing is only ever changed by its own endpoints. A
    # save from a console tab opened before a new pairing would otherwise bring
    # the old key back to life and kill the new link.
    stored = settings_file["appSettings"]["remote"]
    app_settings = normalize_app_settings(
        {
            **merged,
            "remote": {
                **merged["remote"],
                "key": stored["key"],
                "keyCreatedAt": stored["keyCreatedAt"],
                "keyExpiresAt": stored["keyExpiresAt"],
            },
        }
    )
    save_settings_file({**settings_file, "appSettings": app_settings})
    return jsonify({"ok": True, "appSettings": app_settings})


@api.post("/admin/password")
@require_auth
def post_password():
    payload = body()
    new_password = str(payload.get("newPassword") or "")
    current_password = str(payload.get("currentPassword") or "")
    requested_username = str(payload.get("username") or "").strip()

    if len(new_password) < MIN_PASSWORD_LENGTH:
        return jsonify({"ok": False, "error": f"Choose a password of at least {MIN_PASSWORD_LENGTH} characters."}), 400

    settings_file = load_settings_file()
    # FIX: the stored record alone never carries an environment credential, so
    # the refusal below could not fire.
    credential = active_admin_credential(settings_file)

    if credential.get("source") == "environment":
        return (
            jsonify(
                {
                    "ok": False,
                    "error": "Credentials are pinned by ADMIN_USERNAME / ADMIN_PASSWORD. "
                    "Change them in the deployment environment.",
                }
            ),
            409,
        )

    if not verify_password(current_password, credential):
        return jsonify({"ok": False, "error": "Current password is incorrect."}), 401

    next_username = requested_username or credential["username"]
    updated = hash_password(new_password)
    updated.update(
        {
            "username": next_username,
            "source": "file",
            "isDefaultPassword": False,
            "updatedAt": datetime.now(timezone.utc).isoformat(),
        }
    )
    save_settings_file({**settings_file, "adminAuth": updated})
    session[SESSION_KEY] = next_username

    return jsonify({"ok": True, "username": next_username})


@api.get("/build")
def build_id():
    """NEW: the smallest possible answer to "is what I am running current?".

    Polled by pages that stay open for hours, so it touches no storage.
    """
    return jsonify({"ok": True, "build": BUILD}), 200, {"Cache-Control": "no-store"}


@api.post("/admin/tickets/sheet")
@require_auth
def fetch_sheet():
    """Pull a Google Sheet down as CSV.

    Nothing is committed here — the sheet goes through the same preview and
    import the organiser gets from a file, so a linked sheet and an uploaded
    file behave identically.
    """
    try:
        result = sheets.fetch_sheet_csv(body().get("url"))
    except sheets.SheetError as error:
        return jsonify({"ok": False, "error": str(error)}), error.status

    return jsonify({"ok": True, "format": "csv", "content": result["content"], "url": result["url"]})


@api.post("/admin/tickets/preview")
@require_auth
def preview_tickets():
    """Preview an upload without committing it, so the organiser can confirm
    the detected columns and identifier first."""
    app_settings = load_settings_file()["appSettings"]
    payload = body()

    try:
        parsed = ticket_store.parse_upload(payload.get("content"), payload.get("format"), app_settings["data"])
    except (ValueError, TypeError) as error:
        return jsonify({"ok": False, "error": str(error)}), 400

    proposed = parsed["schema"]
    records, issues = ticket_store.normalize_records(
        parsed["records"], proposed, app_settings["data"]["duplicatePolicy"]
    )

    return jsonify(
        {
            "ok": True,
            "format": parsed["format"],
            "columns": parsed["columns"],
            "schema": proposed,
            "issues": issues,
            "count": len(records),
            "sample": records[:5],
        }
    )


@api.post("/admin/tickets")
@require_auth
def post_tickets():
    payload = body()
    mode = "append" if payload.get("mode") == "append" else "replace"
    state = draw.load_draw_state()

    if mode == "replace" and state["winners"] and not payload.get("force"):
        return (
            jsonify(
                {
                    "ok": False,
                    "reason": "draw-in-progress",
                    "error": f"{len(state['winners'])} winner(s) have already been drawn. "
                    "Reset the draw first, or confirm to replace anyway.",
                }
            ),
            409,
        )

    settings_file = load_settings_file()
    app_settings = settings_file["appSettings"]

    try:
        parsed = ticket_store.parse_upload(payload.get("content"), payload.get("format"), app_settings["data"])
    except (ValueError, TypeError) as error:
        return jsonify({"ok": False, "error": str(error)}), 400

    # Appending keeps the configured schema; replacing may adopt the one the
    # file implies, optionally overridden by the identifier the user picked.
    adopt = mode == "replace" and payload.get("adoptSchema") is not False
    base_schema = parsed["schema"] if adopt else app_settings["data"]
    next_schema = {
        **base_schema,
        "identifier": schema.pick_identifier(
            base_schema["fields"], payload.get("identifier") or base_schema["identifier"]
        ),
    }

    policy = app_settings["data"]["duplicatePolicy"]
    incoming, issues = ticket_store.normalize_records(parsed["records"], next_schema, policy)
    if not incoming:
        return jsonify({"ok": False, "error": "No usable records were found in that file."}), 400

    existing = draw.read_tickets(app_settings)["tickets"] if mode == "append" else []
    merged, _merge_issues = ticket_store.normalize_records([*existing, *incoming], next_schema, policy)
    ticket_store.save_tickets(merged)
    live.append_event("data", {"ticketCount": len(merged)})

    # A list pulled from a sheet remembers where from, so it can be pulled
    # again without pasting the link twice. A file upload clears it: the list
    # on screen no longer came from the sheet.
    source_url = payload.get("sourceUrl") if isinstance(payload.get("sourceUrl"), str) else ""

    next_settings = normalize_app_settings(
        {
            **app_settings,
            "data": {
                **next_schema,
                "duplicatePolicy": policy,
                "sourceUrl": source_url,
                "sourceSyncedAt": datetime.now(timezone.utc).isoformat() if source_url else "",
            },
            # Display slots are rebuilt only when the columns actually changed.
            "display": {} if (adopt and payload.get("resetDisplay") is not False) else app_settings["display"],
        }
    )
    save_settings_file({**settings_file, "appSettings": next_settings})

    return jsonify(
        {
            "ok": True,
            "mode": mode,
            "format": parsed["format"],
            "imported": len(incoming),
            "ticketCount": len(merged),
            "issues": issues,
            "appSettings": next_settings,
            "stats": draw.stats_for(next_settings, merged, draw.load_draw_state()),
        }
    )


@api.delete("/admin/tickets")
@require_auth
def clear_tickets():
    state = draw.load_draw_state()
    payload = body()

    if state["winners"] and not payload.get("force"):
        return (
            jsonify(
                {
                    "ok": False,
                    "reason": "draw-in-progress",
                    "error": f"{len(state['winners'])} winner(s) have already been drawn. "
                    "Reset the draw first, or confirm to delete anyway.",
                }
            ),
            409,
        )

    ticket_store.save_tickets([])
    live.append_event("data", {"ticketCount": 0})
    app_settings = load_settings_file()["appSettings"]
    return jsonify({"ok": True, "ticketCount": 0, "stats": draw.stats_for(app_settings, [], state)})


@api.get("/admin/export/template.csv")
@require_auth
def export_template():
    """A starting file whose columns match this event's own fields, so an
    import lands without any renaming."""
    app_settings = load_settings_file()["appSettings"]
    fields = app_settings["data"]["fields"]
    identifier = app_settings["data"]["identifier"]
    columns = [(f["key"], f["label"]) for f in fields]

    def example(index: int) -> Dict[str, Any]:
        row = {}
        for field in fields:
            if field["key"] == identifier:
                row[field["key"]] = f"ENTRY-{index:03d}"
            else:
                row[field["key"]] = f"Example {field['label'].lower()} {index}"
        return row

    csv_text = ticket_store.to_csv([example(1), example(2)], columns)
    return Response(
        csv_text,
        mimetype="text/csv; charset=utf-8",
        headers={"Content-Disposition": 'attachment; filename="pickora-template.csv"'},
    )


@api.get("/admin/export/tickets.csv")
@require_auth
def export_entries():
    app_settings = load_settings_file()["appSettings"]
    columns = [(f["key"], f["label"]) for f in app_settings["data"]["fields"]]
    csv_text = ticket_store.to_csv(draw.read_tickets(app_settings)["tickets"], columns)
    return Response(
        csv_text,
        mimetype="text/csv; charset=utf-8",
        headers={"Content-Disposition": 'attachment; filename="entries.csv"'},
    )


# ------------------------------------------------------------------ assets


@api.post("/admin/assets/<kind>")
@require_auth
def upload_asset(kind: str):
    if kind not in ASSET_KINDS:
        return jsonify({"ok": False, "error": "Unknown asset."}), 400

    payload = body()
    try:
        asset = images.save_image_asset(kind, payload.get("content"), payload.get("name"))
    except ValueError as error:
        return jsonify({"ok": False, "error": str(error)}), 400

    settings_file = load_settings_file()
    branding = settings_file["appSettings"]["branding"]
    previous = branding[kind]["src"]

    app_settings = normalize_app_settings(
        {
            **settings_file["appSettings"],
            "branding": {
                **branding,
                kind: {**branding[kind], "src": asset["src"], "width": asset["width"], "height": asset["height"]},
            },
        }
    )
    save_settings_file({**settings_file, "appSettings": app_settings})

    if previous and previous != asset["src"]:
        remove_if_unused(previous, app_settings)

    return jsonify({"ok": True, "asset": asset, "appSettings": app_settings})


@api.delete("/admin/assets/<kind>")
@require_auth
def delete_asset(kind: str):
    if kind not in ASSET_KINDS:
        return jsonify({"ok": False, "error": "Unknown asset."}), 400

    settings_file = load_settings_file()
    branding = settings_file["appSettings"]["branding"]
    previous = branding[kind]["src"]

    app_settings = normalize_app_settings(
        {
            **settings_file["appSettings"],
            "branding": {**branding, kind: {**branding[kind], "src": "", "width": None, "height": None}},
        }
    )
    save_settings_file({**settings_file, "appSettings": app_settings})
    remove_if_unused(previous, app_settings)

    return jsonify({"ok": True, "appSettings": app_settings})


# --------------------------------------------------- guest welcome images


@api.post("/admin/welcome/images")
@require_auth
def add_welcome_image():
    settings_file = load_settings_file()
    welcome = settings_file["appSettings"]["welcome"]

    if len(welcome["images"]) >= MAX_WELCOME_IMAGES:
        return jsonify({"ok": False, "error": f"The carousel holds at most {MAX_WELCOME_IMAGES} photos."}), 409

    payload = body()
    try:
        asset = images.save_image_asset("guest", payload.get("content"), payload.get("name"))
    except ValueError as error:
        return jsonify({"ok": False, "error": str(error)}), 400

    # Files are named by content hash, so the same photo uploaded twice would
    # land on one src and behave oddly when removed.
    if any(image["src"] == asset["src"] for image in welcome["images"]):
        return jsonify({"ok": False, "error": "That photo is already in the carousel."}), 409

    entry = {
        "src": asset["src"],
        "caption": str(payload.get("caption") or "").strip(),
        "width": asset["width"],
        "height": asset["height"],
    }
    app_settings = normalize_app_settings(
        {**settings_file["appSettings"], "welcome": {**welcome, "images": [*welcome["images"], entry]}}
    )
    save_settings_file({**settings_file, "appSettings": app_settings})

    return jsonify({"ok": True, "asset": asset, "appSettings": app_settings})


@api.delete("/admin/welcome/images")
@require_auth
def delete_welcome_image():
    src = str(body().get("src") or "")
    settings_file = load_settings_file()
    welcome = settings_file["appSettings"]["welcome"]
    remaining = [image for image in welcome["images"] if image["src"] != src]

    if len(remaining) == len(welcome["images"]):
        return jsonify({"ok": False, "error": "That photo is not in the carousel."}), 404

    app_settings = normalize_app_settings(
        {**settings_file["appSettings"], "welcome": {**welcome, "images": remaining}}
    )
    save_settings_file({**settings_file, "appSettings": app_settings})

    # Only delete the file once nothing else references it — a prize, or a
    # saved template.
    remove_if_unused(src, app_settings)

    return jsonify({"ok": True, "appSettings": app_settings})


# ------------------------------------------------------------ prize images


@api.post("/admin/prizes/<prize_id>/images")
@require_auth
def add_prize_image(prize_id: str):
    settings_file = load_settings_file()
    prizes = settings_file["appSettings"]["prizes"]
    index = next((i for i, item in enumerate(prizes["items"]) if item["id"] == prize_id), -1)

    if index == -1:
        return jsonify({"ok": False, "error": "That prize no longer exists."}), 404
    if len(prizes["items"][index]["images"]) >= MAX_PRIZE_IMAGES:
        return jsonify({"ok": False, "error": f"A prize holds at most {MAX_PRIZE_IMAGES} photos."}), 409

    payload = body()
    try:
        asset = images.save_image_asset("prize", payload.get("content"), payload.get("name"))
    except ValueError as error:
        return jsonify({"ok": False, "error": str(error)}), 400

    if any(image["src"] == asset["src"] for image in prizes["items"][index]["images"]):
        return jsonify({"ok": False, "error": "That photo is already on this prize."}), 409

    entry = {
        "src": asset["src"],
        "caption": str(payload.get("caption") or "").strip(),
        "width": asset["width"],
        "height": asset["height"],
    }
    items = [
        {**item, "images": [*item["images"], entry]} if position == index else item
        for position, item in enumerate(prizes["items"])
    ]

    app_settings = normalize_app_settings(
        {**settings_file["appSettings"], "prizes": {**prizes, "items": items}}
    )
    save_settings_file({**settings_file, "appSettings": app_settings})
    return jsonify({"ok": True, "asset": asset, "appSettings": app_settings})


@api.delete("/admin/prizes/<prize_id>/images")
@require_auth
def delete_prize_image(prize_id: str):
    src = str(body().get("src") or "")
    settings_file = load_settings_file()
    prizes = settings_file["appSettings"]["prizes"]

    items = [
        {**item, "images": [i for i in item["images"] if i["src"] != src]} if item["id"] == prize_id else item
        for item in prizes["items"]
    ]

    app_settings = normalize_app_settings(
        {**settings_file["appSettings"], "prizes": {**prizes, "items": items}}
    )
    save_settings_file({**settings_file, "appSettings": app_settings})

    # Kept while any other prize, the welcome carousel or a saved template
    # still shows it.
    remove_if_unused(src, app_settings)

    return jsonify({"ok": True, "appSettings": app_settings})


# -------------------------------------------------------------- draw admin


@api.post("/admin/draw/undo")
@require_auth
def post_undo():
    app_settings = load_settings_file()["appSettings"]
    result = draw.undo_last_winner(app_settings)
    if result["ok"]:
        live.append_event("undo", {"drawIndex": result["removed"].get("drawIndex")})
    return jsonify(result), (200 if result["ok"] else 409)


@api.post("/admin/draw/reset")
@require_auth
def post_reset():
    app_settings = load_settings_file()["appSettings"]
    result = draw.reset_draw(app_settings)
    live.append_event("reset", {"scope": ["results"]})
    return jsonify(result)


@api.get("/admin/export/winners.csv")
@require_auth
def export_winners():
    app_settings = load_settings_file()["appSettings"]
    state = draw.load_draw_state()
    with_absent = app_settings["redraw"]["includeInExport"] and bool(state["absent"])
    entries = (
        sorted([*state["winners"], *state["absent"]], key=lambda entry: js_number(entry.get("drawIndex")))
        if with_absent
        else state["winners"]
    )

    # NEW: the sponsor of each prize, when sponsors are on and the organiser
    # wants them in the export.
    sponsors = app_settings["sponsors"]
    with_sponsor = sponsors["enabled"] and sponsors["display"]["export"]
    prize_items = app_settings["prizes"]["items"]

    def sponsor_of(prize_number: Any) -> str:
        position = js_number(prize_number) - 1
        if not (position == position and position.is_integer() and 0 <= position < len(prize_items)):
            return ""
        sponsor = stage.sponsor_for_prize(sponsors, prize_items[int(position)]["id"])
        return sponsor["name"] if sponsor else ""

    rows = [
        {
            **(entry.get("record") or {}),
            "prizeNumber": entry.get("prizeNumber"),
            "drawnAt": entry.get("drawnAt"),
            "status": app_settings["copy"]["notPresentTag"] if entry.get("absentAt") else "Winner",
            "absentAt": entry.get("absentAt") or "",
            "sponsor": sponsor_of(entry.get("prizeNumber")),
        }
        for entry in entries
    ]
    columns = export_columns(app_settings, with_absent)
    csv_text = ticket_store.to_csv(rows, [*columns, ("sponsor", "Sponsor")] if with_sponsor else columns)
    return Response(
        csv_text,
        mimetype="text/csv; charset=utf-8",
        headers={"Content-Disposition": 'attachment; filename="winners.csv"'},
    )


# NEW: redraw, sound tracks, the certificate and templates.
register_feature_routes(api, require_auth, current_username, public_winner)
# NEW: live sync, the phone remote, sponsor logos and "Reset event".
register_stage_routes(api, require_auth, current_username, public_winner, throttle)

"""HTTP API shared by the public board and the organiser console."""

from datetime import datetime, timezone
from functools import wraps
from typing import Any, Callable, Dict, List, Optional, Sequence, Tuple

from flask import Blueprint, Response, jsonify, request, session

from . import draw, images, schema, tickets as ticket_store
from .auth import LoginThrottle, hash_password, verify_password
from .settings import (
    MAX_WELCOME_IMAGES,
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
        "drawnAt": winner.get("drawnAt"),
        "record": schema.project_record(winner.get("record") or {}, allowed_keys),
    }


def export_columns(app_settings: Dict[str, Any]) -> List[Tuple[str, str]]:
    return [
        ("prizeNumber", "Prize #"),
        *[(f["key"], f["label"]) for f in app_settings["data"]["fields"] if f["includeInExport"]],
        ("drawnAt", "Drawn At"),
    ]


def body() -> Dict[str, Any]:
    payload = request.get_json(silent=True)
    return payload if isinstance(payload, dict) else {}


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
    exposed = {
        **{key: value for key, value in app_settings.items() if key != "data"},
        "data": {
            "identifier": data["identifier"],
            "fields": [
                {"key": f["key"], "label": f["label"]} for f in data["fields"] if f["key"] in public_keys
            ],
        },
    }

    return jsonify({"ok": True, "appSettings": exposed, "session": {"authenticated": bool(current_username())}})


@api.get("/pool")
def get_pool():
    app_settings = load_settings_file()["appSettings"]
    source = draw.read_tickets(app_settings)
    state = draw.load_draw_state()
    # The reel animates over live records, so only reel fields are sent.
    reel_keys = list(dict.fromkeys(line["field"] for line in app_settings["display"]["reel"]["lines"]))

    pool = draw.remaining_pool(source["tickets"], state["winners"], app_settings["data"]["identifier"])
    return jsonify(
        {
            "ok": True,
            "pool": [schema.project_record(ticket, reel_keys) for ticket in pool],
            "stats": draw.build_stats(app_settings, source["tickets"], state["winners"]),
        }
    )


@api.get("/state")
def get_state():
    app_settings = load_settings_file()["appSettings"]
    source = draw.read_tickets(app_settings)
    state = draw.load_draw_state()
    allowed = schema.public_field_keys(app_settings["display"])

    return jsonify(
        {
            "ok": True,
            "winners": [public_winner(winner, allowed) for winner in state["winners"]],
            "stats": draw.build_stats(app_settings, source["tickets"], state["winners"]),
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

    result = draw.draw_winner(app_settings)
    if not result["ok"]:
        return jsonify(result), 409

    allowed = schema.public_field_keys(app_settings["display"])
    return jsonify({**result, "winner": public_winner(result["winner"], allowed)})


@api.post("/draw/reset")
def post_board_reset():
    """Clearing the draw from the board itself.

    Refused unless the organiser allowed it in the settings, or is signed in on
    this browser — otherwise any viewer could wipe the results mid-event.
    """
    app_settings = load_settings_file()["appSettings"]
    if not app_settings["draw"]["allowResetFromBoard"] and not current_username():
        return jsonify({"ok": False, "error": "Sign in as an organiser to start a new draw."}), 403

    return jsonify(draw.reset_draw(app_settings))


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
    credential = settings_file.get("adminAuth") or {}
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
            "stats": draw.build_stats(app_settings, source["tickets"], state["winners"]),
            "winners": state["winners"],
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
    # Merged over what is stored, so a partial payload cannot silently drop the
    # field schema or the display slots.
    app_settings = normalize_app_settings({**settings_file["appSettings"], **incoming})
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
    credential = settings_file.get("adminAuth") or {}

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

    next_settings = normalize_app_settings(
        {
            **app_settings,
            "data": {**next_schema, "duplicatePolicy": policy},
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
            "stats": draw.build_stats(next_settings, merged, draw.load_draw_state()["winners"]),
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
    app_settings = load_settings_file()["appSettings"]
    return jsonify({"ok": True, "ticketCount": 0, "stats": draw.build_stats(app_settings, [], state["winners"])})


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
        images.remove_image_asset(previous)

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
    images.remove_image_asset(previous)

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

    # Only delete the file once nothing else references it.
    if not any(image["src"] == src for image in remaining):
        images.remove_image_asset(src)

    return jsonify({"ok": True, "appSettings": app_settings})


# -------------------------------------------------------------- draw admin


@api.post("/admin/draw/undo")
@require_auth
def post_undo():
    app_settings = load_settings_file()["appSettings"]
    result = draw.undo_last_winner(app_settings)
    return jsonify(result), (200 if result["ok"] else 409)


@api.post("/admin/draw/reset")
@require_auth
def post_reset():
    app_settings = load_settings_file()["appSettings"]
    return jsonify(draw.reset_draw(app_settings))


@api.get("/admin/export/winners.csv")
@require_auth
def export_winners():
    app_settings = load_settings_file()["appSettings"]
    rows = [
        {"prizeNumber": w.get("prizeNumber"), "drawnAt": w.get("drawnAt"), **(w.get("record") or {})}
        for w in draw.load_draw_state()["winners"]
    ]
    csv_text = ticket_store.to_csv(rows, export_columns(app_settings))
    return Response(
        csv_text,
        mimetype="text/csv; charset=utf-8",
        headers={"Content-Disposition": 'attachment; filename="winners.csv"'},
    )

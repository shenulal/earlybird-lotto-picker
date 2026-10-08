"""Endpoints for the event features: the "winner not present" redraw, uploaded
sound tracks, the draw certificate and event templates.

Registered on the same blueprint as everything else by
:func:`register_feature_routes`, which is handed the sign-in helpers rather
than importing them, so this module and ``routes.py`` do not import each other.
Mirrors ``server/feature-routes.js``.
"""

import hashlib
import json
import re
from typing import Any, Callable, Dict, Sequence

from flask import Blueprint, Response, jsonify, request

from . import audio, draw, live, schema, templates
from .coerce import js_now_iso, js_number, js_truthy
from .features import MAX_TRACKS, TRACK_ID
from .settings import load_settings_file, normalize_app_settings, save_settings_file
from .templates import TemplateError

_EXTENSION = re.compile(r"\.[a-z0-9]{2,5}$", re.I)
_SLUG_UNSAFE = re.compile(r"[^a-z0-9]+")


def _payload() -> Dict[str, Any]:
    payload = request.get_json(silent=True)
    return payload if isinstance(payload, dict) else {}


def public_draw(
    app_settings: Dict[str, Any], state: Dict[str, Any], public_winner: Callable[..., Dict[str, Any]]
) -> Dict[str, Any]:
    """The winners and absentees as the board may see them."""
    allowed = schema.public_field_keys(app_settings["display"])
    return {
        "winners": [public_winner(winner, allowed) for winner in state["winners"]],
        "absent": [
            {**public_winner(entry, allowed), "absentAt": entry.get("absentAt")} for entry in state["absent"]
        ]
        if app_settings["redraw"]["showInPanel"]
        else [],
    }


def certificate_reference(prefix: str, started_at: Any, results_hash: str) -> str:
    """A short, stable reference for one certificate: the prefix, the day the
    draw started, and a fragment of the results' own hash — so a reprint of the
    same results carries the same number, and any change to them a different
    one."""
    day = str(started_at or js_now_iso())[:10].replace("-", "")
    return f"{prefix}-{day}-{results_hash[:6].upper()}"


def _join_part(value: Any) -> str:
    # Array.prototype.join writes null and undefined as nothing.
    if value is None:
        return ""
    if isinstance(value, float) and value.is_integer():
        return str(int(value))
    return str(value)


def results_fingerprint(state: Dict[str, Any], identifier: str) -> str:
    """A hash of the results themselves, in draw order."""
    entries = sorted([*state["winners"], *state["absent"]], key=lambda entry: js_number(entry.get("drawIndex")))
    lines = []
    for entry in entries:
        record = entry.get("record") if isinstance(entry.get("record"), dict) else {}
        identity = record.get(identifier)
        lines.append(
            "\u001f".join(
                [
                    _join_part(entry.get("drawIndex")),
                    _join_part(entry.get("prizeNumber")),
                    "" if identity is None else _join_part(identity),
                    _join_part(entry.get("drawnAt")),
                    f"absent:{entry['absentAt']}" if entry.get("absentAt") else "won",
                ]
            )
        )
    return hashlib.sha256("\n".join(lines).encode("utf-8")).hexdigest()


def _template_error(error: TemplateError):
    return jsonify({"ok": False, "error": str(error)}), error.status


def register_feature_routes(
    api: Blueprint,
    require_auth: Callable,
    current_username: Callable[[], Any],
    public_winner: Callable[[Dict[str, Any], Sequence[str]], Dict[str, Any]],
) -> None:
    """Adds the feature endpoints to the API blueprint."""

    @api.errorhandler(TemplateError)
    def handle_template_error(error: TemplateError):
        return _template_error(error)

    # ------------------------------------------------------- redraw: board

    @api.post("/draw/absent")
    def post_board_absent():
        """The board's "Not present" control. Allowed only when the organiser
        has switched the redraw on and offered it on the board — and, unless
        they said otherwise, only to a signed-in browser."""
        app_settings = load_settings_file()["appSettings"]
        redraw = app_settings["redraw"]
        if not redraw["enabled"] or not redraw["showOnBoard"]:
            return jsonify({"ok": False, "error": "The organiser has not enabled redraws from the board."}), 403
        if redraw["requireSignIn"] and not current_username():
            return jsonify({"ok": False, "error": "Sign in as an organiser to mark a winner as not present."}), 401

        # From the board, only the winner on the screen — the latest — can be
        # struck off. Older results are the console's business; otherwise, with
        # sign-in not required, anyone could reopen any prize.
        winners = draw.load_draw_state()["winners"]
        latest = winners[-1] if winners else None
        payload = _payload()
        asked = payload.get("drawIndex")
        if latest and asked is not None and js_number(asked) != js_number(latest.get("drawIndex")):
            return (
                jsonify({"ok": False, "reason": "not-latest", "error": "The results have changed. Reload the board."}),
                409,
            )

        result = draw.mark_absent(app_settings, latest.get("drawIndex") if latest else None)
        if not result["ok"]:
            return jsonify(result), 409

        absent = public_winner(result["absent"], schema.public_field_keys(app_settings["display"]))
        board_id = payload.get("boardId")
        live.append_event(
            "absent",
            {"absent": absent, "autoRedraw": redraw["autoRedraw"], "source": "board"},
            board_id if js_truthy(board_id) else None,
        )
        return jsonify({"ok": True, "absent": absent, "stats": result["stats"]})

    # ------------------------------------------------------- redraw: admin

    @api.post("/admin/draw/absent")
    @require_auth
    def post_admin_absent():
        app_settings = load_settings_file()["appSettings"]
        result = draw.mark_absent(app_settings, _payload().get("drawIndex"))
        if not result["ok"]:
            return jsonify(result), 409
        live.append_event(
            "absent",
            {
                "absent": public_winner(result["absent"], schema.public_field_keys(app_settings["display"])),
                "autoRedraw": False,
                "source": "console",
            },
        )
        return jsonify(result)

    @api.post("/admin/draw/restore")
    @require_auth
    def post_admin_restore():
        app_settings = load_settings_file()["appSettings"]
        result = draw.restore_absent(app_settings, _payload().get("drawIndex"))
        if not result["ok"]:
            return jsonify(result), 409
        live.append_event("restore", {"drawIndex": result["restored"].get("drawIndex")})
        return jsonify(result)

    # -------------------------------------------------------- sound tracks

    @api.post("/admin/sound/tracks")
    @require_auth
    def add_sound_track():
        settings_file = load_settings_file()
        sound = settings_file["appSettings"]["sound"]
        if len(sound["library"]) >= MAX_TRACKS:
            return (
                jsonify(
                    {
                        "ok": False,
                        "error": f"The sound library holds at most {MAX_TRACKS} tracks. Remove one to make room.",
                    }
                ),
                409,
            )

        payload = _payload()
        try:
            asset = audio.save_audio_asset(payload.get("content"), payload.get("name"))
        except ValueError as error:
            return jsonify({"ok": False, "error": str(error)}), 400

        if any(track["src"] == asset["src"] for track in sound["library"]):
            return jsonify({"ok": False, "error": "That file is already in the sound library."}), 409

        name = _EXTENSION.sub("", str(payload.get("name") or ""), count=1).strip() or "Untitled track"
        track = {
            "id": templates.new_track_id(),
            "name": name,
            "src": asset["src"],
            "format": asset["format"],
            "bytes": asset["bytes"],
        }

        app_settings = normalize_app_settings(
            {**settings_file["appSettings"], "sound": {**sound, "library": [*sound["library"], track]}}
        )
        save_settings_file({**settings_file, "appSettings": app_settings})
        return jsonify({"ok": True, "track": track, "appSettings": app_settings})

    @api.patch("/admin/sound/tracks/<track_id>")
    @require_auth
    def rename_sound_track(track_id: str):
        missing = jsonify({"ok": False, "error": "That track no longer exists."}), 404
        if not TRACK_ID.fullmatch(track_id):
            return missing
        settings_file = load_settings_file()
        sound = settings_file["appSettings"]["sound"]
        if not any(track["id"] == track_id for track in sound["library"]):
            return missing

        name = str(_payload().get("name") or "").strip()
        if not name:
            return jsonify({"ok": False, "error": "Give the track a name."}), 400

        library = [{**track, "name": name} if track["id"] == track_id else track for track in sound["library"]]
        app_settings = normalize_app_settings({**settings_file["appSettings"], "sound": {**sound, "library": library}})
        save_settings_file({**settings_file, "appSettings": app_settings})
        return jsonify({"ok": True, "appSettings": app_settings})

    @api.delete("/admin/sound/tracks/<track_id>")
    @require_auth
    def delete_sound_track(track_id: str):
        settings_file = load_settings_file()
        sound = settings_file["appSettings"]["sound"]
        track = next((entry for entry in sound["library"] if entry["id"] == track_id), None)
        if track is None:
            return jsonify({"ok": False, "error": "That track no longer exists."}), 404

        # Any cue still pointing at it falls back to its built-in sound when the
        # settings are normalised without it.
        app_settings = normalize_app_settings(
            {
                **settings_file["appSettings"],
                "sound": {**sound, "library": [entry for entry in sound["library"] if entry["id"] != track_id]},
            }
        )
        save_settings_file({**settings_file, "appSettings": app_settings})
        templates.remove_if_unused(track["src"], app_settings)
        return jsonify({"ok": True, "appSettings": app_settings})

    # --------------------------------------------------------- certificate

    @api.get("/admin/certificate")
    @require_auth
    def get_certificate():
        """Everything the certificate page prints, in one answer. The full
        participant records are included because the certificate is the
        organiser's own document — masking, if asked for, is applied when it is
        printed."""
        app_settings = load_settings_file()["appSettings"]
        tickets = draw.read_tickets(app_settings)["tickets"]
        state = draw.load_draw_state()
        results_hash = results_fingerprint(state, app_settings["data"]["identifier"])

        response = jsonify(
            {
                "ok": True,
                "generatedAt": js_now_iso(),
                "reference": certificate_reference(
                    app_settings["certificate"]["referencePrefix"], state["startedAt"], results_hash
                ),
                "resultsFingerprint": results_hash,
                "poolFingerprint": state["poolFingerprint"],
                # Recomputed now, so a list changed after the draw shows as changed.
                "currentPoolFingerprint": draw.pool_fingerprint(tickets) if tickets else None,
                "poolSize": state["poolSize"],
                "startedAt": state["startedAt"],
                "updatedAt": state["updatedAt"],
                "appSettings": {
                    "eventName": app_settings["eventName"],
                    "organizationName": app_settings["organizationName"],
                    "locale": app_settings["locale"],
                    "direction": app_settings["direction"],
                    "totalPrizes": app_settings["totalPrizes"],
                    "branding": app_settings["branding"],
                    "ui": {"primaryColor": app_settings["ui"]["primaryColor"]},
                    "prizes": app_settings["prizes"],
                    "data": app_settings["data"],
                    "certificate": app_settings["certificate"],
                    "sponsors": app_settings["sponsors"],
                    "copy": {
                        "prizeLabel": app_settings["copy"]["prizeLabel"],
                        "notPresentTag": app_settings["copy"]["notPresentTag"],
                    },
                },
                "stats": draw.stats_for(app_settings, tickets, state),
                "winners": state["winners"],
                "absent": state["absent"],
            }
        )
        response.headers["Cache-Control"] = "no-store"
        return response

    # ----------------------------------------------------------- templates

    @api.get("/admin/templates")
    @require_auth
    def list_event_templates():
        return jsonify(
            {
                "ok": True,
                "templates": templates.list_templates(),
                "sections": list(templates.SECTION_NAMES),
                "defaultSections": list(templates.DEFAULT_SECTIONS),
                "maxTemplates": templates.MAX_TEMPLATES,
            }
        )

    @api.post("/admin/templates")
    @require_auth
    def create_event_template():
        app_settings = load_settings_file()["appSettings"]
        payload = _payload()
        template = templates.create_template(
            {"name": payload.get("name"), "description": payload.get("description"), "sections": payload.get("sections")},
            app_settings,
        )
        return jsonify({"ok": True, "template": template})

    @api.post("/admin/templates/import")
    @require_auth
    def import_event_template():
        app_settings = load_settings_file()["appSettings"]
        payload = _payload()
        upload = payload.get("file")
        # Everything that could refuse the template is checked before any
        # embedded file is stored, so a refusal leaves no orphaned files.
        carried = (upload if isinstance(upload, dict) else {}).get("template")
        carried_name = (carried if isinstance(carried, dict) else {}).get("name")
        name = str(payload.get("name") or "").strip() or str(carried_name or "").strip()
        templates.assert_can_create(name)

        imported = templates.import_template(upload)
        template = templates.create_template({**imported["input"], "name": name}, app_settings)
        return jsonify({"ok": True, "template": template, "refused": imported["refused"]})

    @api.put("/admin/templates/<template_id>")
    @require_auth
    def update_event_template(template_id: str):
        app_settings = load_settings_file()["appSettings"]
        template = templates.update_template(template_id, _payload(), app_settings)
        return jsonify({"ok": True, "template": template})

    @api.delete("/admin/templates/<template_id>")
    @require_auth
    def delete_event_template(template_id: str):
        removed = templates.delete_template(template_id)

        # Files only that template held are no longer needed by anything.
        app_settings = load_settings_file()["appSettings"]
        for ref in templates.asset_refs(removed["settings"]):
            templates.remove_if_unused(ref, app_settings)
        return jsonify({"ok": True})

    @api.post("/admin/templates/<template_id>/apply")
    @require_auth
    def apply_event_template(template_id: str):
        settings_file = load_settings_file()
        template = templates.find_template(template_id)
        payload = _payload()
        applied = templates.apply_template(
            template,
            settings_file["appSettings"],
            sections=payload.get("sections"),
            keep_event_name=payload.get("keepEventName") is not False,
        )
        cleaned = templates.without_missing_assets(applied["appSettings"])

        save_settings_file({**settings_file, "appSettings": cleaned["appSettings"]})
        return jsonify(
            {
                "ok": True,
                "appSettings": cleaned["appSettings"],
                "sections": applied["sections"],
                "missing": cleaned["missing"],
                "droppedTracks": applied["droppedTracks"],
            }
        )

    @api.get("/admin/templates/<template_id>/export")
    @require_auth
    def export_event_template(template_id: str):
        """``current`` exports the live configuration, every section, without
        saving it as a template first."""
        app_settings = load_settings_file()["appSettings"]
        if template_id == "current":
            template = {
                "name": app_settings["eventName"],
                "description": f"Exported from {app_settings['eventName']}",
                "sections": list(templates.SECTION_NAMES),
                "settings": templates.pick_sections(app_settings, templates.SECTION_NAMES),
            }
        else:
            template = templates.find_template(template_id)

        exported = templates.export_template(template, embed=request.args.get("embed") == "1")
        slug = _SLUG_UNSAFE.sub("-", str(template["name"]).lower()).strip("-") or "template"
        return Response(
            json.dumps(exported, indent=2, ensure_ascii=False),
            headers={
                "Content-Type": "application/json; charset=utf-8",
                "Content-Disposition": f'attachment; filename="pickora-{slug}.json"',
                "Cache-Control": "no-store",
            },
        )

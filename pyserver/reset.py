""""Reset event": clears the parts of an event the organiser chose, in one
step, so the same deployment is ready for the next event.

What is cleared is decided by the scope the organiser ticked; nothing is
cleared that was not asked for. The organiser's sign-in is never touched, and
saved templates only when explicitly chosen. Uploaded files are deleted only
once nothing — the event or a remaining template — still uses them. Mirrors
``server/reset.js``.
"""

from typing import Any, Callable, Dict, List

from . import draw, live, templates, tickets as ticket_store
from .paths import TEMPLATES_PATH
from .settings import normalize_app_settings
from .store import write_json

# The parts that can be cleared, in the order they are reported.
SCOPES = (
    "results",
    "entries",
    "prizes",
    "welcome",
    "sponsors",
    "channels",
    "uploads",
    "sounds",
    "settings",
    "templates",
)


def as_scope(raw: Any) -> List[str]:
    source = raw if isinstance(raw, dict) else {}
    return [name for name in SCOPES if source.get(name) is True]


def _without_uploads(app_settings: Dict[str, Any], scope: List[str]) -> Dict[str, Any]:
    """The settings with every uploaded image dropped, when "uploads" is chosen."""
    if "uploads" not in scope:
        return app_settings
    branding = app_settings["branding"]
    return {
        **app_settings,
        "branding": {
            "logo": {**branding["logo"], "src": None, "width": None, "height": None},
            "background": {**branding["background"], "src": None, "width": None, "height": None},
        },
        "welcome": {**app_settings["welcome"], "images": []},
        "prizes": {
            **app_settings["prizes"],
            "items": [{**item, "images": []} for item in app_settings["prizes"]["items"]],
        },
        "sponsors": {
            **app_settings["sponsors"],
            "items": [
                {**sponsor, "logo": {"src": "", "width": None, "height": None}}
                for sponsor in app_settings["sponsors"]["items"]
            ],
        },
    }


def cleared_settings(app_settings: Dict[str, Any], scope: List[str]) -> Dict[str, Any]:
    """The settings with the chosen parts set back to their defaults.

    "settings" returns everything to the built-in defaults, keeping only the
    shape of the entry list (unless entries are cleared too, when that goes as
    well) and the organiser's sign-in, which does not live in the settings.
    """
    defaults = normalize_app_settings({})

    def has(name: str) -> bool:
        return name in scope

    if has("settings"):
        kept = _without_uploads(app_settings, scope)
        return normalize_app_settings(
            {
                **defaults,
                # The entry list's columns survive unless the entries go too.
                "data": defaults["data"]
                if has("entries")
                else {**app_settings["data"], "sourceUrl": "", "sourceSyncedAt": ""},
                "display": defaults["display"] if has("entries") else app_settings["display"],
                # Kept, unless their own boxes were ticked: a settings reset is
                # about how the board behaves, not the content an organiser built.
                "prizes": defaults["prizes"] if has("prizes") else kept["prizes"],
                "welcome": defaults["welcome"] if has("welcome") else kept["welcome"],
                "sponsors": defaults["sponsors"] if has("sponsors") else kept["sponsors"],
                "social": defaults["social"] if has("channels") else app_settings["social"],
                "sound": defaults["sound"]
                if has("sounds")
                else {**defaults["sound"], "library": app_settings["sound"]["library"]},
                # Artwork is content too: it goes with "uploads", not with the settings.
                "branding": defaults["branding"] if has("uploads") else app_settings["branding"],
            }
        )

    following = _without_uploads(app_settings, scope)
    return normalize_app_settings(
        {
            **following,
            "data": {**following["data"], "sourceUrl": "", "sourceSyncedAt": ""}
            if has("entries")
            else following["data"],
            "prizes": defaults["prizes"] if has("prizes") else following["prizes"],
            "welcome": defaults["welcome"] if has("welcome") else following["welcome"],
            "sponsors": defaults["sponsors"] if has("sponsors") else following["sponsors"],
            "social": defaults["social"] if has("channels") else following["social"],
            "sound": {**following["sound"], "library": []} if has("sounds") else following["sound"],
        }
    )


def reset_event(
    raw_scope: Any, app_settings: Dict[str, Any], save_settings: Callable[[Dict[str, Any]], None]
) -> Dict[str, Any]:
    """Clears the chosen parts. Returns what was done, for the console to
    report. ``save_settings`` persists the new settings."""
    scope = as_scope(raw_scope)
    if not scope:
        return {"ok": False, "reason": "empty-scope", "message": "Choose at least one thing to clear."}

    before = templates.asset_refs(app_settings)
    done: List[str] = []

    if "results" in scope:
        draw.reset_draw(app_settings)
        done.append("results")
    if "entries" in scope:
        ticket_store.save_tickets([])
        done.append("entries")

    following = cleared_settings(app_settings, scope)
    # A new event gets a new pairing: an old phone link must not keep working.
    settings = {**following, "remote": {**following["remote"], "key": "", "keyCreatedAt": "", "keyExpiresAt": ""}}
    save_settings(normalize_app_settings(settings))
    done.extend(name for name in scope if name not in ("results", "entries", "templates"))

    if "templates" in scope:
        write_json(TEMPLATES_PATH, {"templates": []})
        done.append("templates")

    live.clear_remote()
    live.append_event("reset", {"scope": scope})

    # Files nothing points at any more — not the event, not a template left.
    after = templates.asset_refs(settings)
    released = [ref for ref in before if ref not in after]
    removed = [ref for ref in released if templates.remove_if_unused(ref, settings)]

    return {"ok": True, "cleared": done, "filesRemoved": len(removed), "appSettings": normalize_app_settings(settings)}

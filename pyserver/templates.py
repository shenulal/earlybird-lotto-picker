"""Event templates: a saved configuration an organiser can start the next
event from, carry to another deployment as a file, or reuse in part.

A template holds whole settings sections — branding, prizes, sound and so on —
so applying one replaces exactly the sections chosen and nothing else.
Everything going in is normalised with the same rules as the console, so a
template can never carry a value the board would not accept. Mirrors
``server/templates.js``; templates live in ``templates.json`` beside the other
data files.
"""

import base64
import hashlib
import re
import secrets
import time
from typing import Any, Dict, List, Optional, Sequence, Tuple

from . import audio, images
from .coerce import as_id, as_object, as_optional_text, as_text, js_base36, js_date_parse, js_now_iso, js_number, js_truthy
from .features import MAX_TRACKS
from .paths import ROOT_DIR, TEMPLATE_PRESETS_PATH, TEMPLATES_PATH
from .settings import normalize_app_settings
from .store import StorageError, read_json, write_json

TEMPLATE_FORMAT = "pickora-template"
TEMPLATE_VERSION = 1
MAX_TEMPLATES = 50
TEMPLATE_ID = re.compile(r"^(tpl|builtin)-[a-z0-9-]{1,40}$")

# Which settings keys each section a template can carry is made of.
SECTIONS: Dict[str, Tuple[str, ...]] = {
    "event": ("eventName", "organizationName", "totalPrizes", "locale", "direction"),
    # Uploaded artwork travels on its own, so a style can be applied without
    # replacing the logo and backdrop an organiser has already put in place.
    "branding": ("branding",),
    "look": ("ui", "text"),
    "wording": ("copy",),
    "prizes": ("prizes",),
    "welcome": ("welcome",),
    "channels": ("social",),
    "animation": ("animation",),
    "draw": ("draw", "redraw"),
    "sound": ("sound",),
    "countdown": ("countdown",),
    "certificate": ("certificate",),
    "fields": ("data", "display"),
}

SECTION_NAMES: Tuple[str, ...] = tuple(SECTIONS.keys())

# What a new template carries unless the organiser picks otherwise: the look
# and feel of the event, but not its name or the shape of its entry list, which
# belong to the event rather than the style.
DEFAULT_SECTIONS: Tuple[str, ...] = tuple(name for name in SECTION_NAMES if name not in ("event", "fields"))


class TemplateError(Exception):
    """A refusal the console can show as it is, with the status to send."""

    def __init__(self, message: str, status: int = 400) -> None:
        super().__init__(message)
        self.status = status


# ------------------------------------------------------------------ helpers


def _as_sections(raw: Any, fallback: Sequence[str]) -> List[str]:
    chosen = raw if isinstance(raw, list) else list(fallback)
    return [name for name in SECTION_NAMES if name in chosen]


def pick_sections(app_settings: Dict[str, Any], sections: Sequence[str]) -> Dict[str, Any]:
    picked: Dict[str, Any] = {}
    for section in sections:
        for key in SECTIONS[section]:
            if key not in app_settings:
                continue
            if key == "data":
                # Where the entry list came from belongs to the event, not the style.
                picked["data"] = {
                    k: v for k, v in app_settings["data"].items() if k not in ("sourceUrl", "sourceSyncedAt")
                }
                continue
            picked[key] = app_settings[key]
    return picked


def _random_suffix(byte_count: int) -> str:
    return secrets.token_hex(byte_count)


def _new_id() -> str:
    return f"tpl-{js_base36(int(time.time() * 1000))}-{_random_suffix(3)}"


def new_track_id() -> str:
    """A fresh id for a sound track, in the form the console and Node use."""
    return f"track-{js_base36(int(time.time() * 1000))}-{_random_suffix(2)}"


def _as_timestamp(value: Any) -> Optional[str]:
    return value[:40] if isinstance(value, str) and js_date_parse(value) is not None else None


def _normalize_template(raw: Any, built_in: bool = False) -> Optional[Dict[str, Any]]:
    """One template, made safe."""
    source = as_object(raw)
    name = as_text(source.get("name"), "", 80)
    if not name:
        return None

    sections = _as_sections(source.get("sections"), DEFAULT_SECTIONS)
    settings = pick_sections(normalize_app_settings(as_object(source.get("settings"))), sections)

    return {
        "id": as_id(source.get("id"), TEMPLATE_ID, _new_id()),
        "name": name,
        "description": as_optional_text(source.get("description"), "", 300),
        "sections": sections,
        "settings": settings,
        "builtIn": built_in,
        "createdAt": _as_timestamp(source.get("createdAt")),
        "updatedAt": _as_timestamp(source.get("updatedAt")),
    }


# ------------------------------------------------------------------ storage


def _read_stored() -> List[Dict[str, Any]]:
    document = read_json(TEMPLATES_PATH, {"templates": []}) or {}
    raw = document.get("templates") if isinstance(document, dict) else None
    templates = [_normalize_template(entry) for entry in (raw if isinstance(raw, list) else [])]
    return [t for t in templates if t is not None and not t["id"].startswith("builtin-")]


def _write_stored(templates: Sequence[Dict[str, Any]]) -> None:
    write_json(
        TEMPLATES_PATH,
        {"templates": [{k: v for k, v in template.items() if k != "builtIn"} for template in templates]},
    )


def _read_built_ins() -> List[Dict[str, Any]]:
    """The starting points that ship with the application. Read-only."""
    try:
        bundled = read_json(TEMPLATE_PRESETS_PATH, {"templates": []}) or {}
    except StorageError:
        bundled = {}
    raw = bundled.get("templates") if isinstance(bundled, dict) else None
    templates = [_normalize_template(entry, built_in=True) for entry in (raw if isinstance(raw, list) else [])]
    return [t for t in templates if t is not None and t["id"].startswith("builtin-")]


def list_templates() -> List[Dict[str, Any]]:
    return [*_read_built_ins(), *_read_stored()]


def find_template(template_id: str) -> Dict[str, Any]:
    template = next((entry for entry in list_templates() if entry["id"] == template_id), None)
    if template is None:
        raise TemplateError("That template no longer exists.", 404)
    return template


def assert_can_create(name: Any) -> None:
    """Everything that could refuse a new template, checked before anything —
    an import's embedded files included — is written."""
    if len(_read_stored()) >= MAX_TEMPLATES:
        raise TemplateError(f"You can keep up to {MAX_TEMPLATES} templates. Delete one to make room.", 409)
    if not as_text(name, "", 80):
        raise TemplateError("Give the template a name.")


def create_template(raw: Any, app_settings: Dict[str, Any]) -> Dict[str, Any]:
    stored = _read_stored()
    source = as_object(raw)
    assert_can_create(source.get("name"))

    now = js_now_iso()
    sections = _as_sections(source.get("sections"), DEFAULT_SECTIONS)
    if not sections:
        raise TemplateError("Choose at least one part of the configuration to save.")

    template = _normalize_template(
        {
            "name": source.get("name"),
            "description": source.get("description"),
            "sections": sections,
            # Built from the settings passed in, or — for an import — the ones
            # the file carried.
            "settings": source["settings"]
            if js_truthy(source.get("settings"))
            else pick_sections(app_settings, sections),
            "createdAt": now,
            "updatedAt": now,
        }
    )
    if template is None:
        raise TemplateError("Give the template a name.")

    _write_stored([*stored, template])
    return template


def update_template(template_id: str, raw: Any, app_settings: Dict[str, Any]) -> Dict[str, Any]:
    """Rename a template, or — with ``refresh`` — replace what it holds with the
    current configuration, keeping its name and the sections it was made of
    unless new ones are given."""
    stored = _read_stored()
    index = next((i for i, template in enumerate(stored) if template["id"] == template_id), -1)
    if index == -1:
        if str(template_id).startswith("builtin-"):
            raise TemplateError("Built-in templates cannot be changed. Save a copy instead.", 409)
        raise TemplateError("That template no longer exists.", 404)

    source = as_object(raw)
    current = stored[index]
    sections = _as_sections(source.get("sections"), current["sections"])
    if not sections:
        raise TemplateError("Choose at least one part of the configuration to keep.")

    updated = _normalize_template(
        {
            **current,
            "name": source["name"] if "name" in source else current["name"],
            "description": source["description"] if "description" in source else current["description"],
            "sections": sections,
            "settings": pick_sections(app_settings, sections) if js_truthy(source.get("refresh")) else current["settings"],
            "updatedAt": js_now_iso(),
        }
    )
    if updated is None:
        raise TemplateError("Give the template a name.")

    _write_stored([updated if position == index else template for position, template in enumerate(stored)])
    return updated


def delete_template(template_id: str) -> Dict[str, Any]:
    if str(template_id).startswith("builtin-"):
        raise TemplateError("Built-in templates cannot be deleted.", 409)
    stored = _read_stored()
    remaining = [template for template in stored if template["id"] != template_id]
    if len(remaining) == len(stored):
        raise TemplateError("That template no longer exists.", 404)
    _write_stored(remaining)
    return next(template for template in stored if template["id"] == template_id)


def _merge_sound(current: Dict[str, Any], incoming: Dict[str, Any]) -> Tuple[Dict[str, Any], List[str]]:
    """A template's sound settings over the event's own.

    The cues are the template's, but the track library is a collection of the
    organiser's files rather than a style, so the two libraries are combined.
    A template track whose id is already taken by a different file is given a
    fresh one, and the template's cues follow it. The library holds
    MAX_TRACKS: the event's own tracks come first, and any of the template's
    that do not fit are reported rather than lost quietly.
    """
    library = list(current.get("library") or [])
    renamed: Dict[str, str] = {}
    dropped: List[str] = []

    for track in incoming.get("library") or []:
        existing = next((entry for entry in library if entry.get("src") == track.get("src")), None)
        if len(library) >= MAX_TRACKS and existing is None:
            dropped.append(track.get("name"))
            continue
        if existing is not None:
            renamed[track.get("id")] = existing.get("id")
            continue
        if any(entry.get("id") == track.get("id") for entry in library):
            fresh = new_track_id()
            renamed[track.get("id")] = fresh
            library.append({**track, "id": fresh})
            continue
        library.append(track)

    cues = {}
    for name, cue in (incoming.get("cues") or {}).items():
        if isinstance(cue, dict) and renamed.get(cue.get("track")):
            cues[name] = {**cue, "track": renamed[cue["track"]]}
        else:
            cues[name] = cue

    return {**incoming, "library": library, "cues": cues}, dropped


def apply_template(
    template: Dict[str, Any],
    app_settings: Dict[str, Any],
    sections: Any = None,
    keep_event_name: bool = True,
) -> Dict[str, Any]:
    """The settings with a template's chosen sections laid over them.

    Sections replace whole: a template's prize list is the prize list, not a
    merge of two. ``keep_event_name`` holds on to the name and organisation of
    the event being configured even when the template carries its own.
    """
    chosen = [name for name in _as_sections(sections, template["sections"]) if name in template["sections"]]
    if not chosen:
        raise TemplateError("Choose at least one part of the template to apply.")

    carried = template["settings"]
    dropped_tracks: List[str] = []
    layered = dict(app_settings)
    for section in chosen:
        for key in SECTIONS[section]:
            if key not in carried:
                continue
            if key == "data":
                layered["data"] = {
                    **carried["data"],
                    "sourceUrl": app_settings["data"].get("sourceUrl"),
                    "sourceSyncedAt": app_settings["data"].get("sourceSyncedAt"),
                }
            elif key == "sound":
                merged, dropped = _merge_sound(app_settings["sound"], carried["sound"])
                dropped_tracks.extend(dropped)
                layered["sound"] = merged
            elif key == "countdown":
                # When the draw starts, and whether the countdown is running,
                # belong to this event; a template brings its words and look.
                layered["countdown"] = {
                    **carried["countdown"],
                    "enabled": app_settings["countdown"]["enabled"],
                    "targetAt": app_settings["countdown"]["targetAt"],
                }
            else:
                layered[key] = carried[key]

    if keep_event_name:
        layered = {
            **layered,
            "eventName": app_settings["eventName"],
            "organizationName": app_settings["organizationName"],
        }

    return {"appSettings": normalize_app_settings(layered), "sections": chosen, "droppedTracks": dropped_tracks}


# ------------------------------------------------------------------- assets


def asset_refs(settings: Any) -> List[str]:
    """Every uploaded file a configuration points at."""
    source = as_object(settings)
    branding = as_object(source.get("branding"))
    refs: List[Any] = [
        as_object(branding.get("logo")).get("src"),
        as_object(branding.get("background")).get("src"),
    ]
    refs.extend(as_object(image).get("src") for image in as_object(source.get("welcome")).get("images") or [])
    for item in as_object(source.get("prizes")).get("items") or []:
        refs.extend(as_object(image).get("src") for image in as_object(item).get("images") or [])
    refs.extend(as_object(track).get("src") for track in as_object(source.get("sound")).get("library") or [])

    unique: List[str] = []
    for ref in refs:
        if isinstance(ref, str) and ref.startswith("assets/") and ref not in unique:
            unique.append(ref)
    return unique


def asset_in_use(src: str, app_settings: Dict[str, Any]) -> bool:
    """Whether anything still needs a file — the live configuration or any
    saved template. Nothing is deleted while a template holds it, or applying
    that template later would bring back a broken image."""
    if src in asset_refs(app_settings):
        return True
    return any(src in asset_refs(template["settings"]) for template in _read_stored())


def remove_if_unused(src: Any, app_settings: Dict[str, Any]) -> bool:
    """Deletes an uploaded file once nothing refers to it any more."""
    if not isinstance(src, str) or not src.startswith("assets/") or ".." in src:
        return False
    if asset_in_use(src, app_settings):
        return False
    images.remove_image_asset(src)
    return True


def _asset_file(ref: str):
    return ROOT_DIR / "assets" / ref[len("assets/") :]


def without_missing_assets(app_settings: Dict[str, Any]) -> Dict[str, Any]:
    """Drops references to files this deployment does not have, so applying a
    template from elsewhere never leaves a broken image or a silent cue: a
    missing logo falls back to the default, a missing photo or track is left
    out."""
    missing = [ref for ref in asset_refs(app_settings) if not _asset_file(ref).is_file()]
    if not missing:
        return {"appSettings": app_settings, "missing": missing}

    def keep(image: Any) -> bool:
        return not image or image.get("src") not in missing

    def cleared(asset: Dict[str, Any]) -> Dict[str, Any]:
        if asset.get("src") not in missing:
            return asset
        return {**asset, "src": None, "width": None, "height": None}

    branding = app_settings["branding"]
    cleaned = {
        **app_settings,
        "branding": {**branding, "logo": cleared(branding["logo"]), "background": cleared(branding["background"])},
        "welcome": {**app_settings["welcome"], "images": [i for i in app_settings["welcome"]["images"] if keep(i)]},
        "prizes": {
            **app_settings["prizes"],
            "items": [
                {**item, "images": [i for i in item["images"] if keep(i)]} for item in app_settings["prizes"]["items"]
            ],
        },
        "sound": {**app_settings["sound"], "library": [t for t in app_settings["sound"]["library"] if keep(t)]},
    }
    return {"appSettings": normalize_app_settings(cleaned), "missing": missing}


# ---------------------------------------------------------- export / import


def export_template(template: Dict[str, Any], embed: bool = False) -> Dict[str, Any]:
    """A template as a file. With ``embed``, the images and audio it points at
    travel inside it, so it works on a deployment that has never seen them."""
    assets: Dict[str, str] = {}
    if embed:
        for ref in asset_refs(template["settings"]):
            path = _asset_file(ref)
            if path.is_file():
                assets[ref] = base64.b64encode(path.read_bytes()).decode("ascii")

    return {
        "format": TEMPLATE_FORMAT,
        "version": TEMPLATE_VERSION,
        "exportedAt": js_now_iso(),
        "template": {
            "name": template["name"],
            "description": template["description"],
            "sections": template["sections"],
            "settings": template["settings"],
        },
        "assets": assets,
    }


IMAGE_NAME = re.compile(r"^assets/(logo|background|guest|prize)-[a-f0-9]{10}\.(png|jpg|gif|webp|svg)$")
IMAGE_EXTENSIONS = {"png": "png", "jpeg": "jpg", "gif": "gif", "webp": "webp", "svg": "svg"}


def _verify_embedded(ref: str, buffer: bytes) -> bool:
    """Whether an embedded file is what its name claims.

    Names carry a hash of the content, so a file whose bytes do not hash to its
    own name — or are not the kind of file the name says — is refused rather
    than trusted.
    """
    digest = hashlib.sha1(buffer).hexdigest()[:10]

    image = IMAGE_NAME.fullmatch(ref)
    if image:
        kind, extension = image.group(1), image.group(2)
        try:
            info = images.probe_image(buffer)
        except Exception:  # noqa: BLE001 - a truncated header is simply not an image
            info = None
        if not info or IMAGE_EXTENSIONS.get(info["format"]) != extension:
            return False
        if len(buffer) > images.max_bytes_for(kind):
            return False
        return ref == f"assets/{kind}-{digest}.{extension}"

    audio_format = audio.probe_audio(buffer)
    if not audio_format or len(buffer) > audio.MAX_BLOB_BYTES:
        return False
    return ref == f"assets/{audio.audio_file_name(buffer, audio_format)}"


def import_template(payload: Any) -> Dict[str, Any]:
    """Reads a template file and stores whatever files it carries.

    Returns the template input, ready for :func:`create_template`, and which
    files were refused.
    """
    source = as_object(payload)
    if source.get("format") != TEMPLATE_FORMAT:
        raise TemplateError("That is not a Pickora template file.")
    if js_number(source.get("version")) > TEMPLATE_VERSION:
        raise TemplateError("That template was made by a newer version of Pickora. Update this one first.")

    template = as_object(source.get("template"))
    refused: List[str] = []

    for ref, encoded in as_object(source.get("assets")).items():
        buffer = audio.decode_base64(encoded)
        if buffer is None or not _verify_embedded(ref, buffer):
            refused.append(ref)
            continue
        directory = ROOT_DIR / "assets"
        directory.mkdir(parents=True, exist_ok=True)
        _asset_file(ref).write_bytes(buffer)

    return {
        "input": {
            "name": template.get("name"),
            "description": template.get("description"),
            "sections": template.get("sections"),
            "settings": as_object(template.get("settings")),
        },
        "refused": refused,
    }

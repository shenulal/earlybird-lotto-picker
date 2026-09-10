"""Application settings plus the admin credential record they carry.

Mirrors ``server/settings.js`` field for field, so one ``appsettings.json``
works under either runtime.
"""

import os
import re
import secrets
from datetime import datetime, timezone
from typing import Any, Dict, Optional

from . import schema, tickets as ticket_store
from .auth import hash_password
from .paths import SETTINGS_PATH, SETTINGS_SAMPLE_PATH
from .store import read_json, write_json

DEFAULT_ADMIN_USERNAME = "admin"
DEFAULT_ADMIN_PASSWORD = "pickora"

BOARD_ALIGNMENTS = ("left", "center", "right")
DIRECTIONS = ("ltr", "rtl")
LOGO_POSITIONS = (
    "top-left",
    "top-center",
    "top-right",
    "bottom-left",
    "bottom-center",
    "bottom-right",
    "hidden",
)
BACKGROUND_FITS = ("cover", "contain", "fill", "tile")
DUPLICATE_POLICIES = ("skip", "allow")

# Which end of the prize list the evening starts from.
PRIZE_DRAW_ORDERS = ("highest-first", "lowest-first")

# Whether the prize is named before its draw, or held back until the winner.
PRIZE_ANNOUNCE_MODES = ("before", "after")
WELCOME_PLACEMENTS = ("overlay", "panel")

MAX_WELCOME_IMAGES = 20
MAX_PRIZES = 20
MAX_PRIZE_IMAGES = 12

ORDINALS = (
    "First prize", "Second prize", "Third prize", "Fourth prize", "Fifth prize",
    "Sixth prize", "Seventh prize", "Eighth prize", "Ninth prize", "Tenth prize",
)

PRIZE_ID = re.compile(r"^[a-z0-9-]{1,40}$")
WELCOME_INTERVAL_LIMITS = (1500, 60000)

# Used only when there is no configuration and no participant file to learn
# from — deliberately event-neutral.
DEFAULT_FIELDS = [
    {"key": "ticket", "label": "Ticket", "sensitive": False},
    {"key": "name", "label": "Name", "sensitive": False},
    {"key": "details", "label": "Details", "sensitive": False},
    {"key": "contact", "label": "Contact", "sensitive": True},
]

DEFAULT_CONFETTI_PALETTE = ["#ffd54f", "#ff8a65", "#4dd0e1", "#f06292", "#aed581", "#ffffff"]

DEFAULT_COPY = {
    "readyTitle": "Ready to draw",
    "readyDetail": "Press Start",
    "winnerEyebrow": "Winner",
    "prizeLabel": "Prize",
    "lastWinnerEyebrow": "Last winner",
    "completeTitle": "All prizes awarded",
    "startButton": "Start",
    "stopButton": "Stop",
    "winnersHeading": "Winners",
    "winnersEmpty": "No draws yet.",
    "winnersToggle": "Winners",
    "fullscreenButton": "Fullscreen",
    "organiserLink": "Organiser",
    "welcomeToggle": "Welcome",
    "boardToggle": "Draw board",
    "prizesToggle": "Prizes",
    "upNextLabel": "Up next",
    "drawPrompt": "Press Start to draw",
    "prizesBack": "Back to the draw",
    "newDrawButton": "New draw",
    "newDrawConfirm": "Clear the current draw and start over?",
    "footer": "Pickora · by Shenu",
    "loading": "Preparing the draw…",
}

CLAMPS = {
    "totalPrizes": (1, 10000),
    "rollingSpeed": (10, 1000),
    "confettiDuration": (0, 60000),
    "confettiCount": (0, 600),
    "winnerAnnouncementDelay": (0, 15000),
    "confettiStartDelay": (0, 15000),
    "minimumRollMs": (0, 30000),
    "logoMaxHeight": (24, 480),
    "overlayOpacity": (0, 100),
    "welcomeIntervalMs": WELCOME_INTERVAL_LIMITS,
    "prizeIntervalMs": WELCOME_INTERVAL_LIMITS,
}

ASSET_PATH = re.compile(r"^assets/[A-Za-z0-9._-]+$")
BARE_IMAGE = re.compile(r"^[A-Za-z0-9._-]+\.(png|jpe?g|gif|webp|svg)$", re.I)
HEX_COLOR = re.compile(r"^#[0-9a-f]{3,8}$", re.I)


def _clamp(key: str, value: Any, fallback: int) -> int:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return fallback
    if number != number or number in (float("inf"), float("-inf")):
        return fallback
    low, high = CLAMPS[key]
    return int(min(high, max(low, round(number))))


def _as_bool(value: Any, fallback: bool) -> bool:
    if isinstance(value, bool):
        return value
    if value == "true":
        return True
    if value == "false":
        return False
    return fallback


def _as_choice(value: Any, choices: tuple, fallback: str) -> str:
    return value if value in choices else fallback


def _as_text(value: Any, fallback: str, max_length: int = 200) -> str:
    if not isinstance(value, str):
        return fallback
    trimmed = value.strip()
    return trimmed[:max_length] if trimmed else fallback


def _as_asset_path(value: Any) -> str:
    if not isinstance(value, str):
        return ""
    trimmed = value.strip()
    return trimmed if ASSET_PATH.match(trimmed) or BARE_IMAGE.match(trimmed) else ""


def _normalize_copy(raw: Any) -> Dict[str, str]:
    source = raw if isinstance(raw, dict) else {}
    return {key: _as_text(source.get(key), default, 160) for key, default in DEFAULT_COPY.items()}


def _normalize_palette(raw: Any) -> list:
    items = raw if isinstance(raw, list) else []
    colors = [c.strip() for c in items if isinstance(c, str) and HEX_COLOR.match(c.strip())][:12]
    return colors or list(DEFAULT_CONFETTI_PALETTE)


def ordinal_label(index: int) -> str:
    return ORDINALS[index] if index < len(ORDINALS) else f"Prize {index + 1}"


def _is_default_label(label: Any) -> bool:
    if not isinstance(label, str) or not label.strip():
        return True
    trimmed = label.strip()
    return trimmed in ORDINALS or bool(re.match(r"^Prize \d+$", trimmed))


def _normalize_images(raw: Any, limit: int) -> list:
    """Normalise a carousel image list, dropping anything unusable."""
    items = raw if isinstance(raw, list) else []
    images = []

    for entry in items:
        image = entry if isinstance(entry, dict) else {"src": entry}
        src = _as_asset_path(image.get("src"))
        if not src:
            continue

        def dimension(value: Any) -> Optional[int]:
            try:
                number = int(value)
            except (TypeError, ValueError):
                return None
            return number or None

        images.append(
            {
                "src": src,
                "caption": _as_text(image.get("caption"), "", 120),
                "width": dimension(image.get("width")),
                "height": dimension(image.get("height")),
            }
        )
        if len(images) >= limit:
            break

    return images


def _normalize_prizes(raw: Any) -> Dict[str, Any]:
    """The prize list. Order is rank: the first entry is first prize, and it is
    matched to a draw by position, so prize 1 goes with the first winner."""
    source = raw if isinstance(raw, dict) else {}
    items_raw = source.get("items") if isinstance(source.get("items"), list) else []

    items = []
    for index, entry in enumerate(items_raw):
        item = entry if isinstance(entry, dict) else {}
        name = _as_text(item.get("name"), "", 140)
        if not name:
            continue

        candidate = item.get("id")
        identifier = candidate if isinstance(candidate, str) and PRIZE_ID.match(candidate) else f"prize-{index + 1}"

        items.append(
            {
                "id": identifier,
                # A default label follows the position, so reordering renumbers
                # it. A label the organiser actually wrote is kept.
                "label": ordinal_label(index)
                if _is_default_label(item.get("label"))
                else _as_text(item.get("label"), ordinal_label(index), 60),
                "name": name,
                "description": _as_text(item.get("description"), "", 600),
                "images": _normalize_images(item.get("images"), MAX_PRIZE_IMAGES),
            }
        )
        if len(items) >= MAX_PRIZES:
            break

    # Ids must stay unique; a duplicate would make image uploads ambiguous.
    seen = set()
    unique = []
    for index, item in enumerate(items):
        if item["id"] in seen:
            item = {**item, "id": f"prize-{index + 1}-{secrets.token_hex(3)}"}
        seen.add(item["id"])
        unique.append(item)

    return {
        "enabled": _as_bool(source.get("enabled"), False),
        "heading": _as_text(source.get("heading"), "Prizes", 120),
        "intro": _as_text(source.get("intro"), "", 400),
        "showOnWinner": _as_bool(source.get("showOnWinner"), True),
        "drawOrder": _as_choice(source.get("drawOrder"), PRIZE_DRAW_ORDERS, "highest-first"),
        "announceMode": _as_choice(source.get("announceMode"), PRIZE_ANNOUNCE_MODES, "before"),
        "showCaptions": _as_bool(source.get("showCaptions"), True),
        "intervalMs": _clamp("prizeIntervalMs", source.get("intervalMs"), 5000),
        "items": unique,
    }


def _normalize_welcome(raw: Any) -> Dict[str, Any]:
    """The guest welcome: a message plus a carousel of portraits, shown to
    greet a special guest before or between draws."""
    source = raw if isinstance(raw, dict) else {}
    images = _normalize_images(source.get("images"), MAX_WELCOME_IMAGES)

    return {
        "enabled": _as_bool(source.get("enabled"), False),
        "showOnLoad": _as_bool(source.get("showOnLoad"), True),
        "placement": _as_choice(source.get("placement"), WELCOME_PLACEMENTS, "overlay"),
        "title": _as_text(source.get("title"), "Our special guest", 120),
        "message": _as_text(source.get("message"), "", 400),
        "showCaptions": _as_bool(source.get("showCaptions"), True),
        "intervalMs": _clamp("welcomeIntervalMs", source.get("intervalMs"), 5000),
        "images": images,
    }


def _normalize_branding(raw: Any) -> Dict[str, Any]:
    source = raw if isinstance(raw, dict) else {}
    logo = source.get("logo") or {}
    background = source.get("background") or {}

    def dimension(value: Any) -> Optional[int]:
        try:
            number = int(value)
        except (TypeError, ValueError):
            return None
        return number or None

    background_src = background.get("src")
    return {
        "logo": {
            "src": _as_asset_path(logo.get("src")),
            "position": _as_choice(logo.get("position"), LOGO_POSITIONS, "top-left"),
            "maxHeight": _clamp("logoMaxHeight", logo.get("maxHeight"), 96),
            "width": dimension(logo.get("width")),
            "height": dimension(logo.get("height")),
        },
        "background": {
            # Defaults to the artwork the board has always shipped with, so an
            # existing deployment looks unchanged until a new file is uploaded.
            "src": "" if background_src == "" else (_as_asset_path(background_src) or "Background.png"),
            "fit": _as_choice(background.get("fit"), BACKGROUND_FITS, "cover"),
            "overlayOpacity": _clamp("overlayOpacity", background.get("overlayOpacity"), 45),
            "width": dimension(background.get("width")),
            "height": dimension(background.get("height")),
        },
    }


def _normalize_data(raw: Any, legacy_display: Dict[str, Any]) -> Dict[str, Any]:
    """Rebuild the participant schema.

    With no ``data`` block configured — a fresh install, or a file written
    before the schema existed — the columns are read from the participant file
    itself rather than assuming any particular event's shape.
    """
    source = raw if isinstance(raw, dict) else {}
    policy = _as_choice(source.get("duplicatePolicy"), DUPLICATE_POLICIES, "skip")
    fields = schema.normalize_fields(source.get("fields"))

    if fields:
        return {
            "identifier": schema.pick_identifier(fields, source.get("identifier")),
            "fields": fields,
            "duplicatePolicy": policy,
        }

    inferred = ticket_store.infer_schema_from_file()
    if inferred:
        # A board that previously displayed contact details keeps doing so.
        adjusted = (
            [{**field, "sensitive": False} for field in inferred["fields"]]
            if legacy_display.get("showMobileInWinner") is True
            else inferred["fields"]
        )
        return {"identifier": inferred["identifier"], "fields": adjusted, "duplicatePolicy": policy}

    return {
        "identifier": DEFAULT_FIELDS[0]["key"],
        "fields": schema.normalize_fields(DEFAULT_FIELDS),
        "duplicatePolicy": policy,
    }


def normalize_app_settings(raw: Any) -> Dict[str, Any]:
    source = raw if isinstance(raw, dict) else {}
    animation = source.get("animation") or {}
    ui = source.get("ui") or {}
    draw = source.get("draw") or {}
    display_source = source.get("display") or {}

    data = _normalize_data(source.get("data"), display_source)
    display = schema.normalize_display(display_source, data)
    display["autoStopWhenPrizesExhausted"] = _as_bool(display_source.get("autoStopWhenPrizesExhausted"), True)

    return {
        "totalPrizes": _clamp("totalPrizes", source.get("totalPrizes"), 10),
        "eventName": _as_text(source.get("eventName"), "Pickora", 120),
        "organizationName": _as_text(source.get("organizationName"), "", 120),
        "locale": _as_text(source.get("locale"), "en", 20),
        "direction": _as_choice(source.get("direction"), DIRECTIONS, "ltr"),
        "data": data,
        "display": display,
        "animation": {
            "rollingSpeed": _clamp("rollingSpeed", animation.get("rollingSpeed"), 60),
            "confettiDuration": _clamp("confettiDuration", animation.get("confettiDuration"), 8000),
            "confettiCount": _clamp("confettiCount", animation.get("confettiCount"), 150),
            "confettiPalette": _normalize_palette(animation.get("confettiPalette")),
            "winnerAnnouncementDelay": _clamp("winnerAnnouncementDelay", animation.get("winnerAnnouncementDelay"), 2500),
            "confettiStartDelay": _clamp("confettiStartDelay", animation.get("confettiStartDelay"), 500),
        },
        "draw": {
            "publicDrawEnabled": _as_bool(draw.get("publicDrawEnabled"), True),
            "requireAuthForDraw": _as_bool(draw.get("requireAuthForDraw"), False),
            "allowResetFromBoard": _as_bool(draw.get("allowResetFromBoard"), False),
            "minimumRollMs": _clamp("minimumRollMs", draw.get("minimumRollMs"), 1200),
        },
        "branding": _normalize_branding(source.get("branding")),
        "welcome": _normalize_welcome(source.get("welcome")),
        "prizes": _normalize_prizes(source.get("prizes")),
        "copy": _normalize_copy(source.get("copy")),
        "ui": {
            "primaryColor": _as_text(ui.get("primaryColor"), "#ffeb3b", 40),
            "backgroundColor": _as_text(
                ui.get("backgroundColor"), "radial-gradient(circle at top, #1d2671, #c33764)", 400
            ),
            "showOrganizationName": _as_bool(ui.get("showOrganizationName"), True),
            "showWinnersPanel": _as_bool(ui.get("showWinnersPanel"), False),
            "showStats": _as_bool(ui.get("showStats"), False),
            "boardAlignment": _as_choice(ui.get("boardAlignment"), BOARD_ALIGNMENTS, "center"),
        },
    }


def load_settings_file() -> Dict[str, Any]:
    source = SETTINGS_PATH if SETTINGS_PATH.exists() else SETTINGS_SAMPLE_PATH
    raw = read_json(source, {"appSettings": {}}) or {}
    return {"appSettings": normalize_app_settings(raw.get("appSettings")), "adminAuth": raw.get("adminAuth")}


def save_settings_file(settings_file: Dict[str, Any]) -> None:
    write_json(
        SETTINGS_PATH,
        {"appSettings": settings_file["appSettings"], "adminAuth": settings_file.get("adminAuth")},
    )


def ensure_admin_credentials() -> Dict[str, Any]:
    """Return the credential record, bootstrapping it on first run.

    ``ADMIN_USERNAME``/``ADMIN_PASSWORD`` win over the file when both are set,
    so a deployment can override whatever is committed.
    """
    settings_file = load_settings_file()
    env_username = os.environ.get("ADMIN_USERNAME")
    env_password = os.environ.get("ADMIN_PASSWORD")

    if env_username and env_password:
        credential = hash_password(env_password)
        credential.update({"username": env_username, "source": "environment", "isDefaultPassword": False})
        return {"settingsFile": {**settings_file, "adminAuth": credential}, "created": False, "usingDefaults": False}

    existing = settings_file.get("adminAuth")
    if existing and existing.get("hash"):
        return {
            "settingsFile": settings_file,
            "created": False,
            "usingDefaults": bool(existing.get("isDefaultPassword")),
        }

    credential = hash_password(DEFAULT_ADMIN_PASSWORD)
    credential.update(
        {
            "username": DEFAULT_ADMIN_USERNAME,
            "source": "file",
            "isDefaultPassword": True,
            "updatedAt": datetime.now(timezone.utc).isoformat(),
        }
    )
    bootstrapped = {**settings_file, "adminAuth": credential}
    save_settings_file(bootstrapped)
    return {"settingsFile": bootstrapped, "created": True, "usingDefaults": True}

"""The settings behind sponsors, the phone remote, live sync between screens
and the spin-the-wheel draw style.

As with ``features.py``, every value an organiser can set is read through here,
and an absent value falls back to a default that leaves an existing event
exactly as it was: no sponsors shown, no remote, no sync, the reel. Mirrors
``server/stage-features.js``.
"""

import hmac
import re
import secrets
import time
from typing import Any, Dict, List, Optional
from urllib.parse import urlparse

from .coerce import (
    as_boolean,
    as_choice,
    as_color,
    as_id,
    as_object,
    as_optional_text,
    as_text,
    clamp_number,
    js_date_parse,
    js_number,
)

# ================================================================ sponsors

MAX_SPONSORS = 30
SPONSOR_ID = re.compile(r"^sponsor-[a-z0-9-]{1,40}$")
PRIZE_ID = re.compile(r"^[a-z0-9-]{1,40}$")
SPONSOR_LOGO = re.compile(r"^assets/sponsor-[a-f0-9]{10}\.(png|jpg|gif|webp|svg)$")
LOGO_SIZES = ("small", "medium", "large")
STRIP_POSITIONS = ("bottom", "top")
SCREENS = ("board", "welcome", "prizes")

_URL_SCHEME = re.compile(r"^[a-z][a-z0-9+.-]*:", re.I)


def _as_link(value: Any) -> str:
    """An http(s) link, or ''. Anything else is not a link anyone should scan."""
    if not isinstance(value, str) or not value.strip():
        return ""
    trimmed = value.strip()
    candidate = trimmed if _URL_SCHEME.match(trimmed) else f"https://{trimmed}"
    try:
        parsed = urlparse(candidate)
    except ValueError:
        return ""
    if parsed.scheme.lower() not in ("http", "https"):
        return ""
    return candidate[:500] if parsed.netloc else ""


def _screens_from(raw: Any, defaults: Dict[str, bool]) -> Dict[str, bool]:
    source = as_object(raw)
    return {screen: as_boolean(source.get(screen), defaults[screen]) for screen in SCREENS}


def _dimension(value: Any) -> Optional[Any]:
    """``Number(value) || null``, written back as a whole number when it is one."""
    number = js_number(value)
    if number != number or number == 0:  # NaN, or zero
        return None
    return int(number) if number.is_integer() else number


def _normalize_sponsor(raw: Any, index: int) -> Optional[Dict[str, Any]]:
    source = as_object(raw)
    name = as_text(source.get("name"), "", 80)
    if not name:
        return None
    logo = as_object(source.get("logo"))
    logo_src = logo.get("src")
    src = logo_src.strip() if isinstance(logo_src, str) and SPONSOR_LOGO.fullmatch(logo_src.strip()) else ""

    return {
        "id": as_id(source.get("id"), SPONSOR_ID, f"sponsor-{index + 1}"),
        "name": name,
        # Free text, so a "Title sponsor" or "Official car partner" reads as the
        # contract says rather than one of a fixed few.
        "tier": as_optional_text(source.get("tier"), "", 40),
        "tagline": as_optional_text(source.get("tagline"), "", 140),
        "url": _as_link(source.get("url")),
        "logo": {
            "src": src,
            "width": _dimension(logo.get("width")) if src else None,
            "height": _dimension(logo.get("height")) if src else None,
        },
    }


def normalize_sponsors(raw: Any) -> Dict[str, Any]:
    source = as_object(raw)
    entries = source.get("items") if isinstance(source.get("items"), list) else []

    items: List[Dict[str, Any]] = []
    seen = set()
    for index, entry in enumerate(entries):
        sponsor = _normalize_sponsor(entry, index)
        if sponsor is None or sponsor["id"] in seen:
            continue
        seen.add(sponsor["id"])
        items.append(sponsor)
    items = items[:MAX_SPONSORS]

    # Which sponsor stands behind which prize, by prize id. A link to a sponsor
    # that no longer exists is dropped rather than left dangling.
    ids = {sponsor["id"] for sponsor in items}
    prize_sponsors = {
        prize_id: sponsor_id
        for prize_id, sponsor_id in as_object(source.get("prizeSponsors")).items()
        if PRIZE_ID.fullmatch(prize_id) and isinstance(sponsor_id, str) and sponsor_id in ids
    }

    display = as_object(source.get("display"))
    strip = as_object(source.get("strip"))
    tiers = strip.get("tiers") if isinstance(strip.get("tiers"), list) else []

    return {
        # Off until the organiser turns it on.
        "enabled": as_boolean(source.get("enabled"), False),
        "label": as_text(source.get("label"), "Sponsored by", 60),
        "items": items,
        "prizeSponsors": prize_sponsors,
        "display": {
            "announcement": as_boolean(display.get("announcement"), True),
            "winnerCard": as_boolean(display.get("winnerCard"), True),
            "prizeScreen": as_boolean(display.get("prizeScreen"), True),
            "certificate": as_boolean(display.get("certificate"), True),
            "export": as_boolean(display.get("export"), True),
            "showTagline": as_boolean(display.get("showTagline"), True),
            "showName": as_boolean(display.get("showName"), True),
            "logoSize": as_choice(display.get("logoSize"), LOGO_SIZES, "medium"),
        },
        # A rotating strip of every sponsor's logo along an edge of the screen.
        "strip": {
            "enabled": as_boolean(strip.get("enabled"), False),
            "heading": as_optional_text(strip.get("heading"), "Our sponsors", 60),
            "position": as_choice(strip.get("position"), STRIP_POSITIONS, "bottom"),
            "screens": _screens_from(strip.get("screens"), {"board": False, "welcome": True, "prizes": True}),
            "intervalMs": clamp_number(strip.get("intervalMs"), (1500, 30000), 4000),
            "logoHeight": clamp_number(strip.get("logoHeight"), (24, 160), 48),
            "perView": clamp_number(strip.get("perView"), (1, 8), 4),
            "showNames": as_boolean(strip.get("showNames"), False),
            # Only sponsors at these tiers, or every sponsor when empty.
            "tiers": [tier.strip()[:40] for tier in tiers if isinstance(tier, str) and tier.strip()][:12],
        },
    }


def sponsor_for_prize(sponsors: Optional[Dict[str, Any]], prize_id: Any) -> Optional[Dict[str, Any]]:
    """The sponsor behind a prize, when sponsors are on and one is assigned."""
    if not sponsors or not sponsors.get("enabled") or not prize_id:
        return None
    sponsor_id = sponsors["prizeSponsors"].get(prize_id)
    if not sponsor_id:
        return None
    return next((sponsor for sponsor in sponsors["items"] if sponsor["id"] == sponsor_id), None)


# ================================================================== remote

REMOTE_ACTIONS = ("draw", "notPresent", "screens", "sound")
REMOTE_KEY = re.compile(r"^[A-Za-z0-9_-]{24,64}$")


def _as_instant(value: Any) -> str:
    if not isinstance(value, str) or not value.strip():
        return ""
    return value.strip()[:40] if js_date_parse(value.strip()) is not None else ""


def normalize_remote(raw: Any) -> Dict[str, Any]:
    source = as_object(raw)
    actions = as_object(source.get("actions"))
    raw_key = source.get("key")
    key = raw_key if isinstance(raw_key, str) and REMOTE_KEY.fullmatch(raw_key) else ""

    return {
        "enabled": as_boolean(source.get("enabled"), False),
        # The pairing secret the phone holds. Never sent to a public page.
        "key": key,
        "keyCreatedAt": _as_instant(source.get("keyCreatedAt")) if key else "",
        "keyExpiresAt": _as_instant(source.get("keyExpiresAt")) if key else "",
        # How long a new pairing stays valid. Zero never expires.
        "expiryHours": clamp_number(source.get("expiryHours"), (0, 720), 12),
        # A phone signed in to the console can always use the remote; with this
        # off, the pairing link alone is enough.
        "requireSignIn": as_boolean(source.get("requireSignIn"), False),
        "actions": {action: as_boolean(actions.get(action), True) for action in REMOTE_ACTIONS},
        "confirmNotPresent": as_boolean(source.get("confirmNotPresent"), True),
        "haptics": as_boolean(source.get("haptics"), True),
        # How often the board checks for a command. Shorter is snappier and
        # costs more requests.
        "pollMs": clamp_number(source.get("pollMs"), (400, 5000), 1000),
        "showStatusOnBoard": as_boolean(source.get("showStatusOnBoard"), True),
    }


def new_remote_key() -> str:
    """24 random bytes, base64url without padding — 32 characters."""
    return secrets.token_urlsafe(24)


def remote_key_matches(remote: Dict[str, Any], presented: Any, now: Optional[float] = None) -> bool:
    """Whether a key presented by a phone is the live pairing, compared safely."""
    if not remote.get("enabled") or not remote.get("key") or not isinstance(presented, str):
        return False
    moment = time.time() * 1000 if now is None else now
    expires = js_date_parse(remote.get("keyExpiresAt")) if remote.get("keyExpiresAt") else None
    if expires is not None and moment > expires:
        return False
    return hmac.compare_digest(remote["key"].encode("utf-8"), presented.encode("utf-8"))


def public_remote(remote: Dict[str, Any]) -> Dict[str, Any]:
    """The remote settings a public page may see: everything but the secret."""
    rest = {name: value for name, value in remote.items() if name not in ("key", "keyCreatedAt")}
    return {**rest, "paired": bool(remote.get("key"))}


# =============================================================== live sync

CONTROLLER_MODES = ("auto", "main-only")


def normalize_live_sync(raw: Any) -> Dict[str, Any]:
    source = as_object(raw)
    return {
        "enabled": as_boolean(source.get("enabled"), False),
        "pollMs": clamp_number(source.get("pollMs"), (500, 10000), 1500),
        # 'auto': the first draw board opened takes control. 'main-only': only a
        # board opened at /?role=main may.
        "controllerMode": as_choice(source.get("controllerMode"), CONTROLLER_MODES, "auto"),
        # Taking control needs an organiser sign-in on that browser. Off lets
        # any board take control — convenient, but anyone on the network could
        # then demote the main board.
        "claimRequiresSignIn": as_boolean(source.get("claimRequiresSignIn"), True),
        # How long a board keeps control after it stops checking in.
        "leaseSeconds": clamp_number(source.get("leaseSeconds"), (5, 120), 15),
        "mirrorDraws": as_boolean(source.get("mirrorDraws"), True),
        "followNavigation": as_boolean(source.get("followNavigation"), True),
        # Followers usually just watch: two boards able to draw is two draws.
        "followersCanDraw": as_boolean(source.get("followersCanDraw"), False),
        "soundOnFollowers": as_boolean(source.get("soundOnFollowers"), False),
        "celebrateOnFollowers": as_boolean(source.get("celebrateOnFollowers"), True),
        "screens": _screens_from(source.get("screens"), {"board": True, "welcome": True, "prizes": True}),
        "showStatus": as_boolean(source.get("showStatus"), True),
    }


# =================================================================== wheel

POINTER_SIDES = ("top", "right", "bottom", "left")
DRAW_STYLES = ("reel", "wheel")


def normalize_wheel(raw: Any) -> Dict[str, Any]:
    source = as_object(raw)
    colors = source.get("palette") if isinstance(source.get("palette"), list) else []
    palette = [color for color in (as_color(entry, "") for entry in colors) if color][:12]
    label_field = source.get("labelField")

    return {
        # 'reel' is what every board has always done.
        "style": as_choice(source.get("style"), DRAW_STYLES, "reel"),
        "segments": clamp_number(source.get("segments"), (4, 48), 16),
        # Empty uses the celebration palette, so a wheel matches its confetti.
        "palette": palette,
        # Empty picks dark or light text per segment, whichever reads.
        "textColor": as_color(source.get("textColor"), ""),
        "borderColor": as_color(source.get("borderColor"), ""),
        # Zero sizes the wheel to the screen.
        "size": clamp_number(source.get("size"), (0, 1400), 0),
        "fontSize": clamp_number(source.get("fontSize"), (0, 60), 0),
        # Turns per second at full speed, in tenths.
        "speed": clamp_number(source.get("speed"), (3, 40), 12),
        # How long the wheel takes to come to rest once the winner is known.
        "settleMs": clamp_number(source.get("settleMs"), (1500, 15000), 5000),
        "pointer": as_choice(source.get("pointer"), POINTER_SIDES, "top"),
        "showLabels": as_boolean(source.get("showLabels"), True),
        "centerLogo": as_boolean(source.get("centerLogo"), True),
        "centerText": as_optional_text(source.get("centerText"), "", 24),
        # The participant field written on the segments; empty uses the first
        # field the reel shows.
        "labelField": label_field.strip()[:64] if isinstance(label_field, str) else "",
    }

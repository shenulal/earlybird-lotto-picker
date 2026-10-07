"""The settings behind the event features: sound, the "winner not present"
redraw, the countdown and the draw certificate.

Every value an organiser can set is read through here, so whatever reaches the
board or the certificate has already been checked — a hand-edited settings
file, an imported template and the console all land on the same rules. Absent
values fall back to defaults that leave an event saved before these features
existed behaving exactly as it did: no sound, no countdown, no redraw control
on the board. Mirrors ``server/features.js``.
"""

import re
import time
from typing import Any, Dict, List, Optional

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
)

# ===================================================================== sound

# The moments the board can mark with a sound, and the built-in sounds each
# offers. The sounds themselves are synthesised in the browser (sound.js), so
# nothing is downloaded, nothing is licensed, and they work offline.
SOUND_PRESETS: Dict[str, tuple] = {
    "ambient": ("lounge", "gala", "pulse", "celesta"),
    "spin": ("drumroll", "ticker", "riser", "arcade", "heartbeat"),
    "land": ("cymbal", "gong", "chime", "thud"),
    "reveal": ("fanfare", "tada", "bells", "arcade", "applause"),
    "absent": ("trombone", "descend", "buzz"),
    "countdownTick": ("tick", "beep", "wood"),
    "countdownEnd": ("horn", "chime", "gong"),
}

SOUND_CUES = tuple(SOUND_PRESETS.keys())
SOUND_SOURCES = ("preset", "track")

# What each cue does until an organiser says otherwise. Background music is off
# by default even once sound is on: it is the one cue that plays without anyone
# pressing anything.
CUE_DEFAULTS: Dict[str, Dict[str, Any]] = {
    "ambient": {"enabled": False, "preset": "lounge", "volume": 35, "loop": True},
    "spin": {"enabled": True, "preset": "drumroll", "volume": 80, "loop": True},
    "land": {"enabled": True, "preset": "cymbal", "volume": 80, "loop": False},
    "reveal": {"enabled": True, "preset": "fanfare", "volume": 90, "loop": False},
    "absent": {"enabled": True, "preset": "trombone", "volume": 70, "loop": False},
    "countdownTick": {"enabled": True, "preset": "tick", "volume": 60, "loop": False},
    "countdownEnd": {"enabled": True, "preset": "horn", "volume": 90, "loop": False},
}

AMBIENT_SCREENS = ("board", "welcome", "prizes")

SOUND_LIMITS = {
    "volume": (0, 100),
    # Ten minutes is longer than any sting and long enough for a walk-in track.
    "durationMs": (0, 600000),
    "fadeMs": (0, 10000),
    "delayMs": (0, 10000),
    "startAtMs": (0, 600000),
}

MAX_TRACKS = 30
TRACK_ID = re.compile(r"^track-[a-z0-9-]{1,40}$")
# Only files the audio upload itself wrote: its name carries the content hash.
TRACK_SRC = re.compile(r"^assets/audio-[a-f0-9]{10}\.(mp3|ogg|wav|m4a|aac|flac|webm)$")
TRACK_FORMATS = ("mp3", "ogg", "wav", "m4a", "aac", "flac", "webm")


def _normalize_track(raw: Any, index: int) -> Optional[Dict[str, Any]]:
    source = as_object(raw)
    src_value = source.get("src")
    src = src_value.strip() if isinstance(src_value, str) and TRACK_SRC.fullmatch(src_value.strip()) else ""
    if not src:
        return None

    return {
        "id": as_id(source.get("id"), TRACK_ID, f"track-{index + 1}"),
        "name": as_text(source.get("name"), f"Track {index + 1}", 80),
        "src": src,
        "format": as_choice(source.get("format"), TRACK_FORMATS, src.split(".")[-1]),
        "bytes": clamp_number(source.get("bytes"), (0, 1_000_000_000), 0),
    }


def _normalize_library(raw: Any) -> List[Dict[str, Any]]:
    entries = raw if isinstance(raw, list) else []
    seen = set()
    library = []

    for index, entry in enumerate(entries):
        track = _normalize_track(entry, index)
        if track is None or track["id"] in seen:
            continue
        seen.add(track["id"])
        library.append(track)

    return library[:MAX_TRACKS]


def _normalize_cue(name: str, raw: Any, library: List[Dict[str, Any]]) -> Dict[str, Any]:
    """One cue. A cue pointing at a track that is no longer in the library
    falls back to its built-in sound rather than going silent at the event."""
    source = as_object(raw)
    defaults = CUE_DEFAULTS[name]
    track_ids = [track["id"] for track in library]
    track = source.get("track") if source.get("track") in track_ids else ""
    wants_track = source.get("source") == "track"

    cue: Dict[str, Any] = {
        "enabled": as_boolean(source.get("enabled"), defaults["enabled"]),
        "source": "track" if wants_track and track else "preset",
        "preset": as_choice(source.get("preset"), SOUND_PRESETS[name], defaults["preset"]),
        "track": track,
        "volume": clamp_number(source.get("volume"), SOUND_LIMITS["volume"], defaults["volume"]),
        # Zero is "as long as the sound is" — or, for a looping cue, until the
        # moment it belongs to is over.
        "durationMs": clamp_number(source.get("durationMs"), SOUND_LIMITS["durationMs"], 0),
        "fadeInMs": clamp_number(source.get("fadeInMs"), SOUND_LIMITS["fadeMs"], 1500 if name == "ambient" else 0),
        "fadeOutMs": clamp_number(
            source.get("fadeOutMs"), SOUND_LIMITS["fadeMs"], 600 if name in ("ambient", "spin") else 300
        ),
        "delayMs": clamp_number(source.get("delayMs"), SOUND_LIMITS["delayMs"], 0),
        # Where an uploaded track starts playing, so a song can begin on its hook.
        "startAtMs": clamp_number(source.get("startAtMs"), SOUND_LIMITS["startAtMs"], 0),
        "loop": as_boolean(source.get("loop"), defaults["loop"]),
    }

    if name != "ambient":
        return cue

    screens = as_object(source.get("screens"))
    return {
        **cue,
        "screens": {screen: as_boolean(screens.get(screen), True) for screen in AMBIENT_SCREENS},
        # The music steps aside for the draw itself, so the drumroll is heard.
        "pauseDuringDraw": as_boolean(source.get("pauseDuringDraw"), True),
    }


def normalize_sound(raw: Any) -> Dict[str, Any]:
    source = as_object(raw)
    library = _normalize_library(source.get("library"))
    cues = as_object(source.get("cues"))

    return {
        # Off until the organiser turns it on: an event saved before sound
        # existed must not start making noise after an update.
        "enabled": as_boolean(source.get("enabled"), False),
        "volume": clamp_number(source.get("volume"), SOUND_LIMITS["volume"], 80),
        # A speaker button on the public pages, for whoever is at the screen.
        "showMuteButton": as_boolean(source.get("showMuteButton"), True),
        "library": library,
        "cues": {name: _normalize_cue(name, cues.get(name), library) for name in SOUND_CUES},
    }


# ==================================================================== redraw

REDRAW_LIMITS = {
    "maxPerPrize": (0, 50),
    "noticeMs": (0, 15000),
}


def normalize_redraw(raw: Any) -> Dict[str, Any]:
    source = as_object(raw)

    return {
        # Off by default: until an organiser asks for it, a drawn winner stays drawn.
        "enabled": as_boolean(source.get("enabled"), False),
        # Whether the board's winner card offers the control at all.
        "showOnBoard": as_boolean(source.get("showOnBoard"), True),
        # Who may use it there. Signed-in by default — a guest at the screen
        # must not be able to strike a winner off.
        "requireSignIn": as_boolean(source.get("requireSignIn"), True),
        "confirmOnBoard": as_boolean(source.get("confirmOnBoard"), True),
        # Off by default: someone who was called and was not there does not get
        # a second chance at a later prize unless the organiser decides so.
        "returnToPool": as_boolean(source.get("returnToPool"), False),
        # Spin again straight away, or go back to the prize and wait for Start.
        "autoRedraw": as_boolean(source.get("autoRedraw"), False),
        # How many times one prize may be redrawn. Zero is no limit.
        "maxPerPrize": clamp_number(source.get("maxPerPrize"), REDRAW_LIMITS["maxPerPrize"], 0),
        "noticeMs": clamp_number(source.get("noticeMs"), REDRAW_LIMITS["noticeMs"], 2500),
        "showInPanel": as_boolean(source.get("showInPanel"), True),
        "includeInExport": as_boolean(source.get("includeInExport"), True),
    }


# ================================================================= countdown

COUNTDOWN_STYLES = ("overlay", "banner")
COUNTDOWN_POSITIONS = ("top", "bottom")
COUNTDOWN_UNITS = ("auto", "dhms", "hms", "ms")
COUNTDOWN_SCREENS = ("board", "welcome", "prizes")
COUNTDOWN_LIMITS = {
    "finalSeconds": (0, 60),
    "completeHoldSeconds": (0, 3600),
}

# Must carry its own offset: a bare local time means a different moment on
# every screen that reads it, and in every timezone a server might be in.
INSTANT = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$", re.ASCII)


def _as_instant(value: Any) -> str:
    """A moment in time, kept as the ISO string it was given, or ''."""
    if not isinstance(value, str) or not value.strip():
        return ""
    trimmed = value.strip()[:40]
    if not INSTANT.fullmatch(trimmed):
        return ""
    return "" if js_date_parse(trimmed) is None else trimmed


def normalize_countdown(raw: Any) -> Dict[str, Any]:
    source = as_object(raw)
    screens = as_object(source.get("screens"))
    labels = as_object(source.get("labels"))

    return {
        "enabled": as_boolean(source.get("enabled"), False),
        "targetAt": _as_instant(source.get("targetAt")),
        "title": as_text(source.get("title"), "The draw begins in", 120),
        "subtitle": as_optional_text(source.get("subtitle"), "", 200),
        "completeMessage": as_text(source.get("completeMessage"), "The draw is about to begin", 160),
        "style": as_choice(source.get("style"), COUNTDOWN_STYLES, "overlay"),
        "position": as_choice(source.get("position"), COUNTDOWN_POSITIONS, "top"),
        "units": as_choice(source.get("units"), COUNTDOWN_UNITS, "auto"),
        "screens": {screen: as_boolean(screens.get(screen), True) for screen in COUNTDOWN_SCREENS},
        "labels": {
            "days": as_text(labels.get("days"), "Days", 24),
            "hours": as_text(labels.get("hours"), "Hours", 24),
            "minutes": as_text(labels.get("minutes"), "Minutes", 24),
            "seconds": as_text(labels.get("seconds"), "Seconds", 24),
        },
        # Refuse draws from the board until the countdown is over. A signed-in
        # organiser can still draw early.
        "lockDraw": as_boolean(source.get("lockDraw"), True),
        # The last stretch is emphasised, and ticks if the tick sound is on.
        "finalSeconds": clamp_number(source.get("finalSeconds"), COUNTDOWN_LIMITS["finalSeconds"], 10),
        # How long the closing message stays up. Zero leaves it until the next
        # draw starts.
        "completeHoldSeconds": clamp_number(
            source.get("completeHoldSeconds"), COUNTDOWN_LIMITS["completeHoldSeconds"], 10
        ),
    }


def countdown_locks_draw(countdown: Dict[str, Any], now_ms: Optional[float] = None) -> bool:
    """Whether a draw from the board must wait for the countdown, right now."""
    if not countdown.get("enabled") or not countdown.get("lockDraw") or not countdown.get("targetAt"):
        return False
    target = js_date_parse(countdown["targetAt"])
    if target is None:
        return False
    current = time.time() * 1000 if now_ms is None else now_ms
    return current < target


# =============================================================== certificate

PAPER_SIZES = ("A4", "Letter")
ORIENTATIONS = ("portrait", "landscape")
MAX_SIGNATORIES = 6
MAX_CERTIFICATE_FIELDS = 8

DEFAULT_STATEMENT = (
    "This certifies that the prize draw for {event}, organised by {organization}, was conducted on {date}. "
    "{winners} winner(s) were drawn from {entries} eligible entries, as recorded below."
)

DEFAULT_METHOD = (
    "Each winner was selected by the Pickora server using a cryptographically secure random number generator, "
    "with every remaining entry equally likely. Each result was recorded the moment it was drawn and cannot be "
    "changed from the public board."
)

_REFERENCE_UNSAFE = re.compile(r"[^A-Za-z0-9-]")


def _normalize_signatories(raw: Any) -> List[Dict[str, str]]:
    entries = raw if isinstance(raw, list) else [
        {"name": "", "role": "Organiser"},
        {"name": "", "role": "Witness"},
    ]

    signatories = []
    for entry in entries:
        item = as_object(entry)
        name = as_optional_text(item.get("name"), "", 80)
        role = as_optional_text(item.get("role"), "", 80)
        if name or role:
            signatories.append({"name": name, "role": role})
    return signatories[:MAX_SIGNATORIES]


def _normalize_certificate_fields(raw: Any, data: Dict[str, Any]) -> List[str]:
    """The participant columns printed against each winner.

    Only columns the event actually has survive; with none chosen, the
    identifier and the next column are used, which is usually a ticket number
    and a name.
    """
    known = [field["key"] for field in data["fields"]]
    chosen: List[str] = []
    for key in raw if isinstance(raw, list) else []:
        if isinstance(key, str) and key in known and key not in chosen:
            chosen.append(key)
    if chosen:
        return chosen[:MAX_CERTIFICATE_FIELDS]

    fallback = [data["identifier"], *[key for key in known if key != data["identifier"]]]
    return fallback[:2]


def normalize_certificate(raw: Any, data: Dict[str, Any]) -> Dict[str, Any]:
    source = as_object(raw)

    return {
        "enabled": as_boolean(source.get("enabled"), True),
        "title": as_text(source.get("title"), "Certificate of Draw", 120),
        "subtitle": as_optional_text(source.get("subtitle"), "Official record of winners", 160),
        "referencePrefix": _REFERENCE_UNSAFE.sub("", as_text(source.get("referencePrefix"), "PK", 12)) or "PK",
        "statement": as_text(source.get("statement"), DEFAULT_STATEMENT, 1200),
        "methodText": as_text(source.get("methodText"), DEFAULT_METHOD, 1200),
        "venue": as_optional_text(source.get("venue"), "", 160),
        "footerNote": as_optional_text(source.get("footerNote"), "", 400),
        "showLogo": as_boolean(source.get("showLogo"), True),
        "showOrganization": as_boolean(source.get("showOrganization"), True),
        "showPrizes": as_boolean(source.get("showPrizes"), True),
        "showAbsent": as_boolean(source.get("showAbsent"), True),
        "showEntryCount": as_boolean(source.get("showEntryCount"), True),
        "showFingerprint": as_boolean(source.get("showFingerprint"), True),
        "showMethod": as_boolean(source.get("showMethod"), True),
        "showTimestamps": as_boolean(source.get("showTimestamps"), True),
        # Contact details on a printed page are masked to their last digits
        # unless the organiser decides the document needs them whole.
        "maskSensitive": as_boolean(source.get("maskSensitive"), True),
        "fields": _normalize_certificate_fields(source.get("fields"), data),
        "signatories": _normalize_signatories(source.get("signatories")),
        "paper": as_choice(source.get("paper"), PAPER_SIZES, "A4"),
        "orientation": as_choice(source.get("orientation"), ORIENTATIONS, "portrait"),
        # Empty is the certificate's own dark gold: a board's accent is chosen
        # for a dark screen and is usually too light to read on paper.
        "accentColor": as_color(source.get("accentColor"), ""),
    }

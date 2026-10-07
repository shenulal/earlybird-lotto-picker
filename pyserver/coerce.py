"""The small coercions every settings normaliser leans on.

Shared so the board's settings and the event features built on top of them
read stored values the same way. Mirrors ``server/coerce.js`` rule for rule —
including where JavaScript and Python disagree about what a number is, so a
hand-edited value lands on the same result under either runtime.
"""

import math
import re
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Optional, Pattern, Sequence, Tuple

# What JavaScript's Number() accepts from a string, once trimmed: a decimal
# literal with an optional exponent, or a hex, octal or binary integer. Python's
# float() also takes "1_000", "nan" and "infinity", none of which Number() reads
# as a finite number, so strings are matched here rather than handed to float().
_DECIMAL = re.compile(r"^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$", re.ASCII)
_RADIX = re.compile(r"^0([xX][0-9a-fA-F]+|[oO][0-7]+|[bB][01]+)$", re.ASCII)
_RADIX_BASES = {"x": 16, "o": 8, "b": 2}

_HEX_COLOR = re.compile(r"^#[0-9a-f]{3,8}$", re.I)


def js_number(value: Any) -> float:
    """``Number(value)`` for the shapes a JSON document can hold; NaN otherwise."""
    if isinstance(value, bool):
        return 1.0 if value else 0.0
    if isinstance(value, (int, float)):
        return float(value)
    if value is None:
        return 0.0
    if isinstance(value, str):
        trimmed = value.strip()
        if not trimmed:
            return 0.0
        if _DECIMAL.fullmatch(trimmed):
            return float(trimmed)
        radix = _RADIX.fullmatch(trimmed)
        if radix:
            return float(int(trimmed[2:], _RADIX_BASES[trimmed[1].lower()]))
        return math.nan
    return math.nan


def js_round(number: float) -> int:
    """``Math.round``: a half rounds up, where Python's round() goes to even."""
    return int(math.floor(number + 0.5))


def clamp_number(value: Any, bounds: Tuple[int, int], fallback: int) -> int:
    """A whole number inside ``bounds``, or ``fallback`` when it is not a number.

    Null, empty strings and lists are refused rather than read as zero: zero is
    often a real instruction ("no delay", "no limit"), so a missing value must
    never read as one.
    """
    numeric = isinstance(value, (bool, int, float)) or (isinstance(value, str) and value.strip() != "")
    if not numeric:
        return fallback

    number = js_number(value)
    if not math.isfinite(number):
        return fallback
    low, high = bounds
    return int(min(high, max(low, js_round(number))))


def as_boolean(value: Any, fallback: bool) -> bool:
    if isinstance(value, bool):
        return value
    if value == "true":
        return True
    if value == "false":
        return False
    return fallback


def as_choice(value: Any, choices: Sequence[Any], fallback: Any) -> Any:
    # A bool is an int in Python, so True would otherwise match a choice of 1.
    if isinstance(value, bool) and not any(isinstance(choice, bool) for choice in choices):
        return fallback
    try:
        return value if value in choices else fallback
    except TypeError:
        return fallback


def as_text(value: Any, fallback: str, max_length: int = 200) -> str:
    if not isinstance(value, str):
        return fallback
    trimmed = value.strip()
    return trimmed[:max_length] if trimmed else fallback


def as_optional_text(value: Any, fallback: str, max_length: int = 200) -> str:
    """Text that may legitimately be empty: '' is kept rather than defaulted."""
    if not isinstance(value, str):
        return fallback
    return value.strip()[:max_length]


def as_color(value: Any, fallback: str) -> str:
    """A hex colour, or ``fallback`` — empty usually means "the screen's own"."""
    if not isinstance(value, str):
        return fallback
    trimmed = value.strip()
    return trimmed if _HEX_COLOR.fullmatch(trimmed) else fallback


def as_object(value: Any) -> Dict[str, Any]:
    """An object to read from, whatever was stored."""
    return value if isinstance(value, dict) else {}


def as_id(value: Any, pattern: Pattern[str], fallback: str) -> str:
    """A stable id: lower-case letters, digits and hyphens."""
    return value if isinstance(value, str) and pattern.fullmatch(value) else fallback


def js_truthy(value: Any) -> bool:
    """JavaScript truthiness: an empty object or list is still true."""
    if value is None or value is False:
        return False
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        return value != 0 and not math.isnan(value)
    if isinstance(value, str):
        return value != ""
    return True


# The ISO 8601 forms JavaScript's Date.parse() reads: a date, optionally a time,
# optionally an offset. Its fallback parser takes looser forms as well; those
# are not mirrored, and read here as "not a date".
_ISO_DATE = re.compile(
    r"^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?"
    r"(?:T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d+))?)?(Z|[+-]\d{2}:\d{2})?)?$",
    re.ASCII,
)


def js_date_parse(value: Any) -> Optional[float]:
    """``Date.parse`` for ISO strings: milliseconds since the epoch, or None.

    Follows the same limits V8 applies — a day up to 31 in any month (it rolls
    into the next), an hour of 24 only at exactly midnight, an offset under a
    day. A date-time without an offset is a local time to JavaScript; it is read
    as UTC here, which only matters for when, never for whether.
    """
    if not isinstance(value, str):
        return None
    match = _ISO_DATE.fullmatch(value)
    if not match:
        return None

    year, month, day, hour, minute, second, fraction, offset = match.groups()
    month_number = int(month or 1)
    day_number = int(day or 1)
    hour_number, minute_number, second_number = int(hour or 0), int(minute or 0), int(second or 0)
    millis = int((fraction or "0")[:3].ljust(3, "0"))

    if not 1 <= month_number <= 12 or not 1 <= day_number <= 31:
        return None
    if minute_number > 59 or second_number > 59 or hour_number > 24:
        return None
    if hour_number == 24 and (minute_number or second_number or int(fraction or "0")):
        return None

    shift = 0
    if offset and offset != "Z":
        offset_hours, offset_minutes = int(offset[1:3]), int(offset[4:6])
        if offset_hours > 23 or offset_minutes > 59:
            return None
        shift = (offset_hours * 60 + offset_minutes) * (1 if offset[0] == "+" else -1)

    moment = (
        datetime(int(year), month_number, 1, tzinfo=timezone.utc)
        + timedelta(days=day_number - 1, hours=hour_number, minutes=minute_number - shift, seconds=second_number)
    )
    return moment.timestamp() * 1000 + millis


def js_now_iso() -> str:
    """``new Date().toISOString()``: UTC, to the millisecond, with a Z."""
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def js_base36(number: int) -> str:
    """``number.toString(36)`` for a non-negative whole number."""
    digits = "0123456789abcdefghijklmnopqrstuvwxyz"
    if number <= 0:
        return "0"
    out = ""
    while number:
        number, remainder = divmod(number, 36)
        out = digits[remainder] + out
    return out

"""Field schema and display slots.

Participants have no fixed shape. The
columns come from whatever file the organiser uploads, and the board decides
what to paint from display slots that reference those columns by key.

Mirrors ``server/schema.js`` exactly so both runtimes read the same file.
"""

import math
import re
from typing import Any, Dict, List, Optional, Sequence

MAX_FIELDS = 30
KEY_PATTERN = re.compile(r"^[a-z0-9_]{1,40}$")

EMPHASIS = ("primary", "secondary", "meta", "eyebrow")
SLOTS = ("reel", "call", "card", "panel")

MAX_LINES_PER_SLOT = 6
PANEL_ENTRY_LIMITS = (1, 500)

# Columns that usually carry personal contact details. Only used to pre-tick
# "sensitive" on import — the organiser stays in control of the final answer.
SENSITIVE_HINTS = re.compile(
    r"mobile|phone|contact|email|whatsapp|passport|emirates|id_number|address", re.I
)

# Columns that usually identify the physical ticket, tried in order. A
# sensitive column is never chosen automatically — a phone number happens to be
# unique, but it is not the thing being drawn.
IDENTIFIER_HINTS = (
    re.compile(r"ticket"),
    re.compile(r"badge|entry|registration|booking|coupon|invoice|voucher"),
    re.compile(r"^id$|_id$|^no$|_no$|_number$|_code$|_ref$|serial"),
)


def to_key(label: Any, fallback_index: int = 0) -> str:
    """Turns an arbitrary column heading into a stable, safe object key."""
    slug = re.sub(r"[^a-z0-9]+", "_", str(label or "").strip().lower())
    slug = slug.strip("_")[:40]
    return slug if KEY_PATTERN.match(slug) else f"field_{fallback_index + 1}"


def to_label(key: str) -> str:
    return " ".join(word.capitalize() for word in str(key).split("_") if word)


def normalize_field(raw: Any, index: int) -> Dict[str, Any]:
    source = raw if isinstance(raw, dict) else {"key": raw}
    candidate = source.get("key")
    key = candidate if isinstance(candidate, str) and KEY_PATTERN.match(candidate) else to_key(
        candidate or source.get("label"), index
    )

    label = source.get("label")
    sensitive = source.get("sensitive")

    return {
        "key": key,
        "label": label.strip()[:60] if isinstance(label, str) and label.strip() else to_label(key),
        "sensitive": sensitive is True or (sensitive is None and bool(SENSITIVE_HINTS.search(key))),
        "includeInExport": source.get("includeInExport") is not False,
    }


def normalize_fields(raw: Any) -> List[Dict[str, Any]]:
    items = raw if isinstance(raw, list) else []
    seen = set()
    fields: List[Dict[str, Any]] = []

    for index, entry in enumerate(items):
        field = normalize_field(entry, index)
        if field["key"] in seen or len(fields) >= MAX_FIELDS:
            continue
        seen.add(field["key"])
        fields.append(field)

    return fields


def pick_identifier(fields: Sequence[Dict[str, Any]], preferred: Optional[str]) -> str:
    keys = [field["key"] for field in fields]
    if preferred and preferred in keys:
        return preferred

    safe_keys = [field["key"] for field in fields if not field["sensitive"]]
    for pattern in IDENTIFIER_HINTS:
        match = next((key for key in safe_keys if pattern.search(key)), None)
        if match:
            return match

    if safe_keys:
        return safe_keys[0]
    return keys[0] if keys else "ticket"


def schema_from_columns(columns: Sequence[Any], previous: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    """Builds a schema from the column headings of an uploaded file."""
    previous = previous or {}
    previous_by_key = {field["key"]: field for field in (previous.get("fields") or [])}

    drafts = []
    for index, column in enumerate(columns):
        key = to_key(column, index)
        prior = previous_by_key.get(key, {})
        # Keep the organiser's own label and sensitivity choices across
        # re-imports; otherwise use the heading exactly as the file wrote it.
        draft = dict(prior)
        draft["key"] = key
        draft["label"] = prior.get("label") or (str(column).strip() or to_label(key))
        drafts.append(draft)

    fields = normalize_fields(drafts)
    return {"identifier": pick_identifier(fields, previous.get("identifier")), "fields": fields}


def _normalize_line(raw: Any, valid_keys: Sequence[str], index: int) -> Optional[Dict[str, Any]]:
    source = raw if isinstance(raw, dict) else {"field": raw}
    if source.get("field") not in valid_keys:
        return None

    emphasis = source.get("emphasis")
    return {
        "field": source["field"],
        "emphasis": emphasis if emphasis in EMPHASIS else ("primary" if index == 0 else "meta"),
        "showLabel": source.get("showLabel") is True,
    }


def _normalize_lines(raw: Any, valid_keys: Sequence[str]) -> List[Dict[str, Any]]:
    items = raw if isinstance(raw, list) else []
    seen = set()
    lines: List[Dict[str, Any]] = []

    for index, entry in enumerate(items):
        line = _normalize_line(entry, valid_keys, index)
        if not line or line["field"] in seen or len(lines) >= MAX_LINES_PER_SLOT:
            continue
        seen.add(line["field"])
        lines.append(line)

    return lines


def default_display(schema: Dict[str, Any]) -> Dict[str, Any]:
    """Sensible slots for a freshly imported schema, used when none are configured."""
    identifier = schema["identifier"]
    fields = schema["fields"]
    others = [field for field in fields if field["key"] != identifier]
    visible = [field for field in others if not field["sensitive"]]
    headline = visible[0] if visible else None
    rest = visible[1:]

    def line(key: Optional[str], emphasis: str) -> List[Dict[str, Any]]:
        return [{"field": key, "emphasis": emphasis, "showLabel": False}] if key else []

    return {
        "reel": {"lines": line(identifier, "primary")},
        "call": {"lines": line(identifier, "primary")},
        "card": {
            "lines": line(headline["key"] if headline else None, "primary")
            + line(identifier, "secondary")
            + [{"field": f["key"], "emphasis": "meta", "showLabel": False} for f in rest[:2]]
        },
        "panel": {
            "lines": line(identifier, "eyebrow")
            + line(headline["key"] if headline else None, "primary")
            + [{"field": f["key"], "emphasis": "meta", "showLabel": False} for f in rest[:1]],
            "maxEntries": 50,
        },
    }


def _clamp_entries(value: Any, fallback: int) -> int:
    if isinstance(value, (list, dict)) or value is None:
        return fallback
    try:
        number = float(value)
    except (TypeError, ValueError):
        return fallback
    if number != number or number in (float("inf"), float("-inf")):
        return fallback
    low, high = PANEL_ENTRY_LIMITS
    # Rounded the way JavaScript rounds, so a half lands on the same integer.
    return int(min(high, max(low, math.floor(number + 0.5))))


def normalize_display(raw: Any, schema: Dict[str, Any]) -> Dict[str, Any]:
    source = raw if isinstance(raw, dict) else {}
    valid_keys = [field["key"] for field in schema["fields"]]
    defaults = default_display(schema)

    display: Dict[str, Any] = {}
    for slot in SLOTS:
        configured = _normalize_lines((source.get(slot) or {}).get("lines"), valid_keys)
        # An empty slot would leave a blank screen on stage, so fall back.
        display[slot] = {"lines": configured or defaults[slot]["lines"]}

    display["panel"]["maxEntries"] = _clamp_entries(
        (source.get("panel") or {}).get("maxEntries"), defaults["panel"]["maxEntries"]
    )
    return display


def public_field_keys(display: Dict[str, Any]) -> List[str]:
    """Every field key the public board is allowed to receive."""
    keys: List[str] = []
    for slot in SLOTS:
        for line in display[slot]["lines"]:
            if line["field"] not in keys:
                keys.append(line["field"])
    return keys


def project_record(record: Dict[str, Any], keys: Sequence[str]) -> Dict[str, Any]:
    return {key: record[key] for key in keys if key in record}

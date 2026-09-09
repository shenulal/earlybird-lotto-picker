"""Participant file parsing, normalization and export."""

import csv
import io
import json
from typing import Any, Dict, List, Optional, Sequence, Tuple

from . import schema
from .paths import TICKETS_PATH
from .store import read_json, write_json

MAX_TICKETS = 100000
FIELD_LIMIT = 300


def _trim(value: Any) -> str:
    if value is None:
        return ""
    return str(value).strip()[:FIELD_LIMIT]


def read_csv(text: str) -> Dict[str, Any]:
    """CSV keeps whatever columns the file declares; the header row names them."""
    rows = [row for row in csv.reader(io.StringIO(text)) if any(cell.strip() for cell in row)]
    if not rows:
        return {"columns": [], "records": []}

    columns = [cell.strip() or f"Column {index + 1}" for index, cell in enumerate(rows[0])]
    keys = [schema.to_key(column, index) for index, column in enumerate(columns)]

    records = [
        {key: _trim(cells[index]) if index < len(cells) else "" for index, key in enumerate(keys)}
        for cells in rows[1:]
    ]
    return {"columns": columns, "records": records}


def read_json_upload(text: str) -> Dict[str, Any]:
    """JSON keeps the union of every key present, in first-seen order."""
    parsed = json.loads(text)
    if isinstance(parsed, list):
        items = parsed
    elif isinstance(parsed, dict) and isinstance(parsed.get("tickets"), list):
        items = parsed["tickets"]
    else:
        raise ValueError('JSON must be an array of records or an object with a "tickets" array')

    columns: List[str] = []
    records: List[Dict[str, str]] = []

    for entry in items:
        if not isinstance(entry, dict):
            records.append({})
            continue
        record: Dict[str, str] = {}
        for raw_key, value in entry.items():
            if raw_key == "processed":
                continue
            key = schema.to_key(raw_key, len(columns))
            if key not in columns:
                columns.append(key)
            record[key] = _trim(value)
        records.append(record)

    return {"columns": columns, "records": records}


def normalize_records(
    records: Sequence[Any], ticket_schema: Dict[str, Any], duplicate_policy: str = "skip"
) -> Tuple[List[Dict[str, Any]], Dict[str, Any]]:
    """Coerce raw records against a schema, reporting what had to be dropped."""
    keys = [field["key"] for field in ticket_schema["fields"]]
    identifier = ticket_schema["identifier"]
    seen = set()
    accepted: List[Dict[str, Any]] = []
    issues = {"missingIdentifier": 0, "duplicates": 0, "truncated": False}

    for entry in records:
        if not isinstance(entry, dict):
            issues["missingIdentifier"] += 1
            continue

        identity = _trim(entry.get(identifier))
        if not identity:
            issues["missingIdentifier"] += 1
            continue

        seen_key = identity.lower()
        if seen_key in seen:
            issues["duplicates"] += 1
            if duplicate_policy == "skip":
                continue

        if len(accepted) >= MAX_TICKETS:
            issues["truncated"] = True
            continue

        seen.add(seen_key)
        accepted.append({key: _trim(entry.get(key)) for key in keys})

    return accepted, issues


def parse_upload(content: Any, fmt: Any = None, previous_schema: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    """Parses an uploaded file and derives the schema its columns imply."""
    text = str(content or "").strip()
    if not text:
        raise ValueError("The uploaded file is empty")

    looks_like_json = text.startswith("{") or text.startswith("[")
    resolved = fmt if fmt in ("csv", "json") else ("json" if looks_like_json else "csv")
    parsed = read_json_upload(text) if resolved == "json" else read_csv(text)

    if not parsed["columns"]:
        raise ValueError("No columns were found in that file.")

    return {
        "format": resolved,
        "columns": parsed["columns"],
        "records": parsed["records"],
        "schema": schema.schema_from_columns(parsed["columns"], previous_schema or {}),
    }


def infer_schema_from_file() -> Optional[Dict[str, Any]]:
    """Read the column names actually present in the participant file.

    Used to derive a schema when none is configured yet, so a fresh install
    adopts whatever shape the organiser's data already has.
    """
    data = read_json(TICKETS_PATH, {"tickets": []}) or {}
    records = data if isinstance(data, list) else data.get("tickets") or []

    columns: List[str] = []
    for record in records[:50]:
        if not isinstance(record, dict):
            continue
        for key in record:
            if key != "processed" and key not in columns:
                columns.append(key)

    return schema.schema_from_columns(columns) if columns else None


def load_ticket_source(ticket_schema: Dict[str, Any], duplicate_policy: str = "skip") -> Dict[str, Any]:
    data = read_json(TICKETS_PATH, {"tickets": []}) or {}
    records = data if isinstance(data, list) else data.get("tickets") or []
    tickets, issues = normalize_records(records, ticket_schema, duplicate_policy)
    return {"tickets": tickets, "issues": issues, "rawCount": len(records)}


def save_tickets(tickets: Sequence[Dict[str, Any]]) -> None:
    write_json(TICKETS_PATH, {"tickets": list(tickets)})


def to_csv(rows: Sequence[Dict[str, Any]], columns: Sequence[Tuple[str, str]]) -> str:
    buffer = io.StringIO()
    writer = csv.writer(buffer, lineterminator="\n")
    writer.writerow([label for _key, label in columns])
    for row in rows:
        writer.writerow([row.get(key, "") for key, _label in columns])
    return buffer.getvalue()

"""Atomic JSON persistence shared by every server-side module."""

import json
import os
import tempfile
from pathlib import Path
from typing import Any


class StorageError(Exception):
    """Raised when a data file cannot be read or written."""


def read_json(path: Path, fallback: Any = None) -> Any:
    try:
        with path.open("r", encoding="utf-8") as handle:
            return json.load(handle)
    except FileNotFoundError:
        if fallback is not None:
            return fallback
        raise StorageError(f"{path.name} does not exist")
    except json.JSONDecodeError as error:
        raise StorageError(f"{path.name} is not valid JSON") from error
    except OSError as error:
        if fallback is not None:
            return fallback
        raise StorageError(f"Unable to read {path.name}") from error


def write_json(path: Path, data: Any) -> None:
    """Write via a same-directory temp file so a crash cannot truncate the original."""
    handle = None
    temp_path = None
    try:
        descriptor, temp_name = tempfile.mkstemp(dir=str(path.parent), prefix=f".{path.name}.")
        temp_path = Path(temp_name)
        handle = os.fdopen(descriptor, "w", encoding="utf-8")
        json.dump(data, handle, indent=2, ensure_ascii=False)
        handle.write("\n")
        handle.close()
        handle = None
        os.replace(temp_path, path)
        temp_path = None
    except OSError as error:
        raise StorageError(
            f"Cannot write {path.name} — the application directory is read-only. "
            "Deploy to a host with a writable filesystem or mount a persistent volume."
        ) from error
    finally:
        if handle is not None:
            handle.close()
        if temp_path is not None and temp_path.exists():
            temp_path.unlink(missing_ok=True)

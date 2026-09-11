"""Image validation and asset storage.

Deliberately dependency-free: the project ships with no image library, and the
alternative is trusting a client-declared size. Mirrors ``server/images.js``.
"""

import base64
import hashlib
import re
import struct
from pathlib import Path
from typing import Any, Dict, Optional

from .paths import ROOT_DIR

MAX_BYTES = 10 * 1024 * 1024

# CHANGED: a backdrop is allowed to be much larger than anything else, because
# it is the one image chosen straight out of a camera roll. The console shrinks
# one that big to the size a screen can actually show before sending it, so what
# arrives here is small whatever the organiser picked. This is the safety net
# behind that, for anything posted another way.
MAX_UPLOAD_BYTES = 10 * 1024 * 1024

MIN_DIMENSION = 16
MAX_DIMENSION = 8000


def max_bytes_for(kind: str) -> int:
    return max(MAX_BYTES, MAX_UPLOAD_BYTES) if kind == "background" else MAX_BYTES

EXTENSIONS = {"png": ".png", "jpeg": ".jpg", "gif": ".gif", "webp": ".webp", "svg": ".svg"}

DATA_URL = re.compile(r"^data:([^;,]+);base64,(.+)$", re.S)
PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"


def probe_image(buffer: bytes) -> Optional[Dict[str, Any]]:
    """Reads width/height straight from the file header."""
    if len(buffer) < 16:
        return None

    # PNG: 8-byte signature, then an IHDR chunk carrying the dimensions.
    if buffer[:8] == PNG_SIGNATURE:
        width, height = struct.unpack(">II", buffer[16:24])
        return {"format": "png", "width": width, "height": height}

    # GIF87a / GIF89a: little-endian dimensions at byte 6.
    if buffer[:3] == b"GIF":
        width, height = struct.unpack("<HH", buffer[6:10])
        return {"format": "gif", "width": width, "height": height}

    # RIFF....WEBP — three sub-formats, each storing size differently.
    if buffer[:4] == b"RIFF" and buffer[8:12] == b"WEBP":
        chunk = buffer[12:16]
        if chunk == b"VP8X":
            width = 1 + int.from_bytes(buffer[24:27], "little")
            height = 1 + int.from_bytes(buffer[27:30], "little")
            return {"format": "webp", "width": width, "height": height}
        if chunk == b"VP8L":
            bits = struct.unpack("<I", buffer[21:25])[0]
            return {"format": "webp", "width": 1 + (bits & 0x3FFF), "height": 1 + ((bits >> 14) & 0x3FFF)}
        if chunk == b"VP8 ":
            width = struct.unpack("<H", buffer[26:28])[0] & 0x3FFF
            height = struct.unpack("<H", buffer[28:30])[0] & 0x3FFF
            return {"format": "webp", "width": width, "height": height}
        return None

    # JPEG: walk the marker segments to the start-of-frame that holds the size.
    if buffer[0] == 0xFF and buffer[1] == 0xD8:
        offset = 2
        while offset + 9 < len(buffer):
            if buffer[offset] != 0xFF:
                offset += 1
                continue
            marker = buffer[offset + 1]
            if 0xC0 <= marker <= 0xCF and marker not in (0xC4, 0xC8, 0xCC):
                height, width = struct.unpack(">HH", buffer[offset + 5 : offset + 9])
                return {"format": "jpeg", "width": width, "height": height}
            offset += 2 + struct.unpack(">H", buffer[offset + 2 : offset + 4])[0]
        return None

    # SVG has no pixel dimensions; it scales, so it is accepted without them.
    head = buffer[:1024].decode("utf-8", errors="ignore")
    if re.search(r"<svg[\s>]", head, re.I):
        return {"format": "svg", "width": None, "height": None}

    return None


def _decode_data_url(content: Any) -> bytes:
    match = DATA_URL.match(str(content or ""))
    if not match:
        raise ValueError("The image could not be read.")
    try:
        return base64.b64decode(match.group(2), validate=False)
    except Exception as error:  # noqa: BLE001 - malformed client payload
        raise ValueError("The image could not be read.") from error


def save_image_asset(kind: str, content: Any, original_name: Any = "") -> Dict[str, Any]:
    """Validates and stores an uploaded image, returning its public path."""
    buffer = _decode_data_url(content)

    ceiling = max_bytes_for(kind)
    if len(buffer) > ceiling:
        raise ValueError(
            f"That image is {len(buffer) / 1048576:.1f} MB — the limit is {ceiling / 1048576:.0f} MB."
        )

    info = probe_image(buffer)
    if not info:
        raise ValueError("That file is not a PNG, JPEG, GIF, WebP or SVG image.")

    if info["width"] is not None:
        if info["width"] < MIN_DIMENSION or info["height"] < MIN_DIMENSION:
            raise ValueError(f"That image is only {info['width']}×{info['height']}px — too small to display.")
        if info["width"] > MAX_DIMENSION or info["height"] > MAX_DIMENSION:
            raise ValueError(
                f"That image is {info['width']}×{info['height']}px — the limit is {MAX_DIMENSION}px on a side."
            )

    directory = ROOT_DIR / "assets"
    directory.mkdir(parents=True, exist_ok=True)

    digest = hashlib.sha1(buffer).hexdigest()[:10]
    file_name = f"{kind}-{digest}{EXTENSIONS[info['format']]}"
    (directory / file_name).write_bytes(buffer)

    return {
        "src": f"assets/{file_name}",
        "format": info["format"],
        "width": info["width"],
        "height": info["height"],
        "bytes": len(buffer),
        "originalName": str(original_name or "")[:120],
    }


def remove_image_asset(src: Any) -> None:
    """Removes a previously uploaded asset, ignoring anything outside assets/."""
    if not isinstance(src, str) or not src.startswith("assets/") or ".." in src:
        return
    target = Path(ROOT_DIR / src)
    target.unlink(missing_ok=True)

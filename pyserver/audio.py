"""Audio upload validation and storage.

Audio is stored exactly as images are: under ``assets/``, named by a hash of
its content, so the same file uploaded twice is one file and a name can be
checked against what it holds. Mirrors ``server/audio.js``.
"""

import base64
import binascii
import hashlib
import re
from typing import Any, Dict, Optional

from .paths import ROOT_DIR

EXTENSIONS = {
    "mp3": ".mp3",
    "ogg": ".ogg",
    "wav": ".wav",
    "m4a": ".m4a",
    "aac": ".aac",
    "flac": ".flac",
    "webm": ".webm",
}

MIN_BYTES = 256

# The deployment's ceiling for a stored file. Python always writes to the
# filesystem, so this is the filesystem driver's figure in server/store.js.
MAX_BLOB_BYTES = 10 * 1024 * 1024

DATA_URL = re.compile(r"^data:([^;,]*)(;[^,]*)?;base64,(.+)$", re.S)
_BASE64_NOISE = re.compile(rb"[^A-Za-z0-9+/]")


def decode_base64(text: Any) -> Optional[bytes]:
    """Base64 read as leniently as Node's ``Buffer.from(text, 'base64')``.

    Characters outside the alphabet are skipped, URL-safe ones accepted and the
    padding is optional; anything left over that cannot form a byte is dropped.
    """
    if not isinstance(text, str):
        return None
    raw = text.encode("ascii", "ignore").replace(b"-", b"+").replace(b"_", b"/")
    cleaned = _BASE64_NOISE.sub(b"", raw.split(b"=")[0])
    usable = len(cleaned) - (len(cleaned) % 4 == 1)
    cleaned = cleaned[:usable]
    try:
        return base64.b64decode(cleaned + b"=" * (-len(cleaned) % 4))
    except (binascii.Error, ValueError):
        return None


def probe_audio(buffer: bytes) -> Optional[str]:
    """Recognises an audio file from its first bytes.

    Deliberately dependency-free, like the image probe: the file's own header
    is trusted, never the name or the type the browser declared.
    """
    if not isinstance(buffer, (bytes, bytearray)) or len(buffer) < 12:
        return None

    if buffer[:3] == b"ID3":
        return "mp3"
    # MPEG audio frame: eleven sync bits, then a layer that is not "reserved".
    if buffer[0] == 0xFF and (buffer[1] & 0xE0) == 0xE0 and (buffer[1] & 0x06) != 0:
        return "mp3"
    # ADTS (raw AAC) shares the sync word, with its layer bits always zero.
    if buffer[0] == 0xFF and (buffer[1] & 0xF6) == 0xF0:
        return "aac"
    if buffer[:4] == b"OggS":
        return "ogg"
    if buffer[:4] == b"RIFF" and buffer[8:12] == b"WAVE":
        return "wav"
    if buffer[:4] == b"fLaC":
        return "flac"
    if buffer[4:8] == b"ftyp":
        return "m4a"
    if buffer[:4] == b"\x1a\x45\xdf\xa3":
        return "webm"
    return None


def _decode_data_url(content: Any) -> bytes:
    match = DATA_URL.match(str(content or ""))
    decoded = decode_base64(match.group(3)) if match else None
    if decoded is None:
        raise ValueError("The audio file could not be read.")
    return decoded


def _describe_bytes(count: int) -> str:
    return f"{count / 1048576:.1f} MB"


def audio_file_name(buffer: bytes, audio_format: str) -> str:
    """The name an audio file is stored under: its kind, its hash, its format."""
    digest = hashlib.sha1(buffer).hexdigest()[:10]
    return f"audio-{digest}{EXTENSIONS[audio_format]}"


def save_audio_asset(content: Any, original_name: Any = "") -> Dict[str, Any]:
    """Validates and stores an uploaded audio file, returning its public path."""
    buffer = _decode_data_url(content)

    if len(buffer) > MAX_BLOB_BYTES:
        raise ValueError(
            f"That file is {_describe_bytes(len(buffer))} — the limit is "
            f"{_describe_bytes(MAX_BLOB_BYTES)} on this deployment."
        )
    if len(buffer) < MIN_BYTES:
        raise ValueError("That file is too small to be audio.")

    audio_format = probe_audio(buffer)
    if not audio_format:
        raise ValueError("That file is not an MP3, M4A, AAC, OGG, WAV, FLAC or WebM audio file.")

    file_name = audio_file_name(buffer, audio_format)
    directory = ROOT_DIR / "assets"
    directory.mkdir(parents=True, exist_ok=True)
    (directory / file_name).write_bytes(buffer)

    return {
        "src": f"assets/{file_name}",
        "format": audio_format,
        "bytes": len(buffer),
        "originalName": str(original_name or "")[:120],
    }

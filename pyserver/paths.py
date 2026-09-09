"""Filesystem locations and the deny-list used by the static file route."""

from pathlib import Path

ROOT_DIR = Path(__file__).resolve().parent.parent

SETTINGS_PATH = ROOT_DIR / "appsettings.json"
SETTINGS_SAMPLE_PATH = ROOT_DIR / "appsettings.sample.json"
TICKETS_PATH = ROOT_DIR / "tickets.json"
DRAW_STATE_PATH = ROOT_DIR / "winners.json"

# appsettings.json holds the hashed admin credentials and winners.json holds
# the contact details of everyone drawn so far; neither may be served as a
# static asset.
PROTECTED_FILES = (
    "appsettings.json",
    "winners.json",
    "package.json",
    "package-lock.json",
    "requirements.txt",
)

PROTECTED_DIRS = ("server", "pyserver", "windows", ".git", "node_modules", ".playwright-mcp")


def is_protected_path(request_path: str) -> bool:
    normalized = (request_path or "").lstrip("/").split("?")[0].lower()
    if not normalized:
        return False
    if normalized in {name.lower() for name in PROTECTED_FILES}:
        return True
    return normalized.split("/")[0] in PROTECTED_DIRS

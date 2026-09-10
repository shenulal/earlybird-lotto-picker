"""Filesystem locations and the deny-list used by the static file route."""

from pathlib import Path

ROOT_DIR = Path(__file__).resolve().parent.parent

SETTINGS_PATH = ROOT_DIR / "appsettings.json"
SETTINGS_SAMPLE_PATH = ROOT_DIR / "appsettings.sample.json"
TICKETS_PATH = ROOT_DIR / "tickets.json"
DRAW_STATE_PATH = ROOT_DIR / "winners.json"

# appsettings.json holds the hashed admin credentials, winners.json the contact
# details of everyone drawn so far and tickets.json those of everyone entered;
# none of them may be served as a static asset.
PROTECTED_FILES = (
    "appsettings.json",
    "winners.json",
    # FIX: tickets.json was served as a static file, so the whole entry list —
    # names, companies and the columns marked sensitive, such as phone numbers —
    # could be downloaded by anyone who guessed the URL. The board never needs
    # it: it reads entries through /api/pool, which strips non-display fields.
    "tickets.json",
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

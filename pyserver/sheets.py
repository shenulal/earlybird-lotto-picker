"""Reads an entry list straight out of a Google Sheet.

The sheet is fetched as CSV and handed to the same parser a file upload goes
through, so a linked sheet and an uploaded file behave identically: the first
row names the columns, and one of them identifies the entry.

Only a URL built here is ever requested — the address the organiser pasted is
mined for a spreadsheet id and then discarded, so this cannot be pointed at
anything but Google's own export endpoint.

Mirrors ``server/sheets.js`` so either runtime behaves the same.
"""

from __future__ import annotations

import re
import urllib.error
import urllib.request
from typing import Any, Dict
from urllib.parse import urlparse

MAX_BYTES = 8 * 1024 * 1024
TIMEOUT_SECONDS = 20

# Google answers an export with a redirect to its own file hosts.
ALLOWED_HOSTS = re.compile(r"(^|\.)(google\.com|googleusercontent\.com)$")

# A normal sheet: /spreadsheets/d/<id>/edit#gid=0
SHEET_ID = re.compile(r"/spreadsheets/d/([A-Za-z0-9_-]{16,})")
# One published to the web: /spreadsheets/d/e/<token>/pubhtml
PUBLISHED_ID = re.compile(r"/spreadsheets/d/e/([A-Za-z0-9_-]{16,})")
# The tab, which appears in the fragment as often as in the query.
TAB_ID = re.compile(r"[#?&]gid=([0-9]+)")
# Someone may paste the id on its own rather than the whole address.
BARE_ID = re.compile(r"^[A-Za-z0-9_-]{16,}$")

PRIVATE_MESSAGE = (
    "That sheet is private. In Google Sheets choose Share → General access → "
    "Anyone with the link → Viewer, then try again."
)


class SheetError(Exception):
    """A problem the organiser can act on, carrying the status to answer with."""

    def __init__(self, message: str, status: int = 400) -> None:
        super().__init__(message)
        self.status = status


def export_url_for(value: Any) -> str:
    """Turn whatever the organiser pasted into Google's CSV export address.

    Accepts an edit link, a sharing link, a published-to-web link or a bare
    spreadsheet id, with or without a tab.
    """
    text = str(value or "").strip()
    if not text:
        raise SheetError("Paste the link to your Google Sheet.")

    tab = TAB_ID.search(text)
    gid = f"&gid={tab.group(1)}" if tab else ""

    published = PUBLISHED_ID.search(text)
    if published:
        return f"https://docs.google.com/spreadsheets/d/e/{published.group(1)}/pub?output=csv{gid}"

    sheet = SHEET_ID.search(text)
    if sheet:
        return f"https://docs.google.com/spreadsheets/d/{sheet.group(1)}/export?format=csv{gid}"

    if BARE_ID.match(text):
        return f"https://docs.google.com/spreadsheets/d/{text}/export?format=csv{gid}"

    raise SheetError(
        "That does not look like a Google Sheets link. Copy the address from "
        "the browser while the sheet is open."
    )


class _GoogleOnlyRedirects(urllib.request.HTTPRedirectHandler):
    """Follows Google's redirects, refusing to leave its own hosts."""

    def redirect_request(self, req, fp, code, msg, headers, newurl):  # noqa: D102
        if not ALLOWED_HOSTS.search(urlparse(newurl).hostname or ""):
            raise SheetError("Entry data is only ever fetched from Google Sheets.")
        return super().redirect_request(req, fp, code, msg, headers, newurl)


def fetch_sheet_csv(value: Any) -> Dict[str, str]:
    """Fetch a sheet and return it as CSV text, ready for the upload parser.

    Returns the canonical export address alongside it, which is what gets
    remembered so the list can be pulled again without pasting the link twice.
    """
    url = export_url_for(value)
    opener = urllib.request.build_opener(_GoogleOnlyRedirects)
    request = urllib.request.Request(url, headers={"Accept": "text/csv,*/*", "User-Agent": "Pickora"})

    try:
        with opener.open(request, timeout=TIMEOUT_SECONDS) as response:
            raw = response.read(MAX_BYTES + 1)
            content_type = response.headers.get("Content-Type", "")
    except urllib.error.HTTPError as error:
        if error.code in (401, 403):
            raise SheetError(PRIVATE_MESSAGE) from error
        if error.code == 404:
            raise SheetError(
                "No sheet was found at that link. Check the address, and the tab it points at."
            ) from error
        raise SheetError(f"Google Sheets answered with {error.code}.", status=502) from error
    except urllib.error.URLError as error:
        raise SheetError(
            "Google Sheets could not be reached. Check the connection — on an "
            "offline machine, import a CSV file instead.",
            status=502,
        ) from error
    except TimeoutError as error:
        raise SheetError("Google Sheets did not answer in time.", status=504) from error

    if len(raw) > MAX_BYTES:
        raise SheetError("That sheet is larger than 8 MB.")

    body = raw.decode("utf-8", errors="replace")

    # A sheet that is not shared answers 200 with the sign-in page rather than
    # an error, so the body has to be checked as well as the status.
    if "text/html" in content_type.lower() or re.match(r"\s*<(!doctype|html)", body, re.IGNORECASE):
        raise SheetError(PRIVATE_MESSAGE)

    if not body.strip():
        raise SheetError("That sheet is empty. The first row must name the columns.")

    return {"content": body, "url": url}

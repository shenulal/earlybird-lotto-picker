"""NEW: an identifier that changes whenever the served code changes.

Mirrors ``server/build.js``. Everything about not serving people stale code
hangs off this: asset URLs carry it, so a new build cannot reuse an old cache
entry, and a page left open on a projector compares it against the running
build to know it should reload.

The files themselves are hashed once at start-up rather than trusting their
modification times, because a deployment platform may well normalise those —
which is the bug this module exists to prevent.
"""

from __future__ import annotations

import hashlib
import os
import re
from typing import Dict

from .paths import ROOT_DIR

# The files a browser caches and would otherwise keep across a deployment.
HASHED = (
    "index.html",
    "admin.html",
    "welcome.html",
    "prizes.html",
    "styles.css",
    "admin.css",
    "api.js",
    "theme.js",
    "script.js",
    "confetti.js",
    "reel.js",
    "qr.js",
    "social.js",
    "carousel.js",
    "feature-page.js",
    "admin.js",
    "admin-config.js",
)

VERSION_PARAM = "v"

# Local scripts, styles and icons; anything absolute is somebody else's.
_ASSET = re.compile(r'\b(src|href)="((?!https?:|//|data:|mailto:|#)[^"?#]+\.(?:js|css|png|jpe?g|svg|ico))"')


def _hash_files() -> str:
    digest = hashlib.sha1()
    for name in HASHED:
        digest.update(name.encode("utf-8"))
        try:
            digest.update((ROOT_DIR / name).read_bytes())
        except OSError:
            # A file that is not there contributes its absence and nothing else.
            digest.update(b"missing")
    return digest.hexdigest()[:12]


def _resolve_build() -> str:
    commit = os.environ.get("VERCEL_GIT_COMMIT_SHA") or os.environ.get("PICKORA_BUILD") or ""
    return commit[:12] if commit else _hash_files()


BUILD = _resolve_build()

_pages: Dict[str, str] = {}


def stamp_html(html: str) -> str:
    """Rewrite a page so every asset it pulls in carries the current build.

    A new deployment therefore asks for different URLs, and no cache anywhere —
    the browser's, a proxy's, or a CDN edge's — can answer with the previous
    build's file, whatever it believes about freshness.
    """
    stamped = _ASSET.sub(lambda m: f'{m.group(1)}="{m.group(2)}?{VERSION_PARAM}={BUILD}"', html)
    # The page also states its own build, so one left open can tell when it has
    # been superseded.
    return re.sub(r"<head>", f'<head>\n  <meta name="pickora-build" content="{BUILD}">', stamped, count=1, flags=re.I)


def page(file_name: str) -> str:
    """The stamped markup for a page, rewritten once per build."""
    if file_name not in _pages:
        _pages[file_name] = stamp_html((ROOT_DIR / file_name).read_text(encoding="utf-8"))
    return _pages[file_name]

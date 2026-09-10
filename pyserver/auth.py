"""Credential hashing and login throttling.

The PBKDF2 parameters mirror ``server/auth.js`` exactly, so a single
``appsettings.json`` works under both the Flask and the Express deployment.
"""

import hashlib
import hmac
import os
import secrets
import time
from typing import Dict, Optional

PBKDF2_ITERATIONS = 120000
PBKDF2_KEYLEN = 32
SALT_BYTES = 16

# Long enough to cover setting up days before an event and still be signed in
# on the night. Override with SESSION_TTL_HOURS.
SESSION_TTL_HOURS = min(max(int(os.environ.get("SESSION_TTL_HOURS") or 24 * 14), 1), 24 * 90)
SESSION_TTL_SECONDS = SESSION_TTL_HOURS * 60 * 60
MAX_LOGIN_ATTEMPTS = 8
LOGIN_WINDOW_SECONDS = 15 * 60


def hash_password(password: str, salt: Optional[str] = None) -> Dict[str, object]:
    resolved_salt = salt or secrets.token_hex(SALT_BYTES)
    derived = hashlib.pbkdf2_hmac(
        "sha256",
        password.encode("utf-8"),
        resolved_salt.encode("utf-8"),
        PBKDF2_ITERATIONS,
        PBKDF2_KEYLEN,
    )
    return {
        "algorithm": "pbkdf2-sha256",
        "iterations": PBKDF2_ITERATIONS,
        "salt": resolved_salt,
        "hash": derived.hex(),
    }


def verify_password(password: str, credential: Optional[Dict[str, object]]) -> bool:
    if not credential or not credential.get("salt") or not credential.get("hash"):
        return False

    try:
        expected = bytes.fromhex(str(credential["hash"]))
    except ValueError:
        return False

    iterations = int(credential.get("iterations") or PBKDF2_ITERATIONS)
    actual = hashlib.pbkdf2_hmac(
        "sha256",
        password.encode("utf-8"),
        str(credential["salt"]).encode("utf-8"),
        iterations,
        len(expected) or PBKDF2_KEYLEN,
    )
    return hmac.compare_digest(expected, actual)


class LoginThrottle:
    """In-memory attempt counter, scoped to one running process."""

    def __init__(self) -> None:
        self._attempts: Dict[str, Dict[str, float]] = {}

    def register_failure(self, client_key: str) -> None:
        now = time.time()
        entry = self._attempts.get(client_key)
        if not entry or now - entry["first_attempt_at"] > LOGIN_WINDOW_SECONDS:
            self._attempts[client_key] = {"count": 1, "first_attempt_at": now}
            return
        self._attempts[client_key] = {
            "count": entry["count"] + 1,
            "first_attempt_at": entry["first_attempt_at"],
        }

    def clear(self, client_key: str) -> None:
        self._attempts.pop(client_key, None)

    def is_locked_out(self, client_key: str) -> bool:
        entry = self._attempts.get(client_key)
        if not entry:
            return False
        if time.time() - entry["first_attempt_at"] > LOGIN_WINDOW_SECONDS:
            self._attempts.pop(client_key, None)
            return False
        return entry["count"] >= MAX_LOGIN_ATTEMPTS


_EPHEMERAL_SECRET = secrets.token_hex(32)


def session_secret(credential: Optional[Dict[str, object]] = None) -> str:
    """The key that signs session cookies.

    Derived from the stored credential when ``SESSION_SECRET`` is not set, so
    every worker process agrees without any configuration — a per-process
    random key signs people out as soon as a second worker serves a request.
    Changing the password rotates the key, which correctly ends older sessions.
    """
    configured = os.environ.get("SESSION_SECRET")
    if configured:
        return configured

    if credential and credential.get("hash") and credential.get("salt"):
        seed = f"pickora:{credential['salt']}:{credential['hash']}"
        return hashlib.sha256(seed.encode("utf-8")).hexdigest()

    return _EPHEMERAL_SECRET

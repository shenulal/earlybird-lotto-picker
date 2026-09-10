"""Flask entry point for Pickora.

Serves the public draw board, the organiser console at /admin, and the JSON
API in :mod:`pyserver.routes`. Mirrors ``server.js`` so either runtime can be
deployed against the same data files.
"""

import os
from datetime import timedelta

from flask import Flask, abort, send_from_directory

from pyserver.auth import SESSION_TTL_SECONDS, session_secret
from pyserver.paths import ROOT_DIR, is_protected_path
from pyserver.routes import api
from pyserver.settings import DEFAULT_ADMIN_PASSWORD, DEFAULT_ADMIN_USERNAME, ensure_admin_credentials

app = Flask(__name__, static_folder=None)
app.permanent_session_lifetime = timedelta(seconds=SESSION_TTL_SECONDS)
app.config.update(SESSION_COOKIE_HTTPONLY=True, SESSION_COOKIE_SAMESITE="Lax")
app.register_blueprint(api, url_prefix="/api")


@app.after_request
def apply_security_headers(response):
    response.headers.setdefault("X-Content-Type-Options", "nosniff")
    response.headers.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
    response.headers.setdefault("X-Frame-Options", "SAMEORIGIN")
    return response


@app.get("/")
def index():
    return send_from_directory(ROOT_DIR, "index.html")


@app.get("/admin")
def admin():
    return send_from_directory(ROOT_DIR, "admin.html")


# Extensionless routes for the screens an organiser links to or projects.
@app.get("/welcome")
def welcome_page():
    return send_from_directory(ROOT_DIR, "welcome.html")


@app.get("/prizes")
def prizes_page():
    return send_from_directory(ROOT_DIR, "prizes.html")


@app.get("/<path:filename>")
def serve_static(filename: str):
    # appsettings.json carries the hashed admin credentials and winners.json the
    # details of everyone drawn, so both are refused here.
    if is_protected_path(filename):
        abort(404)

    target = (ROOT_DIR / filename).resolve()
    if not target.is_file() or ROOT_DIR not in target.parents:
        return send_from_directory(ROOT_DIR, "index.html")

    return send_from_directory(ROOT_DIR, filename)


def configure_session_key() -> None:
    """Derived from the stored credential so every worker signs alike."""
    credential = ensure_admin_credentials()["settingsFile"].get("adminAuth")
    app.secret_key = session_secret(credential)


def report_credential_status() -> None:
    try:
        status = ensure_admin_credentials()
        if status["created"]:
            print(f"🔐 Admin account created: {DEFAULT_ADMIN_USERNAME} / {DEFAULT_ADMIN_PASSWORD}")
        if status["usingDefaults"]:
            print("⚠️  The admin console is still using the default password. Change it at /admin.")
    except Exception as error:  # noqa: BLE001 - startup diagnostics only
        print(f"⚠️  Could not prepare admin credentials: {error}")


configure_session_key()
report_credential_status()


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    print(f"🎰 Pickora running on http://localhost:{port}/")
    print(f"🛠️  Organiser console: http://localhost:{port}/admin")
    app.run(host="0.0.0.0", port=port, debug=False)

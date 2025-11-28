"""Session management for multi-user support."""
from __future__ import annotations

import os
import secrets
from pathlib import Path
from typing import Optional

from fastapi import Request, Response
from itsdangerous import URLSafeTimedSerializer, BadSignature, SignatureExpired


# Session configuration
SESSION_COOKIE_NAME = "smart_calendar_session"
SESSION_MAX_AGE = 60 * 60 * 24 * 30  # 30 days


def get_secret_key() -> str:
    """Get or generate a secret key for session signing."""
    secret = os.environ.get("SESSION_SECRET_KEY")
    if not secret:
        # For local development, use a fixed key
        # In production, this MUST be set as an environment variable
        secret = "dev-secret-key-change-in-production"
    return secret


def get_serializer() -> URLSafeTimedSerializer:
    """Get the session serializer."""
    return URLSafeTimedSerializer(get_secret_key())


def create_session_id() -> str:
    """Generate a new unique session ID."""
    return secrets.token_urlsafe(32)


def get_session_id(request: Request) -> Optional[str]:
    """Extract and validate session ID from request cookies."""
    cookie_value = request.cookies.get(SESSION_COOKIE_NAME)
    if not cookie_value:
        return None

    try:
        serializer = get_serializer()
        session_id = serializer.loads(cookie_value, max_age=SESSION_MAX_AGE)
        return session_id
    except (BadSignature, SignatureExpired):
        return None


def set_session_cookie(response: Response, session_id: str) -> None:
    """Set the session cookie on a response."""
    serializer = get_serializer()
    cookie_value = serializer.dumps(session_id)
    response.set_cookie(
        key=SESSION_COOKIE_NAME,
        value=cookie_value,
        max_age=SESSION_MAX_AGE,
        httponly=True,
        samesite="lax",
        secure=os.environ.get("ENVIRONMENT") == "production",
    )


def clear_session_cookie(response: Response) -> None:
    """Clear the session cookie."""
    response.delete_cookie(key=SESSION_COOKIE_NAME)


def get_user_token_path(session_id: str, base_dir: str = "user_tokens") -> Path:
    """Get the token file path for a specific user session."""
    token_dir = Path(base_dir).expanduser()
    token_dir.mkdir(parents=True, exist_ok=True)
    # Use session ID as filename (it's already URL-safe)
    return token_dir / f"{session_id}.pickle"


def ensure_session(request: Request, response: Response) -> str:
    """Ensure a session exists, creating one if needed. Returns session ID."""
    session_id = get_session_id(request)
    if not session_id:
        session_id = create_session_id()
        set_session_cookie(response, session_id)
    return session_id

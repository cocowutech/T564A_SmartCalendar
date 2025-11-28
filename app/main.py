import logging
import os
from pathlib import Path

from fastapi import FastAPI, Request, Response
from fastapi.responses import FileResponse, RedirectResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from app.api import get_api_router
from core.config import get_settings
from core.session import get_session_id, set_session_cookie, create_session_id, clear_session_cookie
from services.google_calendar import GoogleCalendarService

logger = logging.getLogger(__name__)

app = FastAPI(title="Smart Calendar Agent", version="0.1.0")

# Mount static files
static_dir = Path(__file__).parent / "static"
app.mount("/static", StaticFiles(directory=str(static_dir)), name="static")

# Include API routes
app.include_router(get_api_router())


def get_base_url(request: Request) -> str:
    """Get the base URL for OAuth redirects."""
    # Check for forwarded headers (when behind a proxy/load balancer)
    forwarded_proto = request.headers.get("x-forwarded-proto", "http")
    forwarded_host = request.headers.get("x-forwarded-host")

    if forwarded_host:
        return f"{forwarded_proto}://{forwarded_host}"

    # Fallback to request URL
    return str(request.base_url).rstrip("/")


@app.get("/")
async def read_root(request: Request):
    response = FileResponse(static_dir / "index.html")
    # Ensure user has a session
    session_id = get_session_id(request)
    if not session_id:
        session_id = create_session_id()
        set_session_cookie(response, session_id)
    return response


@app.get("/api/auth/status")
async def auth_status(request: Request):
    """Check if user is authenticated with Google."""
    session_id = get_session_id(request)
    if not session_id:
        return JSONResponse({"authenticated": False, "needsSession": True})

    settings = get_settings()
    calendar_service = GoogleCalendarService(session_id=session_id)

    is_authenticated = calendar_service.has_valid_credentials(settings)
    return JSONResponse({"authenticated": is_authenticated, "sessionId": session_id[:8]})


@app.get("/api/auth/debug")
async def auth_debug():
    """Debug endpoint to check OAuth configuration (no sensitive data exposed)."""
    settings = get_settings()

    # Check if JSON is in the main var
    main_var_is_json = bool(
        settings.google_client_secrets and
        settings.google_client_secrets.strip().startswith('{')
    )

    config_info = {
        "has_dedicated_json_env_var": bool(settings.google_client_secrets_json),
        "main_var_contains_json": main_var_is_json,
        "json_source": "GOOGLE_OAUTH_CLIENT_SECRETS_JSON" if settings.google_client_secrets_json else (
            "GOOGLE_OAUTH_CLIENT_SECRETS (auto-detected)" if main_var_is_json else "none"
        ),
        "environment": os.environ.get("ENVIRONMENT", "not_set"),
    }

    # Try to get the secrets path and check if it's valid
    try:
        secrets_path = settings.get_client_secrets_path()
        config_info["resolved_secrets_path"] = secrets_path
        config_info["secrets_file_exists"] = Path(secrets_path).exists()

        # Check JSON structure (without exposing secrets)
        if Path(secrets_path).exists():
            import json
            with open(secrets_path) as f:
                data = json.load(f)
            config_info["json_has_web_key"] = "web" in data
            config_info["json_has_installed_key"] = "installed" in data
            if "web" in data:
                config_info["has_client_id"] = "client_id" in data["web"]
                config_info["has_client_secret"] = "client_secret" in data["web"]
                config_info["has_redirect_uris"] = "redirect_uris" in data["web"]
    except Exception as e:
        config_info["error"] = str(e)
        config_info["error_type"] = type(e).__name__

    return JSONResponse(config_info)


@app.get("/api/auth/login")
async def auth_login(request: Request):
    """Start OAuth flow - redirect to Google."""
    try:
        response = Response()
        session_id = get_session_id(request)
        if not session_id:
            session_id = create_session_id()
            set_session_cookie(response, session_id)

        settings = get_settings()

        # Debug: Check if OAuth JSON is configured
        has_json = bool(settings.google_client_secrets_json)
        logger.info(f"OAuth config check - has JSON env var: {has_json}")

        calendar_service = GoogleCalendarService(session_id=session_id)

        base_url = get_base_url(request)
        redirect_uri = f"{base_url}/api/auth/callback"
        logger.info(f"OAuth redirect URI: {redirect_uri}")

        auth_url = calendar_service.get_auth_url(settings, redirect_uri)

        return RedirectResponse(url=auth_url)
    except Exception as e:
        logger.exception(f"OAuth login failed: {e}")
        return JSONResponse(
            status_code=500,
            content={"error": str(e), "type": type(e).__name__}
        )


@app.get("/api/auth/callback")
async def auth_callback(request: Request, code: str = None, error: str = None):
    """Handle OAuth callback from Google."""
    if error:
        return RedirectResponse(url=f"/?auth_error={error}")

    if not code:
        return RedirectResponse(url="/?auth_error=no_code")

    session_id = get_session_id(request)
    if not session_id:
        # Create new session if needed
        session_id = create_session_id()

    settings = get_settings()
    calendar_service = GoogleCalendarService(session_id=session_id)

    base_url = get_base_url(request)
    redirect_uri = f"{base_url}/api/auth/callback"

    success = calendar_service.exchange_code(settings, code, redirect_uri)

    response = RedirectResponse(url="/?auth_success=true" if success else "/?auth_error=exchange_failed")
    set_session_cookie(response, session_id)
    return response


@app.post("/api/auth/logout")
async def auth_logout(request: Request):
    """Log out user - clear credentials and session."""
    session_id = get_session_id(request)
    if session_id:
        settings = get_settings()
        calendar_service = GoogleCalendarService(session_id=session_id)
        calendar_service.logout(settings)

    response = JSONResponse({"status": "ok", "message": "Logged out"})
    clear_session_cookie(response)
    return response

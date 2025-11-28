from __future__ import annotations

from functools import lru_cache
from datetime import date
from pathlib import Path
from typing import Any

import yaml
from pydantic import BaseModel, Field, HttpUrl
from pydantic_settings import BaseSettings, SettingsConfigDict


class GmailConfig(BaseModel):
    search_query: str = Field(
        default="has:attachment (filename:ics OR filename:ical) "
        "OR subject:(ticket OR reservation OR rsvp OR itinerary OR booking) newer_than:60d"
    )


class IcsSourceConfig(BaseModel):
    name: str
    url: HttpUrl | str


class SelfCareWindow(BaseModel):
    day: str
    start: str
    end: str
    min_minutes: int = 60


class SelfCareConfig(BaseModel):
    preferred_windows: list[SelfCareWindow] = Field(default_factory=list)
    target_minutes: list[int] = Field(default_factory=lambda: [120, 60])
    buffers_minutes: int = 10
    max_per_day: int = 1


class HolidayConfig(BaseModel):
    name: str
    start: str  # ISO date
    end: str | None = None  # Optional inclusive end date

    def as_date_range(self) -> tuple[date, date]:
        """Return the holiday as a concrete date range."""
        start_date = date.fromisoformat(self.start)
        end_date = date.fromisoformat(self.end) if self.end else start_date
        return start_date, end_date


class AcademicCalendarConfig(BaseModel):
    term_name: str | None = None
    term_start_date: str | None = None
    term_end_date: str | None = None
    holidays: list[HolidayConfig] = Field(default_factory=list)

    def resolve_term_end(self) -> date | None:
        return date.fromisoformat(self.term_end_date) if self.term_end_date else None

    def resolve_term_start(self) -> date | None:
        return date.fromisoformat(self.term_start_date) if self.term_start_date else None


class AppConfig(BaseModel):
    # Legacy single Canvas URL (backward compatibility)
    canvas_ics_url: str | None = None
    # New: Multiple Canvas sources
    canvas_sources: list[IcsSourceConfig] = Field(default_factory=list)

    ics_sources: list[IcsSourceConfig] = Field(default_factory=list)
    gmail: GmailConfig = Field(default_factory=GmailConfig)
    selfcare: SelfCareConfig = Field(default_factory=SelfCareConfig)
    home: dict[str, Any] | None = None
    academic_calendar: AcademicCalendarConfig = Field(default_factory=AcademicCalendarConfig)

    def get_all_canvas_sources(self) -> list[IcsSourceConfig]:
        """Get all Canvas sources, including legacy single URL"""
        sources = list(self.canvas_sources)
        if self.canvas_ics_url and self.canvas_ics_url not in [s.url for s in sources]:
            sources.append(IcsSourceConfig(name="Canvas Legacy", url=self.canvas_ics_url))
        return sources


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="allow")

    # Google OAuth - can be file path OR JSON content directly
    google_client_secrets: str = Field(default="./client_secret.json", alias="GOOGLE_OAUTH_CLIENT_SECRETS")
    # For production: store JSON content in this env var
    google_client_secrets_json: str | None = Field(default=None, alias="GOOGLE_OAUTH_CLIENT_SECRETS_JSON")
    google_token_dir: str = Field(default="./user_tokens", alias="GOOGLE_TOKEN_DIR")
    google_calendar_id: str = Field(default="primary", alias="GOOGLE_CALENDAR_ID")
    timezone: str = Field(default="America/New_York", alias="TIMEZONE")

    openai_api_key: str | None = Field(default=None, alias="OPENAI_API_KEY")
    maps_api_key: str | None = Field(default=None, alias="MAPS_API_KEY")

    config_path: str = Field(default="config.yaml", alias="APP_CONFIG_PATH")

    def get_client_secrets_path(self) -> str:
        """Get the path to client secrets file, creating from JSON env var if needed."""
        import json
        import tempfile
        import os

        # If JSON content is provided via env var, write it to a temp file
        if self.google_client_secrets_json:
            # Create a persistent temp file for the session
            secrets_dir = Path(tempfile.gettempdir()) / "smart-calendar"
            secrets_dir.mkdir(exist_ok=True)
            secrets_file = secrets_dir / "client_secrets.json"

            # Write the JSON content
            with open(secrets_file, 'w') as f:
                # Parse and re-serialize to validate JSON
                secrets_data = json.loads(self.google_client_secrets_json)
                json.dump(secrets_data, f)

            return str(secrets_file)

        # Otherwise use the file path
        return self.google_client_secrets

    _app_config: AppConfig | None = None
    _app_config_mtime: float | None = None

    def load_app_config(self, *, force_reload: bool = False) -> AppConfig:
        config_file = Path(self.config_path)
        if not config_file.exists():
            self._app_config = AppConfig()
            self._app_config_mtime = None
            return self._app_config

        current_mtime = config_file.stat().st_mtime
        if not force_reload and self._app_config and self._app_config_mtime == current_mtime:
            return self._app_config

        with config_file.open("r", encoding="utf-8") as fh:
            data = yaml.safe_load(fh) or {}

        self._app_config = AppConfig.model_validate(data)
        self._app_config_mtime = current_mtime
        return self._app_config

    def reload_app_config(self) -> AppConfig:
        """Force a reload of the application config from disk."""
        return self.load_app_config(force_reload=True)


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()

from __future__ import annotations

from functools import lru_cache
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


class AppConfig(BaseModel):
    # Legacy single Canvas URL (backward compatibility)
    canvas_ics_url: str | None = None
    # New: Multiple Canvas sources
    canvas_sources: list[IcsSourceConfig] = Field(default_factory=list)

    ics_sources: list[IcsSourceConfig] = Field(default_factory=list)
    gmail: GmailConfig = Field(default_factory=GmailConfig)
    selfcare: SelfCareConfig = Field(default_factory=SelfCareConfig)
    home: dict[str, Any] | None = None

    def get_all_canvas_sources(self) -> list[IcsSourceConfig]:
        """Get all Canvas sources, including legacy single URL"""
        sources = list(self.canvas_sources)
        if self.canvas_ics_url and self.canvas_ics_url not in [s.url for s in sources]:
            sources.append(IcsSourceConfig(name="Canvas Legacy", url=self.canvas_ics_url))
        return sources


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="allow")

    google_client_secrets: str = Field(..., alias="GOOGLE_OAUTH_CLIENT_SECRETS")
    google_token_dir: str = Field(..., alias="GOOGLE_TOKEN_DIR")
    google_calendar_id: str = Field(default="primary", alias="GOOGLE_CALENDAR_ID")
    timezone: str = Field(default="America/New_York", alias="TIMEZONE")

    openai_api_key: str | None = Field(default=None, alias="OPENAI_API_KEY")
    maps_api_key: str | None = Field(default=None, alias="MAPS_API_KEY")

    config_path: str = Field(default="config.yaml", alias="APP_CONFIG_PATH")

    _app_config: AppConfig | None = None

    def load_app_config(self) -> AppConfig:
        if self._app_config:
            return self._app_config

        config_file = Path(self.config_path)
        if not config_file.exists():
            self._app_config = AppConfig()
            return self._app_config

        with config_file.open("r", encoding="utf-8") as fh:
            data = yaml.safe_load(fh) or {}

        self._app_config = AppConfig.model_validate(data)
        return self._app_config


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()

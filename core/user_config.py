"""Per-user configuration storage for multi-user deployment."""
from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Optional
from pydantic import BaseModel, Field

logger = logging.getLogger(__name__)

USER_CONFIG_DIR = "user_configs"


class IcsSource(BaseModel):
    """An ICS calendar source."""
    name: str
    url: str
    source_type: str = "ics"  # "canvas", "outlook", "ics"


class UserConfig(BaseModel):
    """Per-user configuration."""
    ics_sources: list[IcsSource] = Field(default_factory=list)
    canvas_sources: list[IcsSource] = Field(default_factory=list)
    timezone: str = "America/New_York"


def get_user_config_path(session_id: str) -> Path:
    """Get the config file path for a specific user session."""
    config_dir = Path(USER_CONFIG_DIR)
    config_dir.mkdir(parents=True, exist_ok=True)
    return config_dir / f"{session_id}.json"


def load_user_config(session_id: str) -> UserConfig:
    """Load user configuration from disk."""
    config_path = get_user_config_path(session_id)
    if not config_path.exists():
        return UserConfig()

    try:
        with open(config_path, 'r') as f:
            data = json.load(f)
        return UserConfig.model_validate(data)
    except Exception as e:
        logger.error(f"Failed to load user config for {session_id[:8]}: {e}")
        return UserConfig()


def save_user_config(session_id: str, config: UserConfig) -> bool:
    """Save user configuration to disk."""
    config_path = get_user_config_path(session_id)
    try:
        with open(config_path, 'w') as f:
            json.dump(config.model_dump(), f, indent=2)
        return True
    except Exception as e:
        logger.error(f"Failed to save user config for {session_id[:8]}: {e}")
        return False


def add_calendar_source(
    session_id: str,
    name: str,
    url: str,
    source_type: str = "ics"
) -> UserConfig:
    """Add a calendar source for a user."""
    config = load_user_config(session_id)

    source = IcsSource(name=name, url=url, source_type=source_type)

    # Add to appropriate list based on type
    if source_type == "canvas":
        # Check for duplicates
        if not any(s.url == url for s in config.canvas_sources):
            config.canvas_sources.append(source)
    else:
        if not any(s.url == url for s in config.ics_sources):
            config.ics_sources.append(source)

    save_user_config(session_id, config)
    return config


def remove_calendar_source(session_id: str, url: str) -> UserConfig:
    """Remove a calendar source by URL."""
    config = load_user_config(session_id)

    config.canvas_sources = [s for s in config.canvas_sources if s.url != url]
    config.ics_sources = [s for s in config.ics_sources if s.url != url]

    save_user_config(session_id, config)
    return config


def get_all_ics_sources(session_id: str) -> list[IcsSource]:
    """Get all ICS sources (both Canvas and other) for a user."""
    config = load_user_config(session_id)
    return config.canvas_sources + config.ics_sources

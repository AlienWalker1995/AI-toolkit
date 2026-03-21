"""Environment-derived settings for the dashboard (single source of truth)."""
from __future__ import annotations

import os
from pathlib import Path

DASHBOARD_AUTH_TOKEN: str = os.environ.get("DASHBOARD_AUTH_TOKEN", "").strip()
AUTH_REQUIRED: bool = bool(DASHBOARD_AUTH_TOKEN)

OPENCLAW_GATEWAY_PORT: str = os.environ.get("OPENCLAW_GATEWAY_PORT", "6680")
OPENCLAW_GATEWAY_INTERNAL_PORT: str = os.environ.get("OPENCLAW_GATEWAY_INTERNAL_PORT", "6680")
OPENCLAW_UI_PORT: str = os.environ.get("OPENCLAW_UI_PORT", "6682")
OPENCLAW_GATEWAY_TOKEN: str = os.environ.get("OPENCLAW_GATEWAY_TOKEN", "")
OPENCLAW_CONFIG_PATH: Path = Path(os.environ.get("OPENCLAW_CONFIG_PATH", "/openclaw-config/openclaw.json"))

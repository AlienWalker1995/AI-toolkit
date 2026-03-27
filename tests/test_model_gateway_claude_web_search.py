"""Claude Code web_search_* handling: Tavily bridge in model-gateway."""
import asyncio
import importlib.util
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch


def _load_gateway():
    gateway_path = Path(__file__).resolve().parent.parent / "model-gateway" / "main.py"
    spec = importlib.util.spec_from_file_location("model_gateway_main", gateway_path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def test_bridge_strips_web_search_tools_and_injects_tavily(monkeypatch):
    monkeypatch.setenv("TAVILY_API_KEY", "tvly-test-key")

    mock_resp = MagicMock()
    mock_resp.raise_for_status = MagicMock()
    mock_resp.json.return_value = {
        "results": [{"title": "Example", "url": "https://example.com", "content": "Snippet text"}],
    }

    mock_client = AsyncMock()
    mock_client.post = AsyncMock(return_value=mock_resp)
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=None)

    with patch("httpx.AsyncClient", return_value=mock_client):
        gw = _load_gateway()
        raw_in = {
            "model": "claude-3-5-sonnet-20241022",
            "max_tokens": 100,
            "messages": [{"role": "user", "content": "What is 2+2?"}],
            "tools": [{"type": "web_search_20250305", "name": "web_search", "max_uses": 3}],
            "tool_choice": {"type": "auto"},
        }
        out = asyncio.run(gw._bridge_claude_code_web_search_tools(dict(raw_in)))

    assert "tools" not in out
    assert "tool_choice" not in out
    sys = out.get("system")
    assert isinstance(sys, str)
    assert "Web search results" in sys
    assert "https://example.com" in sys


def test_bridge_without_tavily_key_strips_only(monkeypatch):
    monkeypatch.delenv("TAVILY_API_KEY", raising=False)

    gw = _load_gateway()
    raw_in = {
        "messages": [{"role": "user", "content": "Hi"}],
        "tools": [{"type": "web_search_20250305", "name": "web_search"}],
    }
    out = asyncio.run(gw._bridge_claude_code_web_search_tools(dict(raw_in)))
    assert "tools" not in out
    assert out.get("system") is None

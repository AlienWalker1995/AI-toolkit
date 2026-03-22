"""Unit tests for dashboard dependency HTTP probes (M7)."""
import os
import sys
from unittest.mock import MagicMock, patch

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))


@patch("dashboard.dependency_registry.httpx.Client")
def test_mcp_gateway_http_400_counts_as_reachable(mock_client_cls):
    """Naive GET /mcp returns 400; gateway is still up for MCP clients."""
    mock_resp = MagicMock()
    mock_resp.status_code = 400
    inner = MagicMock()
    inner.get.return_value = mock_resp
    mock_ctx = MagicMock()
    mock_ctx.__enter__.return_value = inner
    mock_ctx.__exit__.return_value = None
    mock_client_cls.return_value = mock_ctx

    from dashboard.dependency_registry import _probe_one

    ok, _lat, err = _probe_one("http://mcp-gateway:8811/mcp", entry_id="mcp-gateway")
    assert ok is True
    assert err is None


@patch("dashboard.dependency_registry.httpx.Client")
def test_other_services_http_400_still_fails(mock_client_cls):
    mock_resp = MagicMock()
    mock_resp.status_code = 400
    inner = MagicMock()
    inner.get.return_value = mock_resp
    mock_ctx = MagicMock()
    mock_ctx.__enter__.return_value = inner
    mock_ctx.__exit__.return_value = None
    mock_client_cls.return_value = mock_ctx

    from dashboard.dependency_registry import _probe_one

    ok, _lat, err = _probe_one("http://model-gateway:11435/health", entry_id="model-gateway")
    assert ok is False
    assert err == "HTTP 400"

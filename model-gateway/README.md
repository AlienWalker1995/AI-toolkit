# Model Gateway

OpenAI-compatible proxy for unified model access. Routes chat and embedding requests to Ollama (and future providers like vLLM). Also serves as an Anthropic-compatible proxy for Claude Code local model support.

**Status:** See [Product Requirements Document](../docs/Product%20Requirements%20Document.md) for design and decisions.

## Endpoints

- `GET /v1/models` — List models from all providers
- `POST /v1/chat/completions` — Chat completion (streaming supported)
- `POST /v1/messages` — Anthropic Messages API (Claude Code compatibility)
- `POST /v1/embeddings` — Embeddings
- `GET /health` — Gateway health

## Config

| Variable | Description |
|----------|-------------|
| `OLLAMA_URL` | Upstream Ollama URL (default: `http://ollama:11434`) |
| `VLLM_URL` | Optional vLLM backend URL |
| `DEFAULT_PROVIDER` | Default provider when no prefix (default: `ollama`) |
| `CLAUDE_CODE_LOCAL_MODEL` | Local model for Claude Code (e.g. `glm-4.7-flash:Q4_K_M`) |
| `OLLAMA_NUM_CTX` | KV cache context cap (default: `16384`, `0` = model max) |
| `MODEL_CACHE_TTL_SEC` | Model list cache TTL (default: `60`) |

## Claude Code with local models

The gateway translates Anthropic's Messages API to Ollama, allowing Claude Code to run against any local model.

### Setup

1. Set the local model in `.env`:
   ```
   CLAUDE_CODE_LOCAL_MODEL=glm-4.7-flash:Q4_K_M
   ```

2. Restart the gateway:
   ```bash
   docker compose up -d model-gateway
   ```

### Usage (same machine)

```powershell
# PowerShell
$env:ANTHROPIC_BASE_URL="http://localhost:11435"
$env:ANTHROPIC_API_KEY="local"
claude
```

```bash
# Bash
ANTHROPIC_BASE_URL=http://localhost:11435 ANTHROPIC_API_KEY=local claude
```

### Usage (remote machine)

Point Claude Code at the machine running the gateway:

```powershell
# PowerShell
$env:ANTHROPIC_BASE_URL="http://<gateway-host-ip>:11435"
$env:ANTHROPIC_API_KEY="local"
claude
```

```bash
# Bash
ANTHROPIC_BASE_URL=http://<gateway-host-ip>:11435 ANTHROPIC_API_KEY=local claude
```

Replace `<gateway-host-ip>` with the IP or hostname of the machine running the AI toolkit. Port `11435` must be reachable (check firewall).

### How it works

1. Claude Code sends requests to `/v1/messages` using a `claude-*` model name
2. The gateway remaps `claude-*` → the model set in `CLAUDE_CODE_LOCAL_MODEL`
3. The request is translated from Anthropic format to Ollama's `/api/chat`
4. The response is translated back to Anthropic format

Claude Code doesn't know it's talking to a local model — the gateway is a transparent proxy.

### Changing the local model

Edit `CLAUDE_CODE_LOCAL_MODEL` in `.env` and restart:

```bash
docker compose up -d model-gateway
```

Any Ollama model works: `qwen3:8b`, `deepseek-r1:7b`, `devstral-small-2`, etc.

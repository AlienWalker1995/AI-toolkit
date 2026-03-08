# ADR-0001: Architecture Overview — Gateway, Ops-Controller, Bind Mounts, MCP, OpenClaw

**Date:** 2026-03-07
**Status:** Accepted
**Deciders:** AI-toolkit maintainers

## Context

The AI-toolkit is a self-hosted, local-first LLM platform. Key design questions:

1. How should model inference be exposed to consumers?
2. How should service lifecycle (start/stop/restart) be managed securely?
3. Where should persistent state live?
4. How should MCP tools be run?
5. How should agent credentials be isolated?

## Decision

### 1. Single model gateway (OpenAI-compatible)

All model inference flows through a central **model-gateway** service. Consumers (Open WebUI, N8N, OpenClaw, RAG ingestion) call the gateway at `/v1/chat/completions`, `/v1/embeddings`, `/v1/models`, etc. The gateway proxies to Ollama (and optionally vLLM). No service talks to Ollama directly for inference.

**Rationale:** One routing point; provider abstraction; consistent tool-arg conversion; throughput attribution via `X-Service-Name`.

### 2. Ops-controller separation (no docker.sock in UI)

The **dashboard** (control-plane UI) never mounts `docker.sock`. It proxies lifecycle requests to an **ops-controller** service that holds the only Docker socket mount. The ops-controller enforces an allowlist (`ALLOWED_SERVICES`) and Bearer token auth.

**Rationale:** Minimise blast radius; audit trail; no arbitrary container manipulation from the UI layer.

### 3. Bind mounts for state

All persistent state lives under `data/` (and `models/`) as bind-mounted directories. No Docker volumes with generated names. Backup = `tar` of `data/` and `models/`.

**Rationale:** Portable; easy to inspect; no volume lifecycle surprises.

### 4. MCP gateway spawns tool containers

The **mcp-gateway** mounts `docker.sock` to spawn MCP server containers on demand. It reads `servers.txt` and `registry.json` for config. Tool containers run in isolation; policy (`allow_clients`) is metadata in registry (enforcement deferred to upstream Docker MCP Gateway).

**Rationale:** Hot-reload without compose restart; per-tool policy; no long-lived tool processes in the gateway.

### 5. Two-tier OpenClaw (gateway holds credentials)

**OpenClaw gateway** holds API keys and tokens; the CLI/browser tier has none. The gateway talks to model-gateway and mcp-gateway; users authenticate to the gateway only.

**Rationale:** Credentials never leave the server; reduced client-side attack surface.

## Consequences

### Positive

- Clear trust boundaries
- Single model routing path
- Audited control plane
- Simple backup/restore

### Negative / Trade-offs

- Two services with docker.sock (ops-controller, mcp-gateway)
- MCP `allow_clients` not yet enforced at gateway level (external dep)

### Risks

- Ops-controller compromise → full container control
- MCP tool container escape → host access (mitigated by `cap_drop`, network isolation)

## Implementation Notes

- Model-gateway: `model-gateway/main.py`; Ollama proxy at `/api/tags`, `/api/ps`, `/api/pull`, `/api/delete`, `/api/generate`
- Ops-controller: `ops-controller/main.py`; audit log at `data/ops-controller/audit.log`
- MCP: `mcp/gateway-wrapper.sh`; config in `data/mcp/`
- OpenClaw: `openclaw-gateway`; config in `data/openclaw/openclaw.json`

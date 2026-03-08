# Architectural Audit — AI-toolkit LLM Platform
**Date:** 2026-03-07
**Auditor:** Claude Opus 4.6 (automated, evidence-based)
**PRD Reference:** `docs/Product Requirements Document.md` (Living document, updated 2026-03-04)
**Scope:** All services in `docker-compose.yml`; custom Python services; SPA frontend; infra config

---

## SECTION 0 — Audit Overview

### Repo Purpose (from PRD)

A self-hosted, local-first AI platform that any developer can run with `./compose up -d`. Core guarantees per PRD §0.1:
1. **One model endpoint** — every service reaches every model via a single OpenAI-compatible gateway
2. **Shared tools with health** — MCP tools served from a central gateway with policy controls
3. **Authenticated ops** — dashboard manages the full service lifecycle through a secure, audited control plane with no `docker.sock` in the UI layer
4. **RAG out of the box** — Qdrant wired into Open WebUI; document ingestion one compose profile away
5. **Hardened by default** — non-root containers, `cap_drop: [ALL]`, read-only filesystems, explicit networks, log rotation, resource limits across all custom services

### High-Level Architecture Summary

Twelve containerised services communicate over two isolated Docker bridge networks (`ai-toolkit-frontend` / `ai-toolkit-backend`). All model inference is funnelled through a central OpenAI-compatible proxy (`model-gateway:11435`) abstracting Ollama and optional vLLM. A privileged `ops-controller` holds the only planned Docker socket mount for service lifecycle management. A FastAPI dashboard serves a SPA and proxies management calls behind a bearer-token boundary. MCP tool containers are spawned dynamically by the MCP gateway (also socket-mounted). Hardware auto-detection at install time generates a GPU-specific Compose override.

### Audit Scope & Assumptions

- **In scope:** All 12 compose services, 5 custom-built images, infra config, Python source (~2,600 LOC custom), SPA frontend (~2,400 LOC)
- **PRD treated as source of truth** for intended behaviour; code checked against it
- **Deployment target:** Single-node Docker Compose on Windows/Linux/macOS. Not Kubernetes
- **Security posture:** Primarily single-user home/lab; multi-user hardening present but opt-in
- **No CI/CD pipeline config found** (`.github/`, `.gitlab-ci.yml`) — confirmed gap
- **Assumption:** `docs/runbooks/` files referenced in PRD exist but were not fully read; findings treat them as present unless evidence contradicts

### Severity Rubric

| Severity | Meaning |
|---|---|
| **Critical** | Exploitable now or direct regression from a stated PRD guarantee |
| **High** | Significant security or reliability risk; must fix before multi-user or LAN exposure |
| **Medium** | Degrades security, reliability, or maintainability; fix within one sprint |
| **Low** | Best-practice gap; fix opportunistically |

---

## SECTION 1 — System Inventory

### Component Catalog

| Name | Type | Language | Runtime | Host Ports | Data Stores | Deploy Unit |
|---|---|---|---|---|---|---|
| `ollama` | LLM runtime | Go | `ollama/ollama:0.17.4` | — | `data/ollama` | compose service |
| `model-gateway` | API proxy | Python 3.12 | uvicorn/FastAPI | 11435 | — (in-mem cache) | compose service |
| `dashboard` | Control plane UI+API | Python 3.12 | uvicorn/FastAPI | 8080 | `data/mcp`, `data/openclaw` | compose service |
| `ops-controller` | Orchestration API | Python 3.12 | uvicorn/FastAPI | — | `data/ops-controller/audit.log` | compose service |
| `open-webui` | Chat UI | Node/Python | `ghcr.io/open-webui/open-webui:v0.8.4` | 3000 | `data/open-webui` | compose service |
| `comfyui` | Image gen UI | Python | `yanwk/comfyui-boot:cpu` | 8188 | `data/comfyui-*`, `models/comfyui` | compose service |
| `n8n` | Workflow automation | Node | `docker.n8n.io/n8nio/n8n` | 5678 | `data/n8n-*` | compose service |
| `mcp-gateway` | Tool gateway | Bash/Docker | `docker/mcp-gateway:latest` | 8811 | `data/mcp` | compose service |
| `qdrant` | Vector DB | Rust | `qdrant/qdrant:v1.13.4` | 6333 | `data/qdrant` | compose service |
| `rag-ingestion` | Document embedder | Python 3.12 | custom image | — | `data/rag-input` | profile: `rag` |
| `openclaw-gateway` | Agent orchestrator | Node | `ghcr.io/phioranex/openclaw-docker:latest` | 18789, 18790 | `data/openclaw` | compose service |
| `openclaw-*-sync` | Init jobs (×3) | Shell | alpine/custom | — | `data/openclaw` | one-shot |

### Dependency Graph

```
open-webui        → model-gateway, ollama (healthy), qdrant
model-gateway     → ollama (healthy)
dashboard         → ollama (healthy), model-gateway, ops-controller, mcp-gateway
ops-controller    → docker.sock
mcp-gateway       → docker.sock, data/mcp
rag-ingestion     → model-gateway, qdrant
openclaw-gateway  → model-gateway, mcp-gateway, openclaw-*-sync (completed)
n8n               → mcp-gateway
comfyui           → (none; standalone)
qdrant            → (none; standalone)
```

### Key Data Flows

| Flow | Path |
|---|---|
| Chat | Browser → Open WebUI (3000) → model-gateway (11435) → Ollama (11434) → stream back |
| Tool call | Same + model-gateway converts Ollama dict args → OpenAI JSON string format |
| Model management | Browser → Dashboard (8080) → ops-controller (9000) → docker.sock |
| RAG ingest | File drop → rag-ingestion watches → chunks → model-gateway `/v1/embeddings` → Qdrant |
| MCP tool use | N8N/OpenClaw → mcp-gateway (8811) → spawns docker container → result back |
| Throughput metrics | model-gateway → fire-and-forget POST → dashboard `/api/throughput/record` |
| Audit trail | Dashboard → ops-controller (Bearer) → `data/ops-controller/audit.log` (JSONL) |

---

## SECTION 2 — PRD & Documentation Conformance

### Requirements → Implementation Matrix

| Requirement | PRD Reference | Implementation Evidence | Status | Notes |
|---|---|---|---|---|
| Local-first, single machine | §0.1, §2 Principle 1 | All services in single Compose file; bind-mount data dirs | ✅ Met | |
| OpenAI-compatible gateway | §3.A, WS1 | `model-gateway/main.py` — `/v1/chat/completions`, `/v1/models`, `/v1/embeddings`, `/v1/responses` | ✅ Met | |
| Multi-provider routing (Ollama + vLLM) | §3.A | `_model_provider_and_id()`, `VLLM_URL` env, `overrides/vllm.yml` | ✅ Met | Non-streaming vLLM path is dead code |
| GPU auto-detection | §3, WS5 | `scripts/detect_hardware.py`, `overrides/compute.yml` | ✅ Met | Windows AMD/Intel fall back to CPU |
| Dashboard as control centre | §3, WS3 | ops-controller + dashboard proxy; no docker.sock in dashboard | ✅ Met | |
| Audit logging (JSONL, correlation IDs) | §3.D, §4 WS4 | `ops-controller/main.py` `_audit()`; `docs/audit/SCHEMA.md` | ✅ Met | Silent failure on audit write failure |
| MCP tool gateway with health | §3.B, WS2 | `mcp/` service; `registry.json`; `/api/mcp/health` | ✅ Met | `allow_clients` policy not yet enforced at gateway |
| RAG pipeline | §3.F, WS6 | `rag-ingestion/` profile; Qdrant; Open WebUI → Qdrant | ✅ Met | `nomic-embed-text` must be pre-pulled |
| ComfyUI image gen | §3 | compose service + model scripts | ✅ Met | |
| Secrets not committed | §2 Principle 3, WS4 | `.env` in `.gitignore`; `.env.example` provided | ✅ Met | |
| Non-root containers | PRD §5 WS5, G5 | `model-gateway` and `n8n` use `user: "1000:1000"`; **dashboard now runs as root** | ⚠️ **Drift** | Regression — dashboard non-root was removed during permission debugging |
| `cap_drop: [ALL]` on custom services | PRD §5 WS5 | `model-gateway`, `dashboard`, `ops-controller` | ✅ Met | |
| `read_only: true` on custom services | PRD §5 WS5 | `model-gateway`, `dashboard` | ✅ Met | |
| `WEBUI_AUTH` default `True` | PRD §1.3, M6, §6 PR6-A | Currently `WEBUI_AUTH=${WEBUI_AUTH:-False}` in compose | ❌ **Not done** | PRD M6 explicitly targets this as first PR; not yet applied |
| mcp-gateway backend-only | PRD §1.3, §5, M6 PR6-A | mcp-gateway still on frontend network with host port 8811 | ❌ **Not done** | PRD M6 explicitly targets this |
| Audit log rotation | PRD M6, §6 Step 3 | `_maybe_rotate_audit_log()` implemented at 10MB | ✅ Met | Single backup only (`.log.1`) |
| CI pipeline | PRD §1.3, M6 | No `.github/workflows/` found | ❌ **Not done** | PRD M6 target |
| MCP per-client policy enforcement | PRD §1.3, WS2 | `allow_clients` is metadata-only; not enforced | ❌ Deferred | Blocked on Docker MCP Gateway `X-Client-ID` support (known) |
| vLLM non-streaming path | PRD §3.A WS1 | `model-gateway/main.py:258-267` is dead code | ❌ **Drift** | `return StreamingResponse(...)` on line 253 exits before non-streaming block |
| Responses API | PRD §3.A, M5-ext | `/v1/responses` implemented | ✅ Met | |
| Correlation IDs end-to-end | PRD §3.D, M4 | `X-Request-ID` generated, forwarded, stored in audit | ✅ Met | Not propagated to Ollama itself |
| `X-Service-Name` throughput attribution | PRD §3.A | `_service_from_headers()` in model-gateway | ✅ Met | |
| Hardware stats | PRD WS3, M5 | `GET /api/hardware` — CPU, memory, GPU | ✅ Met | `psutil.disk_usage()` blocks async event loop |
| Default model management | PRD WS3, M5 | `GET/POST /api/config/default-model` | ✅ Met | |
| Throughput benchmark | PRD WS3, M5 | `POST /api/throughput/benchmark` | ✅ Met | Stats lost on restart |
| SSRF egress scripts | PRD WS4, M5 | `scripts/ssrf-egress-block.sh/.ps1` | ✅ Met | Not auto-applied on install |
| `openclaw.json` token externalisation | PRD §1.3 M6, §7 | Tokens still in `data/openclaw/openclaw.json` | ❌ Deferred | PRD M6 item |
| RBAC (read-only role) | PRD M6 | Not implemented | ❌ Deferred | PRD M6 item; auth is currently binary |

### Documentation Drift Findings

1. **Critical drift** — Dashboard `user: "1000:1000"` removed from compose AND `USER appuser` removed from `dashboard/Dockerfile` to fix a permissions issue. PRD §5 WS5 explicitly lists non-root as confirmed for dashboard. No ADR or note captures this regression.
2. **High drift** — `WEBUI_AUTH` default is still `False` despite PRD §6 naming it the very first PR of M6 (`PR6-A: WEBUI_AUTH default + mcp-gateway network`).
3. **High drift** — mcp-gateway still on frontend network with host port 8811 despite PRD §6 PR6-A targeting this.
4. **Medium drift** — vLLM non-streaming path (`model-gateway/main.py:258–267`) is unreachable dead code; PRD WS1 documents it as supported.
5. **Medium drift** — PRD §1.3 remaining gaps table lists `mcp-gateway on frontend network` as a known Low gap — the audit found it is still unresolved.
6. **Low drift** — PRD §2 Principle 4 states "Services should **prefer** gateway over direct Ollama" — dashboard still calls Ollama directly for pull/delete/ps/tags.

---

## SECTION 3 — Architecture Quality Audit

### Boundary Integrity

**Good:**
- Dashboard never touches docker.sock — clean privilege separation aligned with PRD §0.1 Goal 3
- Model routing fully encapsulated in model-gateway; upstream services don't know Ollama exists
- ops-controller `ALLOWED_SERVICES` allowlist prevents arbitrary container manipulation

**Issues:**
- Dashboard calls Ollama directly at `OLLAMA_URL` for `/api/tags`, `/api/pull`, `/api/delete`, and `/api/ps` — bypasses the gateway, creating a second dependency path. Contradicts PRD Principle 4
- `_run_comfyui_download()` uses `urllib.request` (stdlib) for potentially 22 GB downloads with no resume, no streaming backpressure, and no partial-file cleanup on crash

### Contracts / APIs

**Good:**
- Model gateway presents stable `/v1/` OpenAI-compatible surface
- Pydantic models now on all four gateway endpoints (after recent fix)

**Issues:**
- `chat_completions` accepts `ChatCompletionRequest | dict[str, Any]` — internal callers via completions-compat and responses-api pass raw dicts, bypassing Pydantic validation entirely
- No API versioning on dashboard `/api/` endpoints; breaking changes have no migration path
- `completions_compat` (`/v1/completions`) silently drops `n`, `logprobs`, `best_of` — callers expecting full completions semantics get partial responses with no error

### Configuration Management

**Good:**
- All config via environment variables with sensible defaults
- Hardware detection generates `overrides/compute.yml` rather than mutating main compose

**Issues:**
- `COMPUTE_MODE` is written to `.env` by `detect_hardware.py` at install time but also consumed by the compose file — if `.env` is regenerated, `COMPUTE_MODE` is overwritten, potentially changing GPU mode unintentionally
- `COMPOSE_FILE` env var is read by both the shell `compose` script and by `ops-controller` to reconstruct file paths for `docker-compose up` — divergence between the two would cause silent recreation failures
- `OLLAMA_NUM_CTX` is set redundantly: once in the compose `ollama` service env (server-side default) and once in `model-gateway` env (per-request override). The duplication is intentional per code comments but confusing

### State Management

**Good:**
- All state in bind-mounted `data/` directories — easy to back up, move, and inspect

**Issues:**
- No migration scripts — if Qdrant schema changes between versions, the stored collection breaks silently
- Audit log rotation keeps only one backup (`.log.1`); second rotation permanently destroys the previous backup
- `_throughput_samples` and `_service_usage` are in-memory only — lost on every dashboard restart; benchmark history vanishes

### Findings

| ID | Severity | Evidence | Risk | Recommendation | PR Slice |
|---|---|---|---|---|---|
| A1 | **High** | `dashboard/app.py` calls `OLLAMA_URL` directly for pull/delete/ps/tags | Violates PRD Principle 4; duplicates routing; breaks if Ollama moves | Route all model ops through model-gateway | `fix/dashboard-route-via-gateway` |
| A2 | **Medium** | `model-gateway/main.py:258–267` dead code after `return StreamingResponse` | vLLM non-streaming never executes; silent PRD feature gap | Remove dead block or fix control flow with `else` branch | `fix/vllm-nonstreaming-path` |
| A3 | **Medium** | `_run_comfyui_download` uses `urllib` with no resume | Any network interruption on a 22 GB file requires full restart | Rewrite with `httpx` + `Range` header + temp file + atomic rename | `feat/resumable-comfyui-download` |
| A4 | **Medium** | `chat_completions(body: ChatCompletionRequest \| dict)` | Internal dict callers bypass Pydantic validation | Keep type as `dict` internally; validate at entry point only | `fix/chat-completions-internal-typing` |
| A5 | **Low** | No API versioning on dashboard endpoints | Future breaking changes have no migration path | Add `/api/v1/` prefix to dashboard routes | `refactor/dashboard-api-versioning` |

---

## SECTION 4 — Security & Privacy Audit

### Threat Model Table

| Asset | Threat | Attack Path | Impact | Mitigation | Status |
|---|---|---|---|---|---|
| `OPS_CONTROLLER_TOKEN` | Theft via dashboard XSS | XSS in SPA → read sessionStorage | Full service control, container manipulation | Token not stored client-side; **no CSP header** | ⚠️ CSP missing |
| docker.sock (ops-controller) | Container escape | Compromise ops-controller → arbitrary docker commands | Host takeover | `cap_drop: ALL`, `no-new-privileges`, no host port, allowlist | ✅ Partially mitigated |
| docker.sock (mcp-gateway) | Malicious MCP tool spawns attacker container | Prompt injection → tool call → mcp-gateway spawns privileged container | Host takeover | `allow_clients` policy in `registry.json` | ⚠️ Policy not enforced at gateway level |
| Ollama / model-gateway | SSRF to cloud metadata | Model-gateway proxied request reaches 169.254.169.254 | Cloud credential theft | `ssrf-egress-block.sh` available | ⚠️ Not auto-applied |
| `.env` secrets | Accidental git commit | `git add .` captures `.env` | Full service compromise | `.gitignore` present; `.env.example` provided | ✅ Correct |
| Audit log | Silent write failure | Exception swallowed in `_audit()` | Compliance gap; breach undetected | Log audit write failures to stderr | ❌ Not mitigated |
| ComfyUI output / UI | Data exfiltration; unauthorised use | Port 8188 open on LAN, no auth | Anyone on network generates images | Bind to `127.0.0.1` or add auth | ❌ Not mitigated |
| N8N workflows / credentials | Credential exposure | Port 5678 open on LAN; N8N stores API keys in workflows | Key theft, arbitrary workflow exec | Restrict to localhost; enable N8N auth | ⚠️ N8N auth not enforced |
| Open WebUI | Unauthenticated LLM access | `WEBUI_AUTH=False` default | Anyone on network uses the full LLM stack | Set `WEBUI_AUTH=True` (PRD M6 PR6-A) | ❌ PRD M6 not yet applied |
| MCP tools (filesystem) | Data exfiltration | LLM prompt → tool call → reads host files | Sensitive file exposure | `allow_clients: []` in registry; removed from `servers.txt` | ✅ Mitigated in defaults |
| MCP tool containers | Runaway resource use | Tool container with no limits OOMs host | DoS | No resource limits on spawned containers | ❌ Not mitigated |
| `openclaw.json` | Plaintext tokens on disk | File included in unencrypted backup / shared `data/` | Telegram/API key exposure | Move sensitive values to `.env` (PRD M6 item) | ❌ PRD M6 deferred |

### AuthN/AuthZ Posture

| Surface | Auth | Notes |
|---|---|---|
| Dashboard (8080) | Optional Bearer/Basic | Defaults to **no auth** — fine for localhost, dangerous on LAN |
| Model gateway (11435) | **None** | Intentional per PRD ("acceptable for localhost"); add API key if LAN-exposed |
| Ops-controller (9000) | Required Bearer | Internal only (no host port) ✅ |
| Open WebUI (3000) | Optional (`WEBUI_AUTH`) | Defaults **off** — PRD M6 target to flip |
| ComfyUI (8188) | **None** | Bound to `0.0.0.0`; full image gen UI open to LAN |
| N8N (5678) | Optional (N8N built-in) | Not configured; bound to `0.0.0.0` |
| OpenClaw (18789) | `OPENCLAW_GATEWAY_TOKEN` | Token-gated ✅ |
| Qdrant (6333) | **None** | Backend-only network ✅ |
| MCP Gateway (8811) | `allow_clients` policy | Frontend network with host port — PRD M6 targets backend-only |

### Secrets Management

- ✅ `.env` gitignored; `.env.example` provided; generation documented
- ✅ Tokens passed as env vars into containers
- ⚠️ All env vars visible in `docker inspect` — mitigatable with Docker secrets (`/run/secrets/`)
- ⚠️ `OPENAI_API_KEY=ollama-local` hardcoded in compose — misleading name; pattern invites hardcoding real keys
- ❌ `openclaw.json` contains Telegram token and skill API keys on disk (PRD-acknowledged; M6 item)
- ❌ No Docker secrets (`/run/secrets/`) integration

### Supply-Chain Assessment

| Image | Tag Pinned | Digest | Risk |
|---|---|---|---|
| `ollama/ollama:0.17.4` | ✅ | ❌ | Medium |
| `ghcr.io/open-webui/open-webui:v0.8.4` | ✅ | ❌ | Medium |
| `qdrant/qdrant:v1.13.4` | ✅ | ❌ | Medium |
| `docker.n8n.io/n8nio/n8n` | ❌ unpinned | ❌ | **High** |
| `ghcr.io/phioranex/openclaw-docker:latest` | ❌ `latest` | ❌ | **High** |
| `yanwk/comfyui-boot:cpu` | ⚠️ non-semver | ❌ | High |
| `docker/mcp-gateway:latest` | ❌ `latest` | ❌ | **High** |
| Python deps (`requirements.txt`) | ❌ no lockfile | — | Medium |

### Tool / Agent Safety (MCP + OpenClaw)

- **Prompt injection → MCP tool execution:** An LLM response that contains a tool-call instruction could cause mcp-gateway to spawn a container. Mitigation is the `allow_clients` allowlist in `registry.json` — but this is currently metadata-only, not enforced at gateway level (PRD-acknowledged gap, M6)
- **Spawned tool containers:** No `--memory`, `--cpus`, or `--network` restrictions are applied to containers spawned by mcp-gateway. A runaway or malicious tool can OOM the host or reach internal services
- **SSRF from MCP containers:** Tool containers can reach Ollama, Qdrant, and other internal services unless network-isolated. `ssrf-egress-block.sh` must be applied to the mcp-gateway subnet
- **OpenClaw two-tier model:** Correctly implemented per PRD §9 — gateway tier holds credentials; CLI/browser tier has none. This is the correct pattern

### Findings

| ID | Severity | Evidence | Risk | Recommendation | PR Slice |
|---|---|---|---|---|---|
| S1 | **Critical** | `WEBUI_AUTH=${WEBUI_AUTH:-False}` (`docker-compose.yml`) | Anyone on LAN uses full LLM stack — PRD M6 PR6-A names this the first fix | Change default to `True`; add UPGRADE.md note | `fix/webui-auth-default-on` |
| S2 | **Critical** | Dashboard now runs as root (Dockerfile USER removed) | Regression from PRD-stated guarantee; elevated container blast radius | Restore `USER appuser` + `user: "1000:1000"`; fix volume ownership on host with `chown` | `fix/restore-dashboard-nonroot` |
| S3 | **High** | No CSP / security headers on dashboard (`app.py` — no header middleware) | XSS could steal auth token from sessionStorage | Add `Content-Security-Policy`, `X-Frame-Options`, `X-Content-Type-Options` middleware | `fix/dashboard-security-headers` |
| S4 | **High** | ComfyUI (8188) and N8N (5678) bound to `0.0.0.0` with no auth | LAN users can generate images and read/execute workflows | Bind to `127.0.0.1`; document SSH tunnel / Tailscale for remote access | `fix/localhost-bind-unauthenticated` |
| S5 | **High** | `docker/mcp-gateway:latest`, `ghcr.io/phioranex/openclaw-docker:latest`, `n8n` unpinned | Silent supply-chain mutation on next `docker compose pull` | Pin all three to explicit semver tags | `fix/pin-unpinned-images` |
| S6 | **High** | mcp-gateway still on frontend network with host port 8811 | Expands attack surface — PRD M6 PR6-A targets backend-only | Move to `backend` network only; remove host port; create `overrides/mcp-expose.yml` | `fix/mcp-gateway-backend-only` |
| S7 | **Medium** | MCP spawned containers have no resource limits or network isolation | Runaway tool OOMs host; tool can reach Qdrant/Ollama | Apply `--memory 512m --cpus 1 --network none` (or isolated net) when spawning | `fix/mcp-tool-container-limits` |
| S8 | **Medium** | `_audit()` swallows all exceptions silently (`ops-controller/main.py:94`) | Audit trail silently lost; compliance gap | Log to stderr on audit write failure; consider raising in critical paths | `fix/audit-write-failure-logging` |
| S9 | **Medium** | `ssrf-egress-block.sh` not applied automatically | Cloud metadata endpoints (169.254.169.254) reachable | Call script from `ensure_dirs.sh` setup flow | `fix/auto-apply-ssrf-block` |
| S10 | **Low** | Python `requirements.txt` files lack lockfiles | Transitive dep vulnerability on next build | Add `pip-compile` lockfiles or `uv.lock` | `fix/pip-lockfiles` |
| S11 | **Low** | `/api/comfyui/download` has no content-type verification | Malicious server serves exploit payload with `.safetensors` extension | Verify `Content-Type: application/octet-stream` before writing | `fix/download-content-type-check` |

---

## SECTION 5 — Reliability & Operability Audit

### Health Checks

Every long-running service has a healthcheck — this is excellent and aligns with PRD §5 WS5. Key gaps:

- No `start_period` on any healthcheck — during first-run model downloads, containers restart-loop before Ollama is ready
- `rag-ingestion` has no healthcheck
- `open-webui` health check probes `localhost:8080` internally (correct for inside-container) but is confusing given the host port is 3000

### Timeouts / Retries / Circuit Breakers

| Path | Timeout | Retry | Circuit Breaker |
|---|---|---|---|
| model-gateway → Ollama (streaming) | 3600s | None | None |
| model-gateway → vLLM (streaming) | 600s | None | None |
| model-gateway → Ollama (models list) | 30s | None | None |
| dashboard → ops-controller | 30s | None | None |
| model-gateway → dashboard (throughput) | 5s | None | None (fire-and-forget) |
| ComfyUI URL download | 30s connect | None | None — no resume |
| RAG ingestion → model-gateway | httpx default | None | None |

**Missing:** No circuit breaker or backpressure mechanism anywhere. If Ollama is overloaded, all callers pile up concurrent requests.

### Observability

| Item | Status | Notes |
|---|---|---|
| Request logging middleware (model-gateway) | ✅ | Logs method, path, client IP, status |
| Audit log with correlation IDs (ops-controller) | ✅ | JSONL; `X-Request-ID` stored |
| Structured logging in dashboard | ❌ | `app.py` has no `logging.getLogger`; errors swallowed silently |
| Distributed tracing | ❌ | `X-Request-ID` forwarded dashboard→ops-controller but not to Ollama |
| Prometheus `/metrics` endpoint | ❌ | No metrics on any custom service |
| Log aggregation | ❌ | Each service writes to Docker json-file separately; no central view |
| Throughput stats persistence | ❌ | `_throughput_samples` in-memory; lost on restart |

### Findings

| ID | Severity | Evidence | Risk | Recommendation | PR Slice |
|---|---|---|---|---|---|
| R1 | **High** | ComfyUI download uses `urllib` with no resume | 22 GB download fails completely on any network blip | Rewrite with `httpx` Range requests + atomic temp-file rename | `fix/resumable-download` |
| R2 | **Medium** | No `start_period` on any healthcheck | Containers restart-loop during slow first-run model downloads | Add `start_period: 120s` to ollama, open-webui, comfyui | `fix/healthcheck-start-period` |
| R3 | **Medium** | `dashboard/app.py` has no structured logger | Errors silent; no operational visibility into dashboard failures | Add `logging.getLogger(__name__)` and replace silent `except` blocks | `fix/dashboard-structured-logging` |
| R4 | **Medium** | `_throughput_samples` and `_last_benchmark` in-memory only | Benchmark history vanishes after every dashboard redeploy | Persist to `data/dashboard/throughput.json` on write; load on startup | `feat/persist-throughput-stats` |
| R5 | **Low** | No Prometheus metrics endpoint | Cannot integrate with Grafana/alerting | Add `/metrics` via `prometheus-fastapi-instrumentator` | `feat/prometheus-metrics` |
| R6 | **Low** | `rag-ingestion` has no healthcheck | Unhealthy ingestion silently drops documents | Add healthcheck (check watchdog process alive via PID file) | `fix/rag-healthcheck` |
| R7 | **Low** | `psutil.disk_usage()` called synchronously in async `hardware_stats` handler | Blocks event loop on slow/network disks | Wrap in `asyncio.to_thread()` | `fix/hardware-async-io` |

---

## SECTION 6 — Docker / Container / Compose Audit

### Compose / Dockerfile Scorecard

| Service | Non-root | cap_drop | read_only | start_period | Resource limits | Image pinned | Log rotation |
|---|---|---|---|---|---|---|---|
| ollama | ✅ | ❌ | ❌ | ❌ | ✅ 8G | ✅ tag | ✅ |
| model-gateway | ✅ Dockerfile | ✅ | ✅ | ❌ | ✅ 512M | N/A (build) | ✅ |
| dashboard | ❌ **root (regression)** | ✅ | ✅ | ❌ | ✅ 256M | N/A (build) | ✅ |
| ops-controller | ✅ Dockerfile | ✅ | ❌ (writes .env) | ❌ | ✅ 256M | N/A (build) | ✅ |
| open-webui | ✅ internal | ❌ | ❌ | ❌ | ✅ 1G | ✅ tag | ✅ |
| comfyui | ❌ root (image limit) | ❌ | ❌ | ❌ | ✅ 4G | ⚠️ `:cpu` | ✅ |
| n8n | ✅ 1000:1000 | ❌ | ❌ | ❌ | ✅ 1G | ❌ **unpinned** | ✅ |
| mcp-gateway | ❌ unknown | ❌ | ❌ | ❌ | ✅ 512M | ❌ **`latest`** | ✅ |
| qdrant | ✅ Rust binary | ❌ | ❌ | ❌ | ✅ 512M | ✅ tag | ✅ |
| openclaw-gateway | ❌ unknown | ✅ | ❌ | ❌ | ✅ 2G | ❌ **`latest`** | ✅ |
| rag-ingestion | ✅ Dockerfile | ✅ | ✅ | ❌ | ✅ 256M | N/A (build) | ✅ |

### Networking / Port Exposure

```
# Publicly host-bound (0.0.0.0) — review each:
dashboard:       0.0.0.0:8080   ← control plane; auth optional
open-webui:      0.0.0.0:3000   ← chat UI; auth OFF by default ← S1
comfyui:         0.0.0.0:8188   ← image gen; NO auth           ← S4
n8n:             0.0.0.0:5678   ← automation; NO auth          ← S4
mcp-gateway:     0.0.0.0:8811   ← tool gateway; PRD M6 targets backend-only ← S6
openclaw:        0.0.0.0:18789  ← agent; token-gated ✅
openclaw-bridge: 0.0.0.0:18790  ← verify auth

# Internal only (correct):
ollama:          backend network, no host port ✅
model-gateway:   11435 (frontend+backend)
ops-controller:  9000 (backend only, no host port) ✅
qdrant:          6333 (backend only, no host port) ✅
```

### Suggested Diffs

**Restore dashboard non-root (Critical — D1/S2):**

```dockerfile
# dashboard/Dockerfile
FROM python:3.12-slim
WORKDIR /app

RUN useradd -m -u 1000 appuser   # restore

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app.py .
COPY static/ static/

EXPOSE 8080
USER appuser                      # restore
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8080"]
```

```yaml
# docker-compose.yml — dashboard service
dashboard:
  build: ./dashboard
  restart: unless-stopped
  user: "1000:1000"               # restore
  read_only: true
  tmpfs: [/tmp]
  cap_drop: [ALL]
  security_opt: [no-new-privileges:true]
```

```bash
# One-time host fix — run once after clone/pull:
chown -R 1000:1000 models/comfyui data/
```

**Flip WEBUI_AUTH default (Critical — S1):**

```yaml
# docker-compose.yml — open-webui environment
- WEBUI_AUTH=${WEBUI_AUTH:-True}   # was False
```

**Bind ComfyUI and N8N to localhost (High — S4):**

```yaml
comfyui:
  ports:
    - "127.0.0.1:8188:8188"

n8n:
  ports:
    - "127.0.0.1:5678:5678"
```

**Move mcp-gateway to backend only (High — S6 / PRD M6):**

```yaml
mcp-gateway:
  # remove ports: section entirely from base compose
  networks:
    - backend
```

**Add healthcheck start_period (Medium — R2):**

```yaml
ollama:
  healthcheck:
    test: ["CMD", "ollama", "list"]
    interval: 15s
    timeout: 10s
    retries: 5
    start_period: 120s      # add

open-webui:
  healthcheck:
    start_period: 120s      # add

comfyui:
  healthcheck:
    start_period: 120s      # add
```

### State / Volume Review

- ✅ All state in `data/` bind mounts — easy to `tar` for backup
- ✅ `docs/runbooks/BACKUP_RESTORE.md` referenced
- ❌ No documented one-liner backup command in README (a common first question)
- ❌ No volume lifecycle management — stale mounts if service removed

### Findings

| ID | Severity | Evidence | Risk | Recommendation | PR Slice |
|---|---|---|---|---|---|
| D1 | **Critical** | Dashboard runs as root; `USER appuser` removed from `dashboard/Dockerfile` | Regression against PRD G5; elevated container blast radius | Fix volume ownership; restore `USER appuser` + `user: "1000:1000"` | `fix/restore-dashboard-nonroot` |
| D2 | **Critical** | `WEBUI_AUTH=${WEBUI_AUTH:-False}` | Anyone on LAN can use the LLM stack | Change default to `True` per PRD M6 PR6-A | `fix/webui-auth-default-on` |
| D3 | **High** | ComfyUI and N8N bound to `0.0.0.0` without auth | LAN exposure | Bind to `127.0.0.1` | `fix/localhost-bind-unauthenticated` |
| D4 | **High** | `n8n`, `mcp-gateway`, `openclaw` images unpinned | Silent supply-chain mutation | Pin all to explicit semver tags | `fix/pin-all-images` |
| D5 | **High** | mcp-gateway on frontend network with host port (PRD M6 PR6-A) | Expanded attack surface | Move to backend-only; add `overrides/mcp-expose.yml` | `fix/mcp-gateway-backend-only` |
| D6 | **Medium** | No `start_period` on any healthcheck | First-run restart loops | Add `start_period: 120s` to slow-start services | `fix/healthcheck-start-period` |
| D7 | **Medium** | `rag-ingestion` has no healthcheck | Unhealthy ingestion undetectable | Add healthcheck | `fix/rag-healthcheck` |
| D8 | **Low** | No image digest pinning for any third-party image | Tag redirection possible | Add `@sha256:...` digest to all third-party images | `fix/image-digest-pinning` |

---

## SECTION 7 — Repo Organization & Engineering Standards Audit

### Structure / Ownership

**Good:**
- Clear per-service directories (`dashboard/`, `model-gateway/`, `ops-controller/`, `rag-ingestion/`, `mcp/`, `openclaw/`)
- `scripts/` for operational tooling
- `docs/` with runbooks, audit schema, and security policy
- PRD is detailed, living, and explicitly tracks milestones and gaps

**Gaps:**
- No `CODEOWNERS` file
- No `CONTRIBUTING.md`
- `ARCHITECTURE_RFC.md` listed in PRD §5 repo structure as `docs/ARCHITECTURE_RFC.md` but was deleted in commit `c98f0c3` with message "no longer needed" — the PRD still references it
- `tests/` exists (confirmed by PRD) but no CI runs them

### Testing Strategy

| Test | Status |
|---|---|
| Compose smoke tests | ✅ `tests/test_compose_smoke.py` |
| Dashboard API contract | ✅ `tests/test_dashboard_health.py` |
| Model gateway contract | ✅ `tests/test_model_gateway_contract.py` |
| Model gateway cache | ✅ `tests/test_model_gateway_cache.py` |
| Ops controller audit | ✅ `tests/test_ops_controller_audit.py` |
| MCP policy | ✅ `tests/test_mcp_policy.py` |
| RAG ingestion | ❌ PRD §5 WS6 lists `test_rag_ingestion.py` as planned for M6 |
| Dashboard SPA (UI) | ❌ No Jest/Playwright |
| Security headers | ❌ No test |

### CI/CD Gates

- ❌ No CI pipeline (GitHub Actions, GitLab CI, etc.) — PRD M6 item
- ❌ No pre-commit hooks (`.pre-commit-config.yaml` absent)
- ❌ No linting config (`ruff.toml`, `pyproject.toml`)
- ❌ No type-checking config (`mypy.ini`)
- ❌ No `CHANGELOG.md`
- ❌ No SBOM generation

### Documentation Quality

| Doc | Status |
|---|---|
| README / GETTING_STARTED | ✅ |
| SECURITY.md + threat table | ✅ |
| `docs/audit/SCHEMA.md` | ✅ |
| `docs/runbooks/TROUBLESHOOTING.md` | ✅ (referenced) |
| `docs/runbooks/BACKUP_RESTORE.md` | ✅ (referenced) |
| `docs/runbooks/UPGRADE.md` | ✅ (referenced) |
| `docs/runbooks/SECURITY_HARDENING.md` | ✅ (referenced) |
| `.env.example` | ✅ |
| ADR directory | ❌ No `docs/adr/` |
| `ARCHITECTURE_RFC.md` | ❌ Deleted; PRD still references it |
| `CONTRIBUTING.md` | ❌ Absent |
| `CODEOWNERS` | ❌ Absent |

### Findings

| ID | Severity | Evidence | Risk | Recommendation | PR Slice |
|---|---|---|---|---|---|
| O1 | **High** | No CI pipeline despite `tests/` directory existing | Quality regressions merge silently; PRD M6 names this explicitly | Add `.github/workflows/test.yml` per PRD §6 Step 4 template | `ci/add-github-actions` |
| O2 | **Medium** | `ARCHITECTURE_RFC.md` deleted; PRD still references it at `docs/ARCHITECTURE_RFC.md` | New contributors see a dangling reference; key decisions undocumented | Create `docs/adr/` with ADR-0001 capturing gateway pattern, ops-controller separation, bind mounts, MCP spawning, two-tier OpenClaw | `docs/add-adr-directory` |
| O3 | **Medium** | No pre-commit hooks | Formatting, secrets, lint issues commit freely | Add `pre-commit` with `ruff`, `detect-secrets`, `hadolint` | `ci/add-precommit` |
| O4 | **Low** | No `CODEOWNERS` | No clear ownership for review routing | Add `CODEOWNERS` mapping service dirs | `docs/add-codeowners` |
| O5 | **Low** | No `ruff.toml` or `pyproject.toml` | Code style inconsistency over time | Add `ruff.toml` with agreed rules | `ci/add-ruff-config` |

---

## SECTION 8 — Component Deep-Dives

### A) Model Runtime — Ollama

**Configuration Correctness:**
- `OLLAMA_HOST=0.0.0.0:11434` — binds to all interfaces inside the container. Combined with Docker network isolation (backend-only), acceptable
- `OLLAMA_NUM_CTX=16384` — correct CPU-optimisation cap per PRD WS1; prevents massive KV cache pre-allocation on CPU-only systems
- No `OLLAMA_MAX_LOADED_MODELS` set — multiple models can load simultaneously, potentially OOM-ing on constrained machines

**Network Boundary:**
- Per PRD §5 network table, Ollama is backend-only ✅
- Dashboard still reaches Ollama directly (architectural gap A1) — Ollama appears on the frontend network indirectly via dashboard's network memberships

**Auth:** None. Any service on the backend network can pull, delete, or generate. Acceptable for single-user; not for multi-user LAN deployment.

**Drift:** `OLLAMA_NUM_CTX` is set in both the compose `ollama` service env (server-side) and in model-gateway env (per-request option override). Intentional per code comments but confusing; document explicitly in `.env.example`.

### B) Agent Orchestrator — OpenClaw

**Configuration Correctness:**
- Three sync init-containers (`workspace-sync`, `config-sync`, `plugin-config`) are `restart: "no"` one-shots that must complete before gateway starts. If any fails, the gateway won't start and the failure is not surfaced clearly in `docker compose ps`
- `OPENCLAW_GATEWAY_TOKEN` is 32-byte hex — correct strength

**Security Posture (per PRD §9):**
- Two-tier model (gateway holds credentials, CLI/browser has none) is correctly implemented and aligns with PRD §9 trust model ✅
- `cap_drop: [ALL]` on gateway ✅
- Image is `latest` — supply-chain risk (see S5) ❌

**Policy:**
- OpenClaw accesses model-gateway and mcp-gateway — can call any available tool. No per-agent allowlist visible at OpenClaw layer; relies entirely on MCP `registry.json` policy

**Drift:**
- `openclaw-config-sync` runs `merge_gateway_config.py` to inject gateway config into `openclaw.json`. If `openclaw.json` schema changes upstream, the merge script breaks silently with no alerting

### C) Tool Gateway — MCP Gateway

**Configuration Correctness:**
- `gateway-wrapper.sh` polls for `servers.txt` changes and sends `SIGHUP` to reload — elegant hot-reload avoiding container restarts ✅
- `data/mcp/registry.json` provides per-tool policy (`allow_clients`, `scopes`, `rate_limit_rpm`, `timeout_sec`) ✅

**Security Posture:**
- Mounts full `docker.sock` — can spawn, stop, inspect any container on the host
- The sole guardrail is `allow_clients` in `registry.json` — but per PRD §1.3, this is **not yet enforced** at the gateway level (requires `X-Client-ID` support in Docker MCP Gateway, deferred to M6)
- Spawned MCP tool containers have no memory/CPU limits and inherit the default bridge network — can reach internal services
- mcp-gateway is on the frontend network with a host port (PRD M6 gap)

**PRD-confirmed gaps:** `allow_clients` enforcement and mcp-gateway network isolation are both explicitly listed in PRD §1.3 remaining gaps and M6 plan.

### D) Dashboard / Control Plane

**Configuration Correctness:**
- `MODELS_DIR=/models` correct; maps to `models/comfyui`
- `OPS_CONTROLLER_TOKEN` passed as env var — visible in `docker inspect`
- Auth middleware correctly gates all non-health routes when token is set

**Security Posture:**
- Currently running as **root** (regression from permission fix) — PRD's stated guarantee violated ❌
- No CSP, `X-Frame-Options`, or `X-Content-Type-Options` headers ❌
- `/api/throughput/record` is unauthenticated — per PRD it should require auth (`✓` in PRD §3.E table); this is a drift ❌
- `/api/comfyui/download` downloads arbitrary HTTPS URLs — SSRF risk if HTTPS validation is weakened

**Operability:**
- Frontend polls health every 15s — reasonable
- Hardware stats poll every 5s with synchronous `psutil.disk_usage()` in an async handler — blocks event loop on slow disks
- `_ollama_library_ts` cache (24h) is in-memory — every restart re-fetches from external URL

**API Drift from PRD §3.E:**
- `/api/throughput/record` listed in PRD as requiring auth (`✓`) but implementation has no auth check on this specific endpoint
- `/api/comfyui/download` and `/api/comfyui/download/status` are new endpoints not yet in PRD — need adding to PRD §3.E table

---

## SECTION 9 — Prioritized Remediation Plan

### Top 10 Issues (Ranked)

| Rank | ID | Severity | Issue | Impact | Effort | Risk |
|---|---|---|---|---|---|---|
| 1 | D1/S2 | **Critical** | Dashboard running as root — PRD regression | Elevated blast radius | Low | Low — host `chown` + 3 lines |
| 2 | D2/S1 | **Critical** | `WEBUI_AUTH=False` default — PRD M6 PR6-A undelivered | Anyone on LAN uses LLMs | Low | Low — 1-line + docs |
| 3 | D3/S4 | **High** | ComfyUI/N8N open on LAN without auth | Image gen and workflows exposed | Low | Low — add `127.0.0.1:` prefix |
| 4 | D4/S5 | **High** | n8n, mcp-gateway, openclaw images unpinned | Silent supply-chain mutation | Low | Low — add explicit tags |
| 5 | D5/S6 | **High** | mcp-gateway on frontend network — PRD M6 PR6-A undelivered | Expanded attack surface | Low | Low — network reassignment |
| 6 | S3 | **High** | No security headers on dashboard | XSS token theft | Low | Low — add middleware |
| 7 | O1 | **High** | No CI pipeline — PRD M6 item | Regressions merge silently | Medium | Low risk (additive) |
| 8 | R1/A3 | **High** | Non-resumable 22 GB download | Network blip fails entire download | Medium | Medium — replace urllib |
| 9 | S9 | **Medium** | SSRF block not auto-applied | Metadata endpoints reachable | Low | Low — call from ensure_dirs.sh |
| 10 | R3 | **Medium** | No structured logging in dashboard | Ops blind to failures | Low | Low — add logging module |

### "Do Now" (1–3 days)

These are all either PRD M6 items already scoped or zero-ambiguity regressions:

**1. Restore dashboard non-root** (`fix/restore-dashboard-nonroot`)
```bash
# Host
chown -R 1000:1000 models/comfyui data/
```
```dockerfile
# dashboard/Dockerfile — restore
RUN useradd -m -u 1000 appuser
USER appuser
```
```yaml
# docker-compose.yml — restore
user: "1000:1000"
```
```bash
docker compose build dashboard && docker compose up -d dashboard
```

**2. Enable WebUI auth by default** (`fix/webui-auth-default-on`)
```yaml
- WEBUI_AUTH=${WEBUI_AUTH:-True}   # was False
```
Update `UPGRADE.md`: users who want single-user open mode set `WEBUI_AUTH=False` in `.env`.

**3. Bind ComfyUI/N8N to localhost** (`fix/localhost-bind-unauthenticated`)
```yaml
comfyui:
  ports: ["127.0.0.1:8188:8188"]
n8n:
  ports: ["127.0.0.1:5678:5678"]
```

**4. Move mcp-gateway to backend network** (`fix/mcp-gateway-backend-only`)
```yaml
mcp-gateway:
  networks: [backend]
  # remove ports: section; add overrides/mcp-expose.yml for external access
```

**5. Pin unpinned images** (`fix/pin-all-images`)
- `docker.n8n.io/n8nio/n8n` → find and pin to current release tag
- `docker/mcp-gateway:latest` → pin to current release tag
- `ghcr.io/phioranex/openclaw-docker:latest` → pin to current release tag

**6. Add security headers to dashboard** (`fix/dashboard-security-headers`)
```python
@app.middleware("http")
async def security_headers(request: Request, call_next):
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Content-Security-Policy"] = (
        "default-src 'self'; "
        "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; "
        "font-src https://fonts.gstatic.com; "
        "script-src 'self' 'unsafe-inline'"
    )
    return response
```

**7. Add CI pipeline** (per PRD §6 Step 4 template) (`ci/add-github-actions`)
```yaml
# .github/workflows/test.yml
on: [push, pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: pip install -r tests/requirements.txt
      - run: python -m pytest tests/ -v --ignore=tests/test_compose_smoke.py
```

### "Next" (1–2 weeks)

8. **Auto-apply SSRF egress block** — call `ssrf-egress-block.sh` from `ensure_dirs.sh`; document exceptions needed for model downloads
9. **Resumable ComfyUI download** — rewrite `_run_comfyui_download` using `httpx` with `Range` header, atomic temp-file rename, and resume-on-reconnect
10. **Structured logging in dashboard** — replace all silent `except` blocks with `logger.error(...)`; add `logging.getLogger(__name__)` at module level
11. **Add `start_period` to slow healthchecks** — ollama, open-webui, comfyui
12. **Add rag-ingestion healthcheck** and `test_rag_ingestion.py` contract test (PRD M6)
13. **Fix `/api/throughput/record` auth** — endpoint is listed as auth-required in PRD §3.E but has no auth check

### "Later" (Strategic — PRD-aligned M6+ items)

14. **Route all model ops through gateway** — remove direct Ollama calls from dashboard; PRD Principle 4
15. **Persist throughput stats** — write `_throughput_samples` to `data/dashboard/throughput.json` periodically
16. **openclaw.json token externalisation** — move Telegram token + skill API keys to `.env` via `merge_gateway_config.py` (PRD M6)
17. **MCP per-client policy enforcement** — blocked on Docker MCP Gateway `X-Client-ID` support (PRD M6, external dep)
18. **RBAC read-only role** — view logs/health without start/stop access (PRD M6)
19. **Docker secrets migration** — replace env-var tokens with `/run/secrets/` mounts
20. **ADR directory** — document the 5 key architectural decisions per Section 7 O2

### Rollback Strategy for Risky Changes

| Change | Rollback |
|---|---|
| Dashboard non-root restore | If permission errors on specific path: `docker compose exec dashboard ls -la /models` to identify dir; `chown` that subdir; do not remove USER again |
| WebUI auth default-on | Users locked out on upgrade: set `WEBUI_AUTH=False` in `.env`; document in UPGRADE.md |
| Localhost binding | Remote users need SSH tunnel or Tailscale; document in README before releasing |
| mcp-gateway backend-only | If any service on frontend network needs MCP: create `overrides/mcp-expose.yml` as documented in PRD §6 Step 2 |

---

## SECTION 10 — Guardrails & Templates

### Definition of Done — New / Changed Service

```markdown
## Service DoD Checklist

### Code
- [ ] All endpoints have Pydantic request/response models
- [ ] All external HTTP calls have explicit timeouts
- [ ] No bare `except Exception: pass` — always log or re-raise
- [ ] Structured logging via `logging.getLogger(__name__)`
- [ ] No secrets in code or Dockerfile
- [ ] New env vars added to `.env.example` with description

### Container
- [ ] Non-root user in Dockerfile (`RUN useradd -m -u 1000 appuser` + `USER appuser`)
- [ ] `user: "1000:1000"` in compose (or justified exception documented)
- [ ] `cap_drop: [ALL]` in compose
- [ ] `read_only: true` where no host writes needed; `tmpfs: [/tmp]` added
- [ ] `security_opt: [no-new-privileges:true]`
- [ ] Image pinned to explicit semver tag (third-party: add `@sha256:` digest)
- [ ] Memory limit set in `deploy.resources.limits`
- [ ] Healthcheck defined with `start_period`
- [ ] Logging driver: `json-file`, `max-size: "10m"`, `max-file: "3"`

### Network
- [ ] Only necessary ports exposed
- [ ] Host-bound ports use `127.0.0.1:` prefix unless intentionally public
- [ ] Service placed on correct network(s) only (`frontend` if user-facing; `backend` if internal)
- [ ] New host port documented in README

### Tests
- [ ] Smoke/health test added or updated in `tests/test_compose_smoke.py`
- [ ] Contract test for any new API surface
- [ ] Auth test if endpoint has auth

### Docs
- [ ] `.env.example` updated
- [ ] README updated if user-facing change
- [ ] PRD `docs/Product Requirements Document.md` updated (capabilities table, endpoint table)
- [ ] ADR created if architectural decision made
- [ ] UPGRADE.md note if breaking change for existing users
```

### ADR Template

```markdown
# ADR-NNNN: [Short Title]

**Date:** YYYY-MM-DD
**Status:** Proposed | Accepted | Deprecated | Superseded by ADR-XXXX
**Deciders:** [names or roles]

## Context
[What is the problem or situation requiring a decision?]

## Decision
[What was decided?]

## Rationale
[Why this option over alternatives? List alternatives considered.]

## Consequences
### Positive
-
### Negative / Trade-offs
-
### Risks
-

## Implementation Notes
[Specific implementation details or constraints.]
```

### Threat Model Template

```markdown
# Threat Model: [Service/Feature Name]

**Date:** YYYY-MM-DD
**Scope:** [What is being modelled?]

## Assets
| Asset | Sensitivity | Location |
|---|---|---|

## Threat Table
| Asset | Threat | STRIDE Category | Attack Path | Likelihood (H/M/L) | Impact (H/M/L) | Mitigation | Status |
|---|---|---|---|---|---|---|---|

## Trust Boundaries
[Where trust changes: e.g., browser→dashboard (optional auth), dashboard→ops-controller (required bearer), ops-controller→docker.sock]

## Out of Scope
[Threats explicitly not addressed and rationale]
```

### Runbook Template

```markdown
# Runbook: [Service/Operation Name]

**Owner:** [team/role]
**Last tested:** YYYY-MM-DD

## Overview
[What does this service do? When is this runbook used?]

## Prerequisites
- [ ] Stack running: `docker compose ps`
- [ ] Tokens available: `grep OPS_CONTROLLER_TOKEN .env`

## Procedures

### Check Logs
```bash
docker compose logs --tail=100 -f <service>
```

### Health Check
```bash
curl -s http://localhost:<port>/health | jq
```

### Restart Service
```bash
# Via dashboard (preferred — audited):
# Dashboard → Services → <service> → Restart

# Direct (emergency):
docker compose restart <service>
```

## Common Failure Modes

| Symptom | Likely Cause | Resolution |
|---|---|---|
| Restart loop on first boot | Model download in progress; healthcheck too strict | Add `start_period: 120s` to healthcheck |
| `docker inspect` shows CAP_SYS_ADMIN | `cap_drop` missing from compose | Add `cap_drop: [ALL]` |
| Permission denied writing to /models | Container running as non-root; host dir owned by different uid | `chown -R 1000:1000 models/ data/` on host |

## Escalation
[Who to contact if runbook fails]
```

### Minimal "Golden" Compose Service Template

```yaml
services:
  my-service:
    build: ./my-service          # or: image: org/image:1.2.3@sha256:...
    restart: unless-stopped

    # Security
    user: "1000:1000"
    read_only: true
    tmpfs:
      - /tmp
    cap_drop: [ALL]
    security_opt: [no-new-privileges:true]

    # Ports (localhost-only unless explicitly public and documented)
    ports:
      - "127.0.0.1:8000:8000"

    # Resources
    deploy:
      resources:
        limits:
          memory: 256M

    # Health (with start_period for slow-start services)
    healthcheck:
      test: ["CMD", "python3", "-c",
             "import urllib.request; urllib.request.urlopen('http://localhost:8000/health')"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 30s

    # Logging
    logging:
      driver: json-file
      options:
        max-size: "10m"
        max-file: "3"

    # Environment (all secrets via .env, never hardcoded)
    environment:
      - MY_SERVICE_TOKEN=${MY_SERVICE_TOKEN:?MY_SERVICE_TOKEN is required}
      - MY_UPSTREAM_URL=${MY_UPSTREAM_URL:-http://upstream:8080}

    # Networks (minimal — backend unless user-facing)
    networks:
      - backend

networks:
  backend:
    external: true
    name: ai-toolkit-backend
```

---

## Appendix — PRD M6 Delivery Checklist

The following items are explicitly scoped in PRD §5 M6 and §6 "First PR". Current delivery status:

| M6 Item | PRD Reference | Status | Notes |
|---|---|---|---|
| `WEBUI_AUTH` default → `True` | §6 Step 1, PR6-A | ❌ Not done | Highest priority; 1-line change |
| mcp-gateway → backend-only | §6 Step 2, PR6-A | ❌ Not done | Part of same PR6-A |
| Audit log in-process rotation | §6 Step 3 | ✅ Done | `_maybe_rotate_audit_log()` exists; single backup only |
| CI pipeline | §6 Step 4 | ❌ Not done | Template in PRD §6 |
| MCP per-client policy enforcement | §5 M6 | ❌ Deferred | External dep on Docker MCP Gateway |
| openclaw.json token externalisation | §5 M6 | ❌ Deferred | `merge_gateway_config.py` expansion needed |
| RBAC read-only role | §5 M6 | ❌ Deferred | Low — noted as `L` effort |
| `test_rag_ingestion.py` | WS6 | ❌ Not done | |
| `nomic-embed-text` in model-puller defaults | WS6 | Unknown | Verify in compose model-puller env |

---

*Audit complete. All 10 sections delivered. Evidence-based, grounded in PRD `docs/Product Requirements Document.md` as source of truth.*

# openclaw-mcp-bridge

An MCP (Model Context Protocol) client plugin for [OpenClaw](https://github.com/openclaw/openclaw) that connects agents to remote MCP servers over **Streamable HTTP** with full **OAuth 2.1** authentication.

## Features

- **Streamable HTTP transport** — MCP 2025-03-26 spec compliant (POST/GET/DELETE + SSE)
- **stdio transport** — subprocess-based servers with newline-delimited JSON-RPC
- **Legacy SSE transport** — backwards-compatible HTTP+SSE (2024-11-05 spec)
- **OAuth 2.1 authentication** — PKCE (S256), dynamic client registration, RFC 9728 protected resource metadata, RFC 8414 auth server discovery
- **API key auth** — simple Bearer token alternative for servers that don't need OAuth
- **Multi-server management** — connect to many MCP servers simultaneously with automatic tool namespacing (`server__tool`)
- **Session management** — `Mcp-Session-Id` tracking, automatic re-initialization on session expiry
- **SSE resumability** — `Last-Event-ID` reconnection for broken streams
- **Dynamic tool discovery** — periodic re-discovery of server tools with configurable intervals
- **Hot config reload** — add/remove/update servers without restarting

## Requirements

- Node.js >= 22
- OpenClaw >= 2025.1.0

## Installation

```bash
npm install openclaw-mcp-bridge
```

## Configuration

Add to your `openclaw.json`:

```json
{
  "plugins": {
    "entries": {
      "openclaw-mcp-bridge": {
        "enabled": true,
        "config": {
          "servers": {
            "tavily": {
              "url": "https://mcp.tavily.com/mcp",
              "apiKey": "tvly-..."
            },
            "github": {
              "url": "https://mcp.github.com/sse",
              "auth": {
                "clientId": "your-client-id"
              }
            },
            "local-tools": {
              "url": "stdio://local",
              "transport": "stdio",
              "command": "npx",
              "args": ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"]
            }
          },
          "debug": false
        }
      }
    }
  }
}
```

### Server options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `url` | `string` | — | MCP server endpoint URL |
| `transport` | `"http" \| "stdio"` | `"http"` | Transport type |
| `command` | `string` | — | Command for stdio transport |
| `args` | `string[]` | — | Arguments for stdio command |
| `env` | `Record<string, string>` | — | Environment variables for stdio subprocess |
| `apiKey` | `string` | — | Static Bearer token |
| `auth` | `object` | — | OAuth 2.1 config (see below) |
| `auth.clientId` | `string` | — | Pre-registered OAuth client ID |
| `auth.clientSecret` | `string` | — | OAuth client secret (confidential clients) |
| `auth.authorizationServerUrl` | `string` | — | Override auth server URL |
| `auth.scopes` | `string[]` | — | Custom scopes to request |
| `toolPrefix` | `string` | server name | Namespace prefix for tools |
| `connectTimeoutMs` | `number` | `10000` | Connection timeout (ms) |
| `requestTimeoutMs` | `number` | `30000` | Per-request timeout (ms) |
| `enabled` | `boolean` | `true` | Enable/disable this server |

### Global options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `toolDiscoveryInterval` | `number` | `300000` | Re-discover tools every N ms |
| `maxConcurrentServers` | `number` | `20` | Max simultaneous connections |
| `debug` | `boolean` | `false` | Enable debug logging |

## Usage

Once configured, MCP tools appear as regular agent tools with namespaced names:

```
tavily__search
github__create_issue
local-tools__read_file
```

### Slash commands

| Command | Description |
|---------|-------------|
| `/mcp servers` | List all configured servers and their status |
| `/mcp tools` | List all discovered tools |
| `/mcp connect <server>` | Connect to a specific server |
| `/mcp disconnect <server>` | Disconnect from a server |
| `/mcp auth <server>` | Trigger OAuth authentication flow |

## Architecture

```
┌──────────────────────────────────────────────┐
│               OpenClaw Gateway               │
│                                              │
│  Skill (SKILL.md) ──▶ Plugin (Tool Ext)     │
│                          │                   │
│          ┌───────────────┼──────────┐        │
│          ▼               ▼          ▼        │
│    MCPManager      AuthManager   ToolRegistry│
│          │               │                   │
└──────────┼───────────────┼───────────────────┘
           │               │
           ▼               ▼
    ┌─────────────┐ ┌─────────────┐
    │ MCP Servers  │ │ Auth Server │
    └─────────────┘ └─────────────┘
```

## Development

```bash
# Install dependencies
pnpm install

# Build
pnpm build

# Run tests
pnpm test

# Watch mode
pnpm test:watch

# Coverage
pnpm test:coverage

# Type check
pnpm lint
```

## Project structure

```
src/
  index.ts                    Plugin entry point
  config-schema.ts            TypeBox configuration schema
  types.ts                    JSON-RPC 2.0 + MCP type definitions
  jsonrpc.ts                  JSON-RPC encode/decode/validate
  manager/
    mcp-manager.ts            Multi-server connection lifecycle
    tool-registry.ts          Dynamic tool registration + namespacing
  transport/
    streamable-http.ts        Streamable HTTP transport (POST/GET/DELETE + SSE)
    sse-parser.ts             Server-Sent Events stream parser
    stdio.ts                  stdio transport (subprocess)
    legacy-sse.ts             Backwards-compat HTTP+SSE
  auth/
    auth-manager.ts           OAuth 2.1 orchestrator
    discovery.ts              Protected Resource + Auth Server metadata
    pkce.ts                   PKCE S256 code challenge generation
    client-registration.ts    Dynamic Client Registration
    token-store.ts            Encrypted token persistence
    callback-server.ts        Local HTTP server for OAuth redirects
  commands/
    mcp-manage.ts             /mcp subcommand handler
skills/
  mcp/
    SKILL.md                  Agent-facing skill definition
```

## License

MIT

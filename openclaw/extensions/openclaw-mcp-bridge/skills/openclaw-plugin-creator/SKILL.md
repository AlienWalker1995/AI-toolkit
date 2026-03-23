---
name: openclaw-plugin-creator
description: >
  Create OpenClaw plugins from scratch. Knows the plugin SDK contract,
  manifest format, registration API, and packaging requirements.
user-invocable: false
---

# OpenClaw Plugin Creation Guide

Use this knowledge when creating, debugging, or modifying OpenClaw plugins.

## Plugin Structure

Every OpenClaw plugin needs these files at the project root:

```
my-plugin/
  openclaw.plugin.json    # Plugin manifest (REQUIRED)
  package.json            # Node.js package config
  tsconfig.json           # TypeScript config
  src/
    index.ts              # Entry point — exports { register }
  dist/                   # Compiled output (from tsc)
```

## 1. Plugin Manifest (`openclaw.plugin.json`)

This file is **required** and must be at the project root.

```json
{
  "id": "my-plugin-id",
  "name": "@scope/my-plugin",
  "version": "0.1.0",
  "label": "Human-Readable Name",
  "description": "What this plugin does",
  "extensions": ["./dist/index.js"],
  "slots": ["tool"],
  "configSchema": {
    "type": "object",
    "properties": {
      "myOption": { "type": "string", "default": "hello" }
    }
  }
}
```

### Manifest Rules

- `id` is **required** — must match what OpenClaw generates from the package name
  - Convention: if package is `@scope/plugin-foo`, id should be `plugin-foo`
- `configSchema` must be an **inline JSON Schema object**, NOT a file path string
  - OpenClaw checks `isRecord(raw.configSchema)` — strings will fail
- Do NOT use `format: "uri"` in JSON Schema — OpenClaw's validator ignores it and logs warnings
- `extensions` points to compiled JS entry point(s)
- `slots` declares what extension points the plugin uses (e.g., `["tool"]`)

## 2. Entry Point (`src/index.ts`)

The entry point must export a default object with a `register` function:

```typescript
import { Type } from "@sinclair/typebox";

// Tool type hierarchy (from @mariozechner/pi-ai + pi-agent-core):
//   Tool<TParams>     { name, description, parameters: TSchema }
//   AgentTool<TParams> extends Tool { label, execute(toolCallId, params, signal?) => AgentToolResult }
//   AgentToolResult    { content: [{type: "text", text}], details: unknown }

interface PluginApi {
  readonly id: string;
  readonly pluginConfig: unknown;  // Validated against configSchema
  readonly logger: { info: (msg: string) => void; warn: (msg: string) => void; error: (msg: string) => void };
  registerTool: (tool: AgentTool, opts?: { name?: string }) => void;
  registerHook: (events: string | string[], handler: Function, opts?: { name?: string; description?: string }) => void;
  registerHttpHandler: (handler: unknown) => void;
  registerHttpRoute: (params: { path: string; handler: unknown }) => void;
  registerChannel: (registration: unknown) => void;
  registerProvider: (provider: unknown) => void;
  registerGatewayMethod: (method: string, handler: Function) => void;
  registerCli: (registrar: unknown, opts?: unknown) => void;
  registerService: (service: unknown) => void;
  registerCommand: (command: unknown) => void;
}

function register(api: PluginApi): void {
  const config = api.pluginConfig as MyConfigType;

  api.registerTool({
    name: "my_tool",
    label: "My Tool",                    // REQUIRED — human-readable label
    description: "Does something useful",
    parameters: Type.Object({            // MUST use TypeBox schemas, not plain JSON Schema
      input: Type.String({ description: "The input value" }),
    }),
    async execute(toolCallId: string, params: Record<string, unknown>) {
      const input = params.input as string;
      // Must return AgentToolResult shape:
      return {
        content: [{ type: "text" as const, text: `Result for: ${input}` }],
        details: { input },
      };
    },
  });
}

export default { register };
```

### Registration Rules

- `register(api)` is called **synchronously** by OpenClaw
- If `register` returns a Promise, OpenClaw logs a warning and **ignores** it
- All async work must happen inside tool `execute()` functions or hook handlers
- Use lazy initialization pattern for async setup (connect on first tool call)
- `api.pluginConfig` contains the user's config validated against your `configSchema`

### Tool Registration

`api.registerTool(tool, opts?)` accepts:

1. **An AgentTool object** — registered directly
2. **A factory function** `(ctx) => AgentTool` — called later when tool is needed

The AgentTool must have: `name`, `label`, `description`, `parameters` (TypeBox), `execute(toolCallId, params) => AgentToolResult`.

**Important**: `parameters` MUST be a TypeBox schema (`Type.Object({...})`), NOT a plain JSON Schema object. `label` is required. `execute` receives `(toolCallId, params)` not just `(args)`. Return value must be `{ content: [{type: "text", text: "..."}], details: ... }`.

### Hook Registration

```typescript
api.registerHook("gateway_stop", async () => {
  // Cleanup logic
}, { name: "my-cleanup", description: "Clean up resources" });
```

Available hook events: `before_agent_start`, `llm_input`, `llm_output`, `agent_end`, `before_compaction`, `after_compaction`, `before_reset`, `message_received`, `message_sending`, `message_sent`, `before_tool_call`, `after_tool_call`, `tool_result_persist`, `session_start`, `session_end`, `gateway_start`, `gateway_stop`.

### Lazy Async Initialization Pattern

Since `register()` is synchronous but most plugins need async setup:

```typescript
import { Type } from "@sinclair/typebox";

function register(api: PluginApi): void {
  let initialized = false;
  let connection: MyConnection | null = null;

  const ensureInit = async () => {
    if (initialized) return;
    connection = await MyConnection.create(api.pluginConfig);
    initialized = true;
  };

  api.registerTool({
    name: "my_tool",
    label: "My Tool",
    description: "Does something with the connection",
    parameters: Type.Object({
      query: Type.String({ description: "The query to run" }),
    }),
    async execute(toolCallId: string, params: Record<string, unknown>) {
      await ensureInit();
      const result = await connection!.doStuff(params);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
        details: result,
      };
    },
  });

  api.registerHook("gateway_stop", async () => {
    if (connection) await connection.close();
  }, { name: "my-shutdown", description: "Close connection" });
}
```

## 3. Package Configuration (`package.json`)

```json
{
  "name": "@scope/plugin-my-plugin",
  "version": "0.1.0",
  "type": "module",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "files": ["dist"],
  "scripts": {
    "build": "tsc",
    "prepare": "tsc"
  },
  "engines": { "node": ">=22" },
  "peerDependencies": {
    "openclaw": ">=2025.1.0"
  }
}
```

- `"prepare": "tsc"` enables `pnpm add github:user/repo` installs
- `"type": "module"` is required for ESM
- `"files": ["dist"]` limits what's published

## 4. TypeScript Configuration (`tsconfig.json`)

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "outDir": "dist",
    "declaration": true,
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true
  },
  "include": ["src"]
}
```

## 5. Installation & Testing

```bash
# Build
pnpm build

# Install locally (symlinked for development)
openclaw plugins install --link .

# Restart gateway to load plugin
openclaw gateway restart

# Uninstall
openclaw plugins uninstall <plugin-id>
```

### Common Errors

| Error | Cause | Fix |
|-------|-------|-----|
| `plugin manifest not found` | Missing `openclaw.plugin.json` | Create it at project root |
| `plugin manifest requires id` | No `id` field in manifest | Add `"id": "my-plugin"` |
| `plugin manifest requires configSchema` | `configSchema` is a string path | Make it an inline JSON Schema object |
| `missing register/activate export` | Entry point doesn't export `register` | Export `default { register }` |
| `plugin not found: X` | Config entry key doesn't match manifest `id` | Align the `id` with what OpenClaw expects |
| `invalid config` | User config doesn't match schema | Check `required` fields, add `default` values |
| `async registration is ignored` | `register()` returned a Promise | Make `register()` synchronous |

## 6. Publishing

Users can install directly from GitHub:

```bash
pnpm add github:user/repo-name
```

The `prepare` script in `package.json` ensures `tsc` runs automatically.

For local development with live reload:

```bash
openclaw plugins install --link .
# Edit code, run pnpm build, restart gateway
openclaw gateway restart
```

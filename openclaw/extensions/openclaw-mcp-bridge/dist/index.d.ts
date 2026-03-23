/**
 * Plugin entry point for the OpenClaw MCP client plugin.
 *
 * Implements the OpenClaw plugin SDK contract: exports a default object
 * with a `register(api)` function that registers MCP tools via
 * `api.registerTool()`.
 *
 * @see SPEC.md section 6.4 for the plugin entry point specification.
 */
import { Type } from "@sinclair/typebox";
import type { ConfigSchemaType } from "./config-schema.js";
import type { MCPToolInput, ToolsCallResult } from "./types.js";
/**
 * Content block returned in AgentToolResult.
 */
type TextContent = {
    type: "text";
    text: string;
};
/**
 * Result shape required by AgentTool.execute().
 */
interface AgentToolResult {
    content: TextContent[];
    details: unknown;
}
/**
 * An AgentTool that can be registered with OpenClaw via api.registerTool().
 * Must use TypeBox schemas for `parameters` (not plain JSON Schema).
 */
interface AgentTool {
    name: string;
    label: string;
    description: string;
    parameters: ReturnType<typeof Type.Object>;
    execute: (toolCallId: string, params: Record<string, unknown>, signal?: AbortSignal) => Promise<AgentToolResult>;
}
/**
 * Return value from a before_prompt_build hook handler.
 */
interface PromptBuildResult {
    appendSystemContext?: string;
}
/**
 * The API object passed to register() by OpenClaw's plugin runtime.
 */
interface PluginApi {
    readonly id: string;
    readonly pluginConfig: ConfigSchemaType;
    readonly logger: {
        info: (msg: string) => void;
        warn: (msg: string, ...args: unknown[]) => void;
        error: (msg: string) => void;
    };
    registerTool: (tool: AgentTool, opts?: {
        name?: string;
    }) => void;
    registerHook: (events: string | string[], handler: (...args: unknown[]) => void, opts?: Record<string, unknown>) => void;
    on: (event: string, handler: (...args: unknown[]) => Promise<PromptBuildResult | Record<string, never>>, opts?: {
        priority?: number;
    }) => void;
}
/**
 * Register function called synchronously by OpenClaw's plugin runtime.
 *
 * Since MCP server connections are async but register() must be synchronous,
 * we register tool factories that lazily connect on first invocation.
 *
 * @param api - The OpenClaw plugin API.
 */
declare function register(api: PluginApi): void;
/**
 * Context passed to plugin.initialize().
 */
export interface PluginContext {
    config: ConfigSchemaType;
}
/**
 * A tool definition returned by plugin.initialize().
 */
export interface ToolDefinition {
    /** Namespaced tool name (e.g. "server__echo"). */
    name: string;
    /** Human-readable description. */
    description: string;
    /** JSON Schema for the tool's input parameters. */
    inputSchema: MCPToolInput;
    /** Execute the tool with the given arguments. */
    execute: (args: Record<string, unknown>) => Promise<ToolsCallResult>;
}
/**
 * Result returned by plugin.initialize().
 */
export interface PluginResult {
    /** Discovered tools from all connected MCP servers. */
    tools: ToolDefinition[];
    /** Gracefully shut down all MCP server connections. */
    onShutdown?: () => Promise<void>;
    /** Reconcile connections when plugin config changes. */
    onConfigChange?: (newConfig: ConfigSchemaType) => Promise<void>;
}
/**
 * Standalone plugin object with an async initialize() method.
 *
 * Connects to all configured MCP servers eagerly, discovers tools,
 * and returns them as ToolDefinition objects with bound execute functions.
 *
 * @param context - The plugin context containing configuration.
 * @returns A PluginResult with tools, shutdown, and config-change callbacks.
 */
export declare const plugin: {
    initialize(context: PluginContext): Promise<PluginResult>;
};
declare const _default: {
    register: typeof register;
};
export default _default;
export { MCPManager } from "./manager/mcp-manager.js";
export type { MCPManagerConfig, ServerConnection } from "./manager/mcp-manager.js";
export { ToolRegistry } from "./manager/tool-registry.js";
export type { RegisteredTool, ToolRegistryConfig } from "./manager/tool-registry.js";
export { StreamableHTTPTransport } from "./transport/streamable-http.js";
export type { StreamableHTTPConfig } from "./transport/streamable-http.js";
export { StdioTransport } from "./transport/stdio.js";
export type { StdioTransportConfig } from "./transport/stdio.js";
export { SSEParser, parseSSEStream } from "./transport/sse-parser.js";
export { configSchema } from "./config-schema.js";
export type { ConfigSchemaType, MCPServerConfigType, ServerAuthConfigType, } from "./config-schema.js";
export { MCPError } from "./types.js";
export type { JsonRpcRequest, JsonRpcResponse, JsonRpcSuccessResponse, JsonRpcErrorResponse, JsonRpcNotification, JsonRpcBatch, JsonRpcMessage, MCPTool, MCPToolInput, ToolsCallResult, ToolsListResult, InitializeResult, ConnectionStatus, SessionState, SSEEvent, } from "./types.js";
//# sourceMappingURL=index.d.ts.map
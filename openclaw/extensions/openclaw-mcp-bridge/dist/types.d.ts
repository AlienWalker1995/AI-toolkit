/**
 * Core type definitions for the MCP client plugin.
 *
 * Includes JSON-RPC 2.0 message types, MCP-specific protocol types,
 * transport-level types, and the base error class.
 *
 * @see https://www.jsonrpc.org/specification for JSON-RPC 2.0
 * @see https://modelcontextprotocol.io/specification/2025-03-26 for MCP
 */
/** A JSON-RPC 2.0 request object. */
export interface JsonRpcRequest {
    readonly jsonrpc: "2.0";
    readonly id: string | number;
    readonly method: string;
    readonly params?: Record<string, unknown> | unknown[];
}
/** A successful JSON-RPC 2.0 response object. */
export interface JsonRpcSuccessResponse {
    readonly jsonrpc: "2.0";
    readonly id: string | number | null;
    readonly result: unknown;
}
/** A JSON-RPC 2.0 error detail object. */
export interface JsonRpcErrorDetail {
    readonly code: number;
    readonly message: string;
    readonly data?: unknown;
}
/** A JSON-RPC 2.0 error response object. */
export interface JsonRpcErrorResponse {
    readonly jsonrpc: "2.0";
    readonly id: string | number | null;
    readonly error: JsonRpcErrorDetail;
}
/** A JSON-RPC 2.0 response — either success or error. */
export type JsonRpcResponse = JsonRpcSuccessResponse | JsonRpcErrorResponse;
/** A JSON-RPC 2.0 notification (a request with no id). */
export interface JsonRpcNotification {
    readonly jsonrpc: "2.0";
    readonly method: string;
    readonly params?: Record<string, unknown> | unknown[];
}
/**
 * A JSON-RPC 2.0 batch: an array of requests, notifications, and/or responses.
 * Per the spec, a batch MUST contain at least one element.
 */
export type JsonRpcBatch = ReadonlyArray<JsonRpcRequest | JsonRpcNotification | JsonRpcResponse>;
/** Union of all possible JSON-RPC 2.0 message types. */
export type JsonRpcMessage = JsonRpcRequest | JsonRpcResponse | JsonRpcNotification;
/** Client capabilities advertised during initialization. */
export interface MCPCapabilities {
    readonly roots?: {
        readonly listChanged?: boolean;
    };
    readonly sampling?: Record<string, unknown>;
    readonly experimental?: Record<string, unknown>;
}
/** Server information returned during initialization. */
export interface MCPServerInfo {
    readonly name: string;
    readonly version: string;
}
/** MCP Initialize request params. */
export interface InitializeRequestParams {
    readonly protocolVersion: string;
    readonly capabilities: MCPCapabilities;
    readonly clientInfo: {
        readonly name: string;
        readonly version: string;
    };
    readonly [key: string]: unknown;
}
/** MCP Initialize request (JSON-RPC wrapper). */
export interface InitializeRequest extends JsonRpcRequest {
    readonly method: "initialize";
    readonly params: InitializeRequestParams;
}
/** MCP Initialize result (returned by the server). */
export interface InitializeResult {
    readonly protocolVersion: string;
    readonly capabilities: Record<string, unknown>;
    readonly serverInfo: MCPServerInfo;
    readonly instructions?: string;
}
/** MCP tools/list request (JSON-RPC wrapper). */
export interface ToolsListRequest extends JsonRpcRequest {
    readonly method: "tools/list";
    readonly params?: {
        readonly cursor?: string;
    };
}
/** Schema definition for a tool's input parameters. */
export interface MCPToolInput {
    readonly type: "object";
    readonly properties?: Record<string, unknown>;
    readonly required?: readonly string[];
    readonly additionalProperties?: boolean;
    readonly [key: string]: unknown;
}
/** A single tool definition from tools/list. */
export interface MCPTool {
    readonly name: string;
    readonly description?: string;
    readonly inputSchema: MCPToolInput;
}
/** MCP tools/list result. */
export interface ToolsListResult {
    readonly tools: readonly MCPTool[];
    readonly nextCursor?: string;
}
/** MCP tools/call request params. */
export interface ToolsCallRequestParams {
    readonly name: string;
    readonly arguments?: Record<string, unknown>;
    readonly [key: string]: unknown;
}
/** MCP tools/call request (JSON-RPC wrapper). */
export interface ToolsCallRequest extends JsonRpcRequest {
    readonly method: "tools/call";
    readonly params: ToolsCallRequestParams;
}
/** Content item within a tools/call result. */
export interface MCPToolResultContent {
    readonly type: "text" | "image" | "resource";
    readonly text?: string;
    readonly data?: string;
    readonly mimeType?: string;
    readonly resource?: {
        readonly uri: string;
        readonly mimeType?: string;
        readonly text?: string;
        readonly blob?: string;
    };
    readonly [key: string]: unknown;
}
/** MCP tools/call result. */
export interface ToolsCallResult {
    readonly content: readonly MCPToolResultContent[];
    readonly isError?: boolean;
}
/** A parsed Server-Sent Event. */
export interface SSEEvent {
    /** The event type (from the `event:` field). Defaults to "message". */
    readonly event: string;
    /** The event data (from one or more `data:` lines, joined by newlines). */
    readonly data: string;
    /** The event ID (from the `id:` field), if present. */
    readonly id?: string;
    /** The retry interval in milliseconds (from the `retry:` field), if present. */
    readonly retry?: number;
}
/** Possible connection statuses for an MCP server transport. */
export type ConnectionStatus = "disconnected" | "connecting" | "connected" | "error";
/** Runtime session state for an MCP server connection. */
export interface SessionState {
    /** The MCP session ID assigned by the server (from Mcp-Session-Id header). */
    readonly sessionId: string | null;
    /** Current connection status. */
    readonly status: ConnectionStatus;
    /** The last SSE event ID received (for resumability via Last-Event-ID). */
    readonly lastEventId: string | null;
    /** Server information from the initialize handshake. */
    readonly serverInfo: MCPServerInfo | null;
    /** The negotiated protocol version. */
    readonly protocolVersion: string | null;
}
/**
 * Base error class for all MCP client errors.
 *
 * Extends the built-in Error with a numeric `code` field for JSON-RPC
 * error codes or application-specific error codes.
 */
export declare class MCPError extends Error {
    /** Numeric error code (JSON-RPC or application-specific). */
    readonly code: number;
    /**
     * Create a new MCPError.
     *
     * @param message - Human-readable error description.
     * @param code - Numeric error code.
     */
    constructor(message: string, code: number);
}
//# sourceMappingURL=types.d.ts.map
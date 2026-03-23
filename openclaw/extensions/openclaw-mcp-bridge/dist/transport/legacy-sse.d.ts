/**
 * Legacy SSE transport for MCP servers using the 2024-11-05 transport spec.
 *
 * Implements the older HTTP+SSE transport protocol where:
 * 1. Client opens a persistent SSE stream via GET to the server URL
 * 2. Server sends an `endpoint` event containing the POST URL for JSON-RPC messages
 * 3. Client POSTs JSON-RPC requests to that endpoint URL
 * 4. Server responds to POSTs with JSON-RPC responses (application/json)
 * 5. Server can also push notifications via the SSE stream
 *
 * This is distinct from the Streamable HTTP transport (2025-03-26 spec) where
 * POST responses may themselves be SSE streams.
 *
 * @see https://spec.modelcontextprotocol.io/2024-11-05/basic/transports/#http-with-sse
 * @module
 */
import type { JsonRpcResponse, JsonRpcMessage, InitializeResult, InitializeRequestParams } from "../types.js";
import { MCPError } from "../types.js";
/** Configuration options for the Legacy SSE transport. */
export interface LegacySSEConfig {
    /** Base URL of the MCP server (the SSE endpoint). */
    readonly url: string;
    /** Optional API key for Bearer auth. */
    readonly apiKey?: string;
    /** Request timeout in ms (default: 30000). */
    readonly requestTimeoutMs?: number;
    /** Connection timeout in ms (default: 10000). */
    readonly connectTimeoutMs?: number;
}
/**
 * Error thrown when a request exceeds the configured timeout.
 */
export declare class RequestTimeoutError extends MCPError {
    /**
     * Create a new RequestTimeoutError.
     *
     * @param message - Human-readable description.
     */
    constructor(message: string);
}
/**
 * MCP Legacy SSE transport.
 *
 * Implements the MCP 2024-11-05 HTTP+SSE transport protocol, where a
 * persistent SSE connection is opened via GET, and JSON-RPC messages are
 * sent via POST to an endpoint URL provided by the server through the
 * SSE stream.
 */
export declare class LegacySSETransport {
    private readonly url;
    private readonly apiKey;
    private readonly requestTimeoutMs;
    private readonly connectTimeoutMs;
    /** The endpoint URL received from the server's `endpoint` SSE event. */
    private endpointUrl;
    /** AbortController for the persistent SSE connection. */
    private sseAbortController;
    /** Whether the SSE connection is currently active. */
    private _isConnected;
    /** Auto-incrementing request ID counter. */
    private nextRequestId;
    /** Background SSE stream processing promise (for cleanup). */
    private sseStreamPromise;
    /**
     * Callback invoked when a server-initiated notification arrives
     * via the SSE stream. Set by the caller if needed.
     */
    onNotification: ((message: JsonRpcMessage) => void) | null;
    /**
     * Create a new LegacySSETransport.
     *
     * @param config - Transport configuration including the server URL and optional settings.
     */
    constructor(config: LegacySSEConfig);
    /**
     * Whether the transport is connected (SSE stream is active and endpoint
     * URL has been received).
     */
    get isConnected(): boolean;
    /**
     * Open the SSE connection, wait for the endpoint event, then perform
     * the MCP initialize handshake.
     *
     * Steps:
     * 1. Send GET request to the server URL to open the SSE stream
     * 2. Wait for the `endpoint` event containing the POST URL
     * 3. Send `initialize` JSON-RPC request via POST
     * 4. Send `notifications/initialized` notification
     *
     * @param params - The MCP InitializeRequestParams.
     * @returns The server's InitializeResult.
     * @throws {MCPError} If the connection or handshake fails.
     * @throws {RequestTimeoutError} If the connection times out.
     */
    initialize(params: InitializeRequestParams): Promise<InitializeResult>;
    /**
     * Send a JSON-RPC request via POST to the endpoint URL.
     *
     * The endpoint URL must have been received from the SSE `endpoint` event
     * during {@link initialize}.
     *
     * @param method - The JSON-RPC method name.
     * @param params - Optional method parameters.
     * @returns The JSON-RPC response.
     * @throws {MCPError} If the transport is not connected or the request fails.
     * @throws {RequestTimeoutError} If the request exceeds requestTimeoutMs.
     */
    sendRequest(method: string, params?: Record<string, unknown>): Promise<JsonRpcResponse>;
    /**
     * Send a JSON-RPC notification (no response expected) via POST to the
     * endpoint URL.
     *
     * @param method - The notification method name.
     * @param params - Optional notification parameters.
     * @throws {MCPError} If the transport is not connected or the request fails.
     * @throws {RequestTimeoutError} If the request exceeds requestTimeoutMs.
     */
    sendNotification(method: string, params?: Record<string, unknown>): Promise<void>;
    /**
     * Close the SSE connection and clean up resources.
     *
     * Aborts the persistent GET request that maintains the SSE stream.
     * After calling close, the transport is no longer connected and
     * must be re-initialized before sending further requests.
     */
    close(): Promise<void>;
    /**
     * Generate the next auto-incrementing request ID.
     *
     * @returns A unique numeric request ID.
     */
    private nextId;
    /**
     * Build the standard headers for POST requests to the endpoint URL.
     *
     * Includes Content-Type, Accept, and optionally Authorization.
     *
     * @returns A headers record suitable for use with fetch().
     */
    private buildPostHeaders;
    /**
     * Build the headers for the initial SSE GET request.
     *
     * Includes Accept for SSE and optionally Authorization.
     *
     * @returns A headers record suitable for use with fetch().
     */
    private buildSSEHeaders;
    /**
     * Resolve a potentially relative endpoint URL against the base server URL.
     *
     * The `endpoint` event from the server may contain a relative path
     * (e.g., "/messages?sessionId=abc") or a full URL. This method resolves
     * it against the server's base URL.
     *
     * @param endpoint - The endpoint URL from the SSE `endpoint` event.
     * @returns The fully resolved URL string.
     */
    private resolveEndpointUrl;
    /**
     * Open the persistent SSE connection to the server and wait for the
     * `endpoint` event.
     *
     * Sends a GET request with `Accept: text/event-stream`, parses the
     * incoming SSE stream, and resolves when the first `endpoint` event
     * is received. Subsequent SSE events are processed in the background
     * for server-initiated notifications.
     *
     * @throws {MCPError} If the connection fails or no endpoint event is received.
     * @throws {RequestTimeoutError} If the connection times out.
     */
    private openSSEConnection;
    /**
     * Consume SSE events from the iterator until an `endpoint` event is found.
     *
     * @param iterator - The async generator of SSE events.
     * @returns The endpoint URL string from the `endpoint` event's data field.
     * @throws {MCPError} If the stream ends without an endpoint event.
     */
    private waitForEndpointEvent;
    /**
     * Process the remaining SSE stream events in the background.
     *
     * After the `endpoint` event has been received, the SSE stream remains
     * open for server-initiated notifications. This method consumes those
     * events and dispatches them via the {@link onNotification} callback.
     *
     * @param iterator - The async generator of SSE events (already past the endpoint event).
     */
    private processBackgroundSSEStream;
    /**
     * Parse a JSON-RPC message from an SSE event's data and dispatch it.
     *
     * Malformed messages are silently ignored to maintain stream resilience.
     *
     * @param data - The raw string data from an SSE `message` event.
     */
    private handleSSEMessage;
}
//# sourceMappingURL=legacy-sse.d.ts.map
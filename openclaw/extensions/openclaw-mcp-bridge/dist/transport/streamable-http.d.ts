/**
 * MCP Streamable HTTP transport implementation.
 *
 * Implements the MCP 2025-03-26 Streamable HTTP transport spec:
 * POST for sending JSON-RPC requests/notifications, GET for opening
 * server-initiated SSE streams, and DELETE for session termination.
 *
 * Handles both `application/json` and `text/event-stream` response types,
 * session management via `Mcp-Session-Id`, and SSE resumability via
 * `Last-Event-ID`.
 *
 * @see https://modelcontextprotocol.io/specification/2025-03-26/basic/transports
 * @module
 */
import type { JsonRpcResponse, JsonRpcMessage, MCPCapabilities, InitializeResult } from "../types.js";
import { MCPError } from "../types.js";
/** Configuration options for the Streamable HTTP transport. */
export interface StreamableHTTPConfig {
    /** MCP server endpoint URL. */
    readonly url: string;
    /** Timeout for individual requests in milliseconds. Default: 30000. */
    readonly requestTimeoutMs?: number;
    /** Timeout for the initial connection/handshake in milliseconds. Default: 10000. */
    readonly connectTimeoutMs?: number;
    /** Authorization header value (e.g., "Bearer <token>"), set by the auth layer. */
    readonly authorizationHeader?: string;
}
/**
 * Error thrown when the MCP session has expired (server returned HTTP 404).
 *
 * The caller should discard the session and re-initialize.
 */
export declare class SessionExpiredError extends MCPError {
    /**
     * Create a new SessionExpiredError.
     *
     * @param message - Human-readable description.
     */
    constructor(message: string);
}
/**
 * Error thrown when the server requires authentication (HTTP 401).
 *
 * Contains the `WWW-Authenticate` header value for the auth layer to
 * parse and initiate the appropriate authentication flow.
 */
export declare class AuthRequiredError extends MCPError {
    /** The value of the WWW-Authenticate response header. */
    readonly wwwAuthenticate: string;
    /**
     * Create a new AuthRequiredError.
     *
     * @param message - Human-readable description.
     * @param wwwAuthenticate - The WWW-Authenticate header value from the 401 response.
     */
    constructor(message: string, wwwAuthenticate: string);
}
/**
 * Error thrown when the server returns HTTP 403 indicating the current
 * token lacks the required scopes.
 *
 * Contains the scope value extracted from the `WWW-Authenticate` header.
 */
export declare class InsufficientScopeError extends MCPError {
    /** The required scope(s) from the WWW-Authenticate header. */
    readonly scope: string;
    /**
     * Create a new InsufficientScopeError.
     *
     * @param message - Human-readable description.
     * @param scope - The required scope(s) from the WWW-Authenticate header.
     */
    constructor(message: string, scope: string);
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
 * MCP Streamable HTTP transport.
 *
 * Implements the MCP 2025-03-26 Streamable HTTP transport protocol, which
 * uses a single HTTP endpoint for all communication:
 * - POST for sending JSON-RPC requests and notifications
 * - GET for opening server-initiated SSE streams
 * - DELETE for session termination
 *
 * Responses may be either `application/json` (single response) or
 * `text/event-stream` (SSE stream containing one or more JSON-RPC messages).
 */
export declare class StreamableHTTPTransport {
    private readonly url;
    private readonly requestTimeoutMs;
    private readonly connectTimeoutMs;
    private authorizationHeader;
    /** The MCP session ID assigned by the server. */
    private sessionId;
    /** The last SSE event ID received, for resumability. */
    private lastEventId;
    /** Auto-incrementing request ID counter. */
    private nextRequestId;
    /**
     * Create a new StreamableHTTPTransport.
     *
     * @param config - Transport configuration including the server URL and optional timeouts.
     */
    constructor(config: StreamableHTTPConfig);
    /**
     * Perform the MCP initialize handshake.
     *
     * Sends an `InitializeRequest` to the MCP server, stores the session ID
     * from the response headers if present, and then sends the
     * `notifications/initialized` notification.
     *
     * @param clientInfo - Client name and version to advertise.
     * @param capabilities - Client capabilities to advertise.
     * @returns The server's InitializeResult.
     * @throws {AuthRequiredError} If the server returns 401.
     * @throws {MCPError} If the server returns an unexpected error.
     */
    initialize(clientInfo: {
        name: string;
        version: string;
    }, capabilities: MCPCapabilities): Promise<InitializeResult>;
    /**
     * Send a JSON-RPC request and return the response.
     *
     * Handles both `application/json` and `text/event-stream` response types.
     * For SSE responses, consumes the stream and returns the response matching
     * the request ID.
     *
     * @param method - The JSON-RPC method name.
     * @param params - Optional method parameters.
     * @returns The JSON-RPC response matching the request ID.
     * @throws {SessionExpiredError} If the server returns 404 (session expired).
     * @throws {AuthRequiredError} If the server returns 401.
     * @throws {InsufficientScopeError} If the server returns 403.
     * @throws {RequestTimeoutError} If the request exceeds requestTimeoutMs.
     */
    sendRequest(method: string, params?: unknown): Promise<JsonRpcResponse>;
    /**
     * Send a JSON-RPC notification (a request with no id, expecting no response).
     *
     * Notifications are sent as POST requests. The server should respond with
     * 202 Accepted.
     *
     * @param method - The notification method name.
     * @param params - Optional notification parameters.
     * @throws {SessionExpiredError} If the server returns 404.
     * @throws {AuthRequiredError} If the server returns 401.
     * @throws {RequestTimeoutError} If the request exceeds requestTimeoutMs.
     */
    sendNotification(method: string, params?: unknown): Promise<void>;
    /**
     * Send a batch of JSON-RPC requests and match responses by id.
     *
     * Constructs a JSON-RPC 2.0 batch request array, POSTs it to the server
     * endpoint, and matches each response back to the original request by its
     * `id`. The returned array preserves the same order as the input `requests`
     * array.
     *
     * Handles both `application/json` responses (a JSON array of response
     * objects) and `text/event-stream` responses (SSE events each containing
     * one or more response objects from the batch).
     *
     * @param requests - Array of `{ method, params }` to batch together.
     * @returns Array of JsonRpcResponse matched to the input order.
     * @throws {SessionExpiredError} If the server returns 404 (session expired).
     * @throws {AuthRequiredError} If the server returns 401.
     * @throws {InsufficientScopeError} If the server returns 403.
     * @throws {RequestTimeoutError} If the request exceeds requestTimeoutMs.
     * @throws {MCPError} If a response for any request is missing.
     */
    sendBatch(requests: Array<{
        method: string;
        params?: Record<string, unknown>;
    }>): Promise<JsonRpcResponse[]>;
    /**
     * Open a server-initiated SSE stream via GET.
     *
     * Sends a GET request to the MCP endpoint with `Accept: text/event-stream`
     * and yields parsed JSON-RPC messages as they arrive. Includes the
     * `Last-Event-ID` header if resuming a previously interrupted stream.
     *
     * If the server returns 405 Method Not Allowed (indicating it does not
     * support GET-based SSE streams), the generator returns immediately
     * without yielding any messages.
     *
     * @returns An async generator that yields JSON-RPC messages from the server stream.
     * @throws {SessionExpiredError} If the server returns 404.
     * @throws {AuthRequiredError} If the server returns 401.
     */
    openServerStream(): Promise<AsyncGenerator<JsonRpcMessage>>;
    /**
     * Terminate the current MCP session.
     *
     * Sends a DELETE request with the `Mcp-Session-Id` header. If the server
     * returns 405 (session termination not supported), the error is silently
     * ignored. After termination, the stored session ID is cleared.
     *
     * @throws {AuthRequiredError} If the server returns 401.
     */
    terminateSession(): Promise<void>;
    /**
     * Update the Authorization header value at runtime.
     *
     * Called by the auth layer after obtaining or refreshing tokens.
     *
     * @param header - The new Authorization header value (e.g., "Bearer <token>").
     */
    setAuthorizationHeader(header: string): void;
    /**
     * Return the current MCP session ID, or null if no session is active.
     *
     * @returns The session ID string, or null.
     */
    getSessionId(): string | null;
    /**
     * Return the last SSE event ID received, for stream resumability.
     *
     * @returns The last event ID string, or null if none has been received.
     */
    getLastEventId(): string | null;
    /**
     * Generate the next auto-incrementing request ID.
     *
     * @returns A unique numeric request ID.
     */
    private nextId;
    /**
     * Build the standard request headers for POST requests.
     *
     * Includes Content-Type, Accept, and optionally Mcp-Session-Id and
     * Authorization headers.
     *
     * @returns A headers record suitable for use with fetch().
     */
    private buildHeaders;
    /**
     * Capture the `Mcp-Session-Id` header from a fetch response, if present.
     *
     * @param response - The fetch Response object.
     */
    private captureSessionId;
    /**
     * Check the HTTP status code and throw the appropriate typed error.
     *
     * Handles 401 (AuthRequired), 403 (InsufficientScope), and 404
     * (SessionExpired). All other non-2xx status codes throw a generic MCPError.
     *
     * @param response - The fetch Response object to check.
     * @throws {SessionExpiredError} On 404.
     * @throws {AuthRequiredError} On 401.
     * @throws {InsufficientScopeError} On 403.
     * @throws {MCPError} On other non-2xx status codes.
     */
    private handleErrorStatus;
    /**
     * Parse a fetch response as either a JSON-RPC response or an SSE stream.
     *
     * For `application/json` responses, parses the body as a single JSON-RPC
     * response. For `text/event-stream` responses, consumes the SSE stream
     * and returns the response matching the given request ID.
     *
     * @param response - The fetch Response object.
     * @param requestId - The request ID to match in the response.
     * @returns The JSON-RPC response corresponding to the request ID.
     * @throws {MCPError} If the response format is unexpected or no matching response is found.
     */
    private parseResponse;
    /**
     * Parse the response body as a single JSON-RPC response.
     *
     * @param response - The fetch Response with an application/json body.
     * @returns The parsed JSON-RPC response.
     * @throws {MCPError} If the body is not a valid JSON-RPC response.
     */
    private parseJsonResponse;
    /**
     * Consume an SSE stream from a response and return the JSON-RPC response
     * matching the given request ID.
     *
     * Also tracks `lastEventId` for resumability.
     *
     * @param response - The fetch Response with a text/event-stream body.
     * @param requestId - The request ID to match.
     * @returns The matching JSON-RPC response.
     * @throws {MCPError} If the stream ends without a matching response.
     */
    private parseSSEResponse;
    /**
     * Parse a batch response from either a JSON body or an SSE stream.
     *
     * For `application/json` responses, the body is expected to be a JSON array
     * of response objects. For `text/event-stream` responses, each SSE event
     * may contain one or more response objects from the batch.
     *
     * @param response - The fetch Response object.
     * @param requestIds - The IDs of the requests in the batch.
     * @returns A Map from response id to JsonRpcResponse.
     * @throws {MCPError} If the response format is unexpected.
     */
    private parseBatchResponses;
    /**
     * Parse the response body as a JSON-RPC batch response array.
     *
     * @param response - The fetch Response with an application/json body.
     * @returns A Map from response id to JsonRpcResponse.
     * @throws {MCPError} If the body is not a valid batch response array.
     */
    private parseBatchJsonResponse;
    /**
     * Consume an SSE stream and collect all JSON-RPC responses for a batch,
     * indexed by id.
     *
     * Each SSE event with type "message" may contain one or more JSON-RPC
     * responses from the batch. Responses are collected into a Map keyed by id.
     *
     * @param response - The fetch Response with a text/event-stream body.
     * @param _requestIds - The IDs of the requests in the batch (used for documentation; matching is by id).
     * @returns A Map from response id to JsonRpcResponse.
     * @throws {MCPError} If the SSE response has no body.
     */
    private parseBatchSSEResponse;
    /**
     * Consume an SSE stream body and yield JSON-RPC messages as an async generator.
     *
     * Used by {@link openServerStream} for server-initiated event streams.
     *
     * @param body - The readable byte stream from the fetch response body.
     * @yields Parsed JSON-RPC messages from the SSE stream.
     */
    private consumeSSEAsMessages;
    /**
     * Parse the `data` field of an SSE event as one or more JSON-RPC messages.
     *
     * The data field may contain a single JSON-RPC message or a batch (array).
     * Malformed messages are silently skipped to maintain stream processing
     * resilience.
     *
     * @param data - The raw string data from an SSE event.
     * @returns An array of parsed JSON-RPC messages (may be empty on parse failure).
     */
    private parseSSEData;
}
//# sourceMappingURL=streamable-http.d.ts.map
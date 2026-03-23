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
import { MCPError } from "../types.js";
import { createRequest, createNotification, isResponse, parseMessage, parseBatchResponse, INTERNAL_ERROR, } from "../jsonrpc.js";
import { SSEParser } from "./sse-parser.js";
// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
/** The MCP protocol version this client supports. */
const MCP_PROTOCOL_VERSION = "2025-03-26";
/** Default timeout for individual requests in milliseconds. */
const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;
/** Default timeout for the initial connection/handshake in milliseconds. */
const DEFAULT_CONNECT_TIMEOUT_MS = 10_000;
/** Application-specific error code for session expired (HTTP 404). */
const SESSION_EXPIRED_CODE = -32000;
/** Application-specific error code for auth required (HTTP 401). */
const AUTH_REQUIRED_CODE = -32001;
/** Application-specific error code for insufficient scope (HTTP 403). */
const INSUFFICIENT_SCOPE_CODE = -32002;
/** Application-specific error code for request timeout. */
const REQUEST_TIMEOUT_CODE = -32003;
// ---------------------------------------------------------------------------
// Error Classes
// ---------------------------------------------------------------------------
/**
 * Error thrown when the MCP session has expired (server returned HTTP 404).
 *
 * The caller should discard the session and re-initialize.
 */
export class SessionExpiredError extends MCPError {
    /**
     * Create a new SessionExpiredError.
     *
     * @param message - Human-readable description.
     */
    constructor(message) {
        super(message, SESSION_EXPIRED_CODE);
        this.name = "SessionExpiredError";
    }
}
/**
 * Error thrown when the server requires authentication (HTTP 401).
 *
 * Contains the `WWW-Authenticate` header value for the auth layer to
 * parse and initiate the appropriate authentication flow.
 */
export class AuthRequiredError extends MCPError {
    /** The value of the WWW-Authenticate response header. */
    wwwAuthenticate;
    /**
     * Create a new AuthRequiredError.
     *
     * @param message - Human-readable description.
     * @param wwwAuthenticate - The WWW-Authenticate header value from the 401 response.
     */
    constructor(message, wwwAuthenticate) {
        super(message, AUTH_REQUIRED_CODE);
        this.name = "AuthRequiredError";
        this.wwwAuthenticate = wwwAuthenticate;
    }
}
/**
 * Error thrown when the server returns HTTP 403 indicating the current
 * token lacks the required scopes.
 *
 * Contains the scope value extracted from the `WWW-Authenticate` header.
 */
export class InsufficientScopeError extends MCPError {
    /** The required scope(s) from the WWW-Authenticate header. */
    scope;
    /**
     * Create a new InsufficientScopeError.
     *
     * @param message - Human-readable description.
     * @param scope - The required scope(s) from the WWW-Authenticate header.
     */
    constructor(message, scope) {
        super(message, INSUFFICIENT_SCOPE_CODE);
        this.name = "InsufficientScopeError";
        this.scope = scope;
    }
}
/**
 * Error thrown when a request exceeds the configured timeout.
 */
export class RequestTimeoutError extends MCPError {
    /**
     * Create a new RequestTimeoutError.
     *
     * @param message - Human-readable description.
     */
    constructor(message) {
        super(message, REQUEST_TIMEOUT_CODE);
        this.name = "RequestTimeoutError";
    }
}
// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
/**
 * Extract the `scope` parameter value from a WWW-Authenticate header.
 *
 * Searches for a `scope="..."` or `scope=token` pattern within the header.
 *
 * @param wwwAuthenticate - The raw WWW-Authenticate header value.
 * @returns The extracted scope string, or an empty string if not found.
 */
function extractScopeFromWWWAuthenticate(wwwAuthenticate) {
    // Match scope="quoted value" or scope=unquoted_token
    const match = /scope="([^"]*)"/.exec(wwwAuthenticate)
        ?? /scope=(\S+)/.exec(wwwAuthenticate);
    return match !== null ? match[1] : "";
}
/**
 * Determine the content type family from a Content-Type header value.
 *
 * @param contentType - The raw Content-Type header value (may include charset, etc.).
 * @returns "json" for application/json, "sse" for text/event-stream, or "unknown".
 */
function classifyContentType(contentType) {
    if (contentType === null) {
        return "unknown";
    }
    const lower = contentType.toLowerCase();
    if (lower.includes("application/json")) {
        return "json";
    }
    if (lower.includes("text/event-stream")) {
        return "sse";
    }
    return "unknown";
}
// ---------------------------------------------------------------------------
// StreamableHTTPTransport
// ---------------------------------------------------------------------------
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
export class StreamableHTTPTransport {
    url;
    requestTimeoutMs;
    connectTimeoutMs;
    authorizationHeader;
    /** The MCP session ID assigned by the server. */
    sessionId = null;
    /** The last SSE event ID received, for resumability. */
    lastEventId = null;
    /** Auto-incrementing request ID counter. */
    nextRequestId = 1;
    /**
     * Create a new StreamableHTTPTransport.
     *
     * @param config - Transport configuration including the server URL and optional timeouts.
     */
    constructor(config) {
        this.url = config.url;
        this.requestTimeoutMs = config.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
        this.connectTimeoutMs = config.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS;
        this.authorizationHeader = config.authorizationHeader ?? null;
    }
    // -------------------------------------------------------------------------
    // Public Methods
    // -------------------------------------------------------------------------
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
    async initialize(clientInfo, capabilities) {
        const params = {
            protocolVersion: MCP_PROTOCOL_VERSION,
            capabilities,
            clientInfo,
        };
        const requestId = this.nextId();
        const request = createRequest("initialize", params, requestId);
        const controller = new AbortController();
        const timer = setTimeout(() => { controller.abort(); }, this.connectTimeoutMs);
        try {
            const response = await fetch(this.url, {
                method: "POST",
                headers: this.buildHeaders(),
                body: JSON.stringify(request),
                signal: controller.signal,
            });
            // Store session ID if the server provides one
            this.captureSessionId(response);
            this.handleErrorStatus(response);
            const rpcResponse = await this.parseResponse(response, requestId);
            if ("error" in rpcResponse) {
                throw new MCPError(`Initialize failed: ${rpcResponse.error.message}`, rpcResponse.error.code);
            }
            const result = rpcResponse.result;
            // Send the initialized notification (fire-and-forget, expect 202)
            await this.sendNotification("notifications/initialized");
            return result;
        }
        catch (error) {
            if (error instanceof DOMException && error.name === "AbortError") {
                throw new RequestTimeoutError(`Initialize request timed out after ${String(this.connectTimeoutMs)}ms`);
            }
            throw error;
        }
        finally {
            clearTimeout(timer);
        }
    }
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
    async sendRequest(method, params) {
        const requestId = this.nextId();
        const request = createRequest(method, params, requestId);
        const controller = new AbortController();
        const timer = setTimeout(() => { controller.abort(); }, this.requestTimeoutMs);
        try {
            const response = await fetch(this.url, {
                method: "POST",
                headers: this.buildHeaders(),
                body: JSON.stringify(request),
                signal: controller.signal,
            });
            // Store/update session ID
            this.captureSessionId(response);
            this.handleErrorStatus(response);
            return await this.parseResponse(response, requestId);
        }
        catch (error) {
            if (error instanceof DOMException && error.name === "AbortError") {
                throw new RequestTimeoutError(`Request "${method}" timed out after ${String(this.requestTimeoutMs)}ms`);
            }
            throw error;
        }
        finally {
            clearTimeout(timer);
        }
    }
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
    async sendNotification(method, params) {
        const notification = createNotification(method, params);
        const controller = new AbortController();
        const timer = setTimeout(() => { controller.abort(); }, this.requestTimeoutMs);
        try {
            const response = await fetch(this.url, {
                method: "POST",
                headers: this.buildHeaders(),
                body: JSON.stringify(notification),
                signal: controller.signal,
            });
            // Store/update session ID
            this.captureSessionId(response);
            this.handleErrorStatus(response);
            // Expect 202 Accepted for notifications, but accept 200 as well
        }
        catch (error) {
            if (error instanceof DOMException && error.name === "AbortError") {
                throw new RequestTimeoutError(`Notification "${method}" timed out after ${String(this.requestTimeoutMs)}ms`);
            }
            throw error;
        }
        finally {
            clearTimeout(timer);
        }
    }
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
    async sendBatch(requests) {
        if (requests.length === 0) {
            return [];
        }
        // Assign sequential IDs and build the JSON-RPC request objects
        const idMap = [];
        const batch = requests.map((req) => {
            const id = this.nextId();
            idMap.push(id);
            return createRequest(req.method, req.params, id);
        });
        const controller = new AbortController();
        const timer = setTimeout(() => { controller.abort(); }, this.requestTimeoutMs);
        try {
            const response = await fetch(this.url, {
                method: "POST",
                headers: this.buildHeaders(),
                body: JSON.stringify(batch),
                signal: controller.signal,
            });
            // Store/update session ID
            this.captureSessionId(response);
            this.handleErrorStatus(response);
            const responseMap = await this.parseBatchResponses(response, idMap);
            // Build the result array in the same order as the input requests
            const results = [];
            for (const id of idMap) {
                const rpcResponse = responseMap.get(id);
                if (rpcResponse === undefined) {
                    throw new MCPError(`No response received for batch request id=${String(id)}`, INTERNAL_ERROR);
                }
                results.push(rpcResponse);
            }
            return results;
        }
        catch (error) {
            if (error instanceof DOMException && error.name === "AbortError") {
                throw new RequestTimeoutError(`Batch request timed out after ${String(this.requestTimeoutMs)}ms`);
            }
            throw error;
        }
        finally {
            clearTimeout(timer);
        }
    }
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
    async openServerStream() {
        const headers = {
            "Accept": "text/event-stream",
        };
        if (this.sessionId !== null) {
            headers["Mcp-Session-Id"] = this.sessionId;
        }
        if (this.authorizationHeader !== null) {
            headers["Authorization"] = this.authorizationHeader;
        }
        if (this.lastEventId !== null) {
            headers["Last-Event-ID"] = this.lastEventId;
        }
        const response = await fetch(this.url, {
            method: "GET",
            headers,
        });
        // 405: server does not support GET-based streams
        if (response.status === 405) {
            return emptyGenerator();
        }
        this.handleErrorStatus(response);
        if (response.body === null) {
            return emptyGenerator();
        }
        return this.consumeSSEAsMessages(response.body);
    }
    /**
     * Terminate the current MCP session.
     *
     * Sends a DELETE request with the `Mcp-Session-Id` header. If the server
     * returns 405 (session termination not supported), the error is silently
     * ignored. After termination, the stored session ID is cleared.
     *
     * @throws {AuthRequiredError} If the server returns 401.
     */
    async terminateSession() {
        if (this.sessionId === null) {
            return;
        }
        const headers = {
            "Mcp-Session-Id": this.sessionId,
        };
        if (this.authorizationHeader !== null) {
            headers["Authorization"] = this.authorizationHeader;
        }
        try {
            const response = await fetch(this.url, {
                method: "DELETE",
                headers,
            });
            // 405: server does not support session termination -- ignore
            if (response.status === 405) {
                this.sessionId = null;
                return;
            }
            if (response.status === 401) {
                const wwwAuth = response.headers.get("WWW-Authenticate") ?? "";
                this.sessionId = null;
                throw new AuthRequiredError("Authentication required for session termination", wwwAuth);
            }
        }
        finally {
            this.sessionId = null;
        }
    }
    /**
     * Update the Authorization header value at runtime.
     *
     * Called by the auth layer after obtaining or refreshing tokens.
     *
     * @param header - The new Authorization header value (e.g., "Bearer <token>").
     */
    setAuthorizationHeader(header) {
        this.authorizationHeader = header;
    }
    /**
     * Return the current MCP session ID, or null if no session is active.
     *
     * @returns The session ID string, or null.
     */
    getSessionId() {
        return this.sessionId;
    }
    /**
     * Return the last SSE event ID received, for stream resumability.
     *
     * @returns The last event ID string, or null if none has been received.
     */
    getLastEventId() {
        return this.lastEventId;
    }
    // -------------------------------------------------------------------------
    // Private Methods
    // -------------------------------------------------------------------------
    /**
     * Generate the next auto-incrementing request ID.
     *
     * @returns A unique numeric request ID.
     */
    nextId() {
        const id = this.nextRequestId;
        this.nextRequestId += 1;
        return id;
    }
    /**
     * Build the standard request headers for POST requests.
     *
     * Includes Content-Type, Accept, and optionally Mcp-Session-Id and
     * Authorization headers.
     *
     * @returns A headers record suitable for use with fetch().
     */
    buildHeaders() {
        const headers = {
            "Content-Type": "application/json",
            "Accept": "application/json, text/event-stream",
        };
        if (this.sessionId !== null) {
            headers["Mcp-Session-Id"] = this.sessionId;
        }
        if (this.authorizationHeader !== null) {
            headers["Authorization"] = this.authorizationHeader;
        }
        return headers;
    }
    /**
     * Capture the `Mcp-Session-Id` header from a fetch response, if present.
     *
     * @param response - The fetch Response object.
     */
    captureSessionId(response) {
        const sessionId = response.headers.get("Mcp-Session-Id");
        if (sessionId !== null) {
            this.sessionId = sessionId;
        }
    }
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
    handleErrorStatus(response) {
        if (response.ok) {
            return;
        }
        const status = response.status;
        if (status === 404) {
            this.sessionId = null;
            throw new SessionExpiredError("Session expired: server returned 404");
        }
        if (status === 401) {
            const wwwAuth = response.headers.get("WWW-Authenticate") ?? "";
            throw new AuthRequiredError("Authentication required: server returned 401", wwwAuth);
        }
        if (status === 403) {
            const wwwAuth = response.headers.get("WWW-Authenticate") ?? "";
            const scope = extractScopeFromWWWAuthenticate(wwwAuth);
            throw new InsufficientScopeError("Insufficient scope: server returned 403", scope);
        }
        throw new MCPError(`HTTP error: ${String(status)} ${response.statusText}`, INTERNAL_ERROR);
    }
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
    async parseResponse(response, requestId) {
        const contentType = response.headers.get("Content-Type");
        const kind = classifyContentType(contentType);
        if (kind === "json") {
            return this.parseJsonResponse(response);
        }
        if (kind === "sse") {
            return this.parseSSEResponse(response, requestId);
        }
        // Fallback: attempt JSON parse for unknown content types
        return this.parseJsonResponse(response);
    }
    /**
     * Parse the response body as a single JSON-RPC response.
     *
     * @param response - The fetch Response with an application/json body.
     * @returns The parsed JSON-RPC response.
     * @throws {MCPError} If the body is not a valid JSON-RPC response.
     */
    async parseJsonResponse(response) {
        const text = await response.text();
        const parsed = parseMessage(text);
        if (parsed.type === "response") {
            return parsed.message;
        }
        throw new MCPError("Expected a JSON-RPC response but received a different message type", INTERNAL_ERROR);
    }
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
    async parseSSEResponse(response, requestId) {
        if (response.body === null) {
            throw new MCPError("SSE response has no body", INTERNAL_ERROR);
        }
        const parser = new SSEParser();
        let matchedResponse = null;
        for await (const sseEvent of parser.parse(response.body)) {
            // Track the last event ID for resumability
            if (sseEvent.id !== undefined) {
                this.lastEventId = sseEvent.id;
            }
            // Per the MCP spec, SSE events with type "message" contain JSON-RPC messages
            if (sseEvent.event !== "message") {
                continue;
            }
            const jsonRpcMessages = this.parseSSEData(sseEvent.data);
            for (const msg of jsonRpcMessages) {
                if (isResponse(msg)) {
                    // Check if this response matches our request ID
                    if (msg.id === requestId) {
                        matchedResponse = msg;
                    }
                }
            }
        }
        // Update lastEventId from the parser's sticky state
        if (parser.lastEventId !== "") {
            this.lastEventId = parser.lastEventId;
        }
        if (matchedResponse === null) {
            throw new MCPError(`No response with id=${String(requestId)} found in SSE stream`, INTERNAL_ERROR);
        }
        return matchedResponse;
    }
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
    async parseBatchResponses(response, requestIds) {
        const contentType = response.headers.get("Content-Type");
        const kind = classifyContentType(contentType);
        if (kind === "json") {
            return this.parseBatchJsonResponse(response);
        }
        if (kind === "sse") {
            return this.parseBatchSSEResponse(response, requestIds);
        }
        // Fallback: attempt JSON parse for unknown content types
        return this.parseBatchJsonResponse(response);
    }
    /**
     * Parse the response body as a JSON-RPC batch response array.
     *
     * @param response - The fetch Response with an application/json body.
     * @returns A Map from response id to JsonRpcResponse.
     * @throws {MCPError} If the body is not a valid batch response array.
     */
    async parseBatchJsonResponse(response) {
        const text = await response.text();
        let parsed;
        try {
            parsed = JSON.parse(text);
        }
        catch {
            throw new MCPError("Parse error: invalid JSON in batch response", INTERNAL_ERROR);
        }
        return parseBatchResponse(parsed);
    }
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
    async parseBatchSSEResponse(response, _requestIds) {
        if (response.body === null) {
            throw new MCPError("SSE response has no body", INTERNAL_ERROR);
        }
        const parser = new SSEParser();
        const responseMap = new Map();
        for await (const sseEvent of parser.parse(response.body)) {
            // Track the last event ID for resumability
            if (sseEvent.id !== undefined) {
                this.lastEventId = sseEvent.id;
            }
            // Per the MCP spec, SSE events with type "message" contain JSON-RPC messages
            if (sseEvent.event !== "message") {
                continue;
            }
            const jsonRpcMessages = this.parseSSEData(sseEvent.data);
            for (const msg of jsonRpcMessages) {
                if (isResponse(msg) && msg.id !== null) {
                    responseMap.set(msg.id, msg);
                }
            }
        }
        // Update lastEventId from the parser's sticky state
        if (parser.lastEventId !== "") {
            this.lastEventId = parser.lastEventId;
        }
        return responseMap;
    }
    /**
     * Consume an SSE stream body and yield JSON-RPC messages as an async generator.
     *
     * Used by {@link openServerStream} for server-initiated event streams.
     *
     * @param body - The readable byte stream from the fetch response body.
     * @yields Parsed JSON-RPC messages from the SSE stream.
     */
    async *consumeSSEAsMessages(body) {
        const parser = new SSEParser();
        for await (const sseEvent of parser.parse(body)) {
            // Track the last event ID for resumability
            if (sseEvent.id !== undefined) {
                this.lastEventId = sseEvent.id;
            }
            if (sseEvent.event !== "message") {
                continue;
            }
            const messages = this.parseSSEData(sseEvent.data);
            for (const msg of messages) {
                yield msg;
            }
        }
        // Update lastEventId from the parser's sticky state
        if (parser.lastEventId !== "") {
            this.lastEventId = parser.lastEventId;
        }
    }
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
    parseSSEData(data) {
        try {
            const parsed = parseMessage(data);
            if (parsed.type === "batch") {
                return [...parsed.messages];
            }
            return [parsed.message];
        }
        catch {
            // Malformed JSON-RPC in an SSE event is skipped per error handling spec
            return [];
        }
    }
}
// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------
/**
 * Create an empty async generator that yields no values.
 *
 * Used when the server does not support a particular operation (e.g., GET
 * streams returning 405).
 *
 * @returns An async generator that completes immediately.
 */
async function* emptyGenerator() {
    // Intentionally empty: yields nothing
}
//# sourceMappingURL=streamable-http.js.map
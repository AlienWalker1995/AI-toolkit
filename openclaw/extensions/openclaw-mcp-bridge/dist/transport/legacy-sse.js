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
import { MCPError } from "../types.js";
import { createRequest, createNotification, parseMessage, INTERNAL_ERROR, } from "../jsonrpc.js";
import { SSEParser } from "./sse-parser.js";
// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
/** Default timeout for individual requests in milliseconds. */
const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;
/** Default timeout for the initial SSE connection in milliseconds. */
const DEFAULT_CONNECT_TIMEOUT_MS = 10_000;
/** Application-specific error code for connection failures. */
const CONNECTION_ERROR_CODE = -32000;
/** Application-specific error code for request timeout. */
const REQUEST_TIMEOUT_CODE = -32003;
// ---------------------------------------------------------------------------
// Error Classes
// ---------------------------------------------------------------------------
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
// LegacySSETransport
// ---------------------------------------------------------------------------
/**
 * MCP Legacy SSE transport.
 *
 * Implements the MCP 2024-11-05 HTTP+SSE transport protocol, where a
 * persistent SSE connection is opened via GET, and JSON-RPC messages are
 * sent via POST to an endpoint URL provided by the server through the
 * SSE stream.
 */
export class LegacySSETransport {
    url;
    apiKey;
    requestTimeoutMs;
    connectTimeoutMs;
    /** The endpoint URL received from the server's `endpoint` SSE event. */
    endpointUrl = null;
    /** AbortController for the persistent SSE connection. */
    sseAbortController = null;
    /** Whether the SSE connection is currently active. */
    _isConnected = false;
    /** Auto-incrementing request ID counter. */
    nextRequestId = 1;
    /** Background SSE stream processing promise (for cleanup). */
    sseStreamPromise = null;
    /**
     * Callback invoked when a server-initiated notification arrives
     * via the SSE stream. Set by the caller if needed.
     */
    onNotification = null;
    /**
     * Create a new LegacySSETransport.
     *
     * @param config - Transport configuration including the server URL and optional settings.
     */
    constructor(config) {
        this.url = config.url;
        this.apiKey = config.apiKey ?? null;
        this.requestTimeoutMs = config.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
        this.connectTimeoutMs = config.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS;
    }
    // -------------------------------------------------------------------------
    // Public Methods
    // -------------------------------------------------------------------------
    /**
     * Whether the transport is connected (SSE stream is active and endpoint
     * URL has been received).
     */
    get isConnected() {
        return this._isConnected;
    }
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
    async initialize(params) {
        // Open the SSE connection and wait for the endpoint URL
        await this.openSSEConnection();
        // Now perform the MCP initialize handshake
        const response = await this.sendRequest("initialize", params);
        if ("error" in response) {
            throw new MCPError(`Initialize failed: ${response.error.message}`, response.error.code);
        }
        const result = response.result;
        // Send the initialized notification (fire-and-forget)
        await this.sendNotification("notifications/initialized");
        return result;
    }
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
    async sendRequest(method, params) {
        if (this.endpointUrl === null) {
            throw new MCPError("Cannot send request: transport is not connected (no endpoint URL)", CONNECTION_ERROR_CODE);
        }
        const requestId = this.nextId();
        const request = createRequest(method, params, requestId);
        const controller = new AbortController();
        const timer = setTimeout(() => { controller.abort(); }, this.requestTimeoutMs);
        try {
            const response = await fetch(this.endpointUrl, {
                method: "POST",
                headers: this.buildPostHeaders(),
                body: JSON.stringify(request),
                signal: controller.signal,
            });
            if (!response.ok) {
                throw new MCPError(`HTTP error: ${String(response.status)} ${response.statusText}`, INTERNAL_ERROR);
            }
            const text = await response.text();
            const parsed = parseMessage(text);
            if (parsed.type === "response") {
                return parsed.message;
            }
            throw new MCPError("Expected a JSON-RPC response but received a different message type", INTERNAL_ERROR);
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
     * Send a JSON-RPC notification (no response expected) via POST to the
     * endpoint URL.
     *
     * @param method - The notification method name.
     * @param params - Optional notification parameters.
     * @throws {MCPError} If the transport is not connected or the request fails.
     * @throws {RequestTimeoutError} If the request exceeds requestTimeoutMs.
     */
    async sendNotification(method, params) {
        if (this.endpointUrl === null) {
            throw new MCPError("Cannot send notification: transport is not connected (no endpoint URL)", CONNECTION_ERROR_CODE);
        }
        const notification = createNotification(method, params);
        const controller = new AbortController();
        const timer = setTimeout(() => { controller.abort(); }, this.requestTimeoutMs);
        try {
            const response = await fetch(this.endpointUrl, {
                method: "POST",
                headers: this.buildPostHeaders(),
                body: JSON.stringify(notification),
                signal: controller.signal,
            });
            if (!response.ok) {
                throw new MCPError(`HTTP error: ${String(response.status)} ${response.statusText}`, INTERNAL_ERROR);
            }
            // Notifications do not return a meaningful body; we just check HTTP status.
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
     * Close the SSE connection and clean up resources.
     *
     * Aborts the persistent GET request that maintains the SSE stream.
     * After calling close, the transport is no longer connected and
     * must be re-initialized before sending further requests.
     */
    async close() {
        this._isConnected = false;
        this.endpointUrl = null;
        if (this.sseAbortController !== null) {
            this.sseAbortController.abort();
            this.sseAbortController = null;
        }
        // Wait for the background SSE processing to complete (it should resolve
        // quickly once the abort signal fires).
        if (this.sseStreamPromise !== null) {
            try {
                await this.sseStreamPromise;
            }
            catch {
                // Ignore errors from the aborted stream.
            }
            this.sseStreamPromise = null;
        }
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
     * Build the standard headers for POST requests to the endpoint URL.
     *
     * Includes Content-Type, Accept, and optionally Authorization.
     *
     * @returns A headers record suitable for use with fetch().
     */
    buildPostHeaders() {
        const headers = {
            "Content-Type": "application/json",
            "Accept": "application/json",
        };
        if (this.apiKey !== null) {
            headers["Authorization"] = `Bearer ${this.apiKey}`;
        }
        return headers;
    }
    /**
     * Build the headers for the initial SSE GET request.
     *
     * Includes Accept for SSE and optionally Authorization.
     *
     * @returns A headers record suitable for use with fetch().
     */
    buildSSEHeaders() {
        const headers = {
            "Accept": "text/event-stream",
        };
        if (this.apiKey !== null) {
            headers["Authorization"] = `Bearer ${this.apiKey}`;
        }
        return headers;
    }
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
    resolveEndpointUrl(endpoint) {
        try {
            return new URL(endpoint, this.url).href;
        }
        catch {
            // If URL construction fails, return the endpoint as-is (it may
            // already be a full URL).
            return endpoint;
        }
    }
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
    async openSSEConnection() {
        const controller = new AbortController();
        this.sseAbortController = controller;
        const connectTimer = setTimeout(() => {
            controller.abort();
        }, this.connectTimeoutMs);
        let response;
        try {
            response = await fetch(this.url, {
                method: "GET",
                headers: this.buildSSEHeaders(),
                signal: controller.signal,
            });
        }
        catch (error) {
            clearTimeout(connectTimer);
            this.sseAbortController = null;
            if (error instanceof DOMException && error.name === "AbortError") {
                throw new RequestTimeoutError(`SSE connection timed out after ${String(this.connectTimeoutMs)}ms`);
            }
            throw new MCPError(`Failed to open SSE connection: ${error instanceof Error ? error.message : String(error)}`, CONNECTION_ERROR_CODE);
        }
        if (!response.ok) {
            clearTimeout(connectTimer);
            this.sseAbortController = null;
            throw new MCPError(`SSE connection failed: HTTP ${String(response.status)} ${response.statusText}`, CONNECTION_ERROR_CODE);
        }
        if (response.body === null) {
            clearTimeout(connectTimer);
            this.sseAbortController = null;
            throw new MCPError("SSE connection failed: response has no body", CONNECTION_ERROR_CODE);
        }
        // Parse the SSE stream and wait for the `endpoint` event.
        const parser = new SSEParser();
        const sseIterator = parser.parse(response.body);
        // Wait for the endpoint event within the connect timeout.
        try {
            const endpointUrl = await this.waitForEndpointEvent(sseIterator);
            this.endpointUrl = this.resolveEndpointUrl(endpointUrl);
            this._isConnected = true;
        }
        catch (error) {
            this.sseAbortController?.abort();
            this.sseAbortController = null;
            if (error instanceof DOMException && error.name === "AbortError") {
                throw new RequestTimeoutError(`Waiting for endpoint event timed out after ${String(this.connectTimeoutMs)}ms`);
            }
            throw error;
        }
        finally {
            clearTimeout(connectTimer);
        }
        // Continue processing the SSE stream in the background for
        // server-initiated notifications.
        this.sseStreamPromise = this.processBackgroundSSEStream(sseIterator);
    }
    /**
     * Consume SSE events from the iterator until an `endpoint` event is found.
     *
     * @param iterator - The async generator of SSE events.
     * @returns The endpoint URL string from the `endpoint` event's data field.
     * @throws {MCPError} If the stream ends without an endpoint event.
     */
    async waitForEndpointEvent(iterator) {
        for (;;) {
            const { done, value } = await iterator.next();
            if (done) {
                throw new MCPError("SSE stream ended before receiving an endpoint event", CONNECTION_ERROR_CODE);
            }
            if (value.event === "endpoint") {
                const endpointUrl = value.data.trim();
                if (endpointUrl === "") {
                    throw new MCPError("Received empty endpoint URL from server", CONNECTION_ERROR_CODE);
                }
                return endpointUrl;
            }
            // Ignore other events while waiting for the endpoint.
        }
    }
    /**
     * Process the remaining SSE stream events in the background.
     *
     * After the `endpoint` event has been received, the SSE stream remains
     * open for server-initiated notifications. This method consumes those
     * events and dispatches them via the {@link onNotification} callback.
     *
     * @param iterator - The async generator of SSE events (already past the endpoint event).
     */
    async processBackgroundSSEStream(iterator) {
        try {
            for (;;) {
                const { done, value } = await iterator.next();
                if (done) {
                    break;
                }
                // Process "message" events as JSON-RPC messages
                if (value.event === "message") {
                    this.handleSSEMessage(value.data);
                }
            }
        }
        catch {
            // The stream was likely aborted during close() -- this is expected.
        }
        finally {
            // If the stream ends unexpectedly (server closed), mark as disconnected.
            if (this._isConnected) {
                this._isConnected = false;
            }
        }
    }
    /**
     * Parse a JSON-RPC message from an SSE event's data and dispatch it.
     *
     * Malformed messages are silently ignored to maintain stream resilience.
     *
     * @param data - The raw string data from an SSE `message` event.
     */
    handleSSEMessage(data) {
        if (this.onNotification === null) {
            return;
        }
        try {
            const parsed = parseMessage(data);
            if (parsed.type === "batch") {
                for (const msg of parsed.messages) {
                    this.onNotification(msg);
                }
            }
            else {
                this.onNotification(parsed.message);
            }
        }
        catch {
            // Malformed JSON-RPC in an SSE event is silently skipped.
        }
    }
}
//# sourceMappingURL=legacy-sse.js.map
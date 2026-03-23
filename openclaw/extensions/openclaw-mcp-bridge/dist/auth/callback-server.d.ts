/**
 * Temporary local HTTP server for handling OAuth 2.1 authorization code redirects.
 *
 * Binds to `127.0.0.1` on a random available port and waits for the
 * authorization server to redirect the user's browser to
 * `http://127.0.0.1:<port>/callback?code=...&state=...`.
 *
 * The server handles exactly one callback request, validates the `state`
 * parameter for CSRF protection, and then auto-closes.
 *
 * @see https://modelcontextprotocol.io/specification/draft/basic/authorization
 */
/** The result extracted from a successful OAuth callback. */
export interface CallbackResult {
    /** The authorization code from the `code` query parameter. */
    readonly code: string;
    /** The state parameter echoed back by the authorization server. */
    readonly state: string;
}
/** Configuration for the callback server. */
export interface CallbackServerConfig {
    /** Expected state parameter for CSRF validation. */
    readonly expectedState: string;
    /** Timeout in ms to wait for the callback (default: 120000 = 2 min). */
    readonly timeoutMs?: number;
}
/**
 * A temporary local HTTP server that handles OAuth 2.1 authorization code redirects.
 *
 * Usage:
 * ```ts
 * const server = new CallbackServer({ expectedState: "random-state-value" });
 * const { port, redirectUri } = await server.start();
 * // ... open browser to authorization URL with redirect_uri = redirectUri ...
 * const { code, state } = await server.waitForCallback();
 * // server auto-closes after receiving the callback
 * ```
 */
export declare class CallbackServer {
    /** The expected state parameter for CSRF validation. */
    private readonly expectedState;
    /** Timeout in ms to wait for the callback. */
    private readonly timeoutMs;
    /** The underlying Node.js HTTP server, or `null` if not started. */
    private server;
    /** The port the server is listening on, or `null` if not started. */
    private port;
    /** Whether the server has been started. */
    private started;
    /** Whether the server has been stopped. */
    private stopped;
    /**
     * Create a new CallbackServer.
     *
     * @param config - Configuration including the expected state and optional timeout.
     */
    constructor(config: CallbackServerConfig);
    /**
     * Start the HTTP server on `127.0.0.1` with a random available port.
     *
     * @returns The port number and the full redirect URI.
     * @throws MCPError if the server is already started.
     */
    start(): Promise<{
        port: number;
        redirectUri: string;
    }>;
    /**
     * Wait for the OAuth redirect to hit the `/callback` endpoint.
     *
     * Extracts the `code` and `state` query parameters, validates the state
     * against the expected value, and responds to the browser with an HTML page.
     * The server auto-stops after receiving the callback or on timeout.
     *
     * @returns The authorization code and state from the callback.
     * @throws MCPError on state mismatch, OAuth error, or timeout.
     */
    waitForCallback(): Promise<CallbackResult>;
    /**
     * Shut down the HTTP server gracefully.
     *
     * Safe to call multiple times; subsequent calls are no-ops.
     *
     * @returns A promise that resolves when the server has fully closed.
     */
    stop(): Promise<void>;
    /**
     * Return the redirect URI for this callback server.
     *
     * Only valid after {@link start} has been called.
     *
     * @returns The full redirect URI (e.g., `http://127.0.0.1:12345/callback`).
     * @throws MCPError if the server has not been started.
     */
    getRedirectUri(): string;
}
//# sourceMappingURL=callback-server.d.ts.map
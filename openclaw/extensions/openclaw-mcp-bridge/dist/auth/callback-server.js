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
import { createServer } from "node:http";
import { MCPError } from "../types.js";
// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
/** Default timeout in milliseconds (2 minutes). */
const DEFAULT_TIMEOUT_MS = 120_000;
/** The callback path that the redirect URI points to. */
const CALLBACK_PATH = "/callback";
/** HTML response served to the browser on successful authentication. */
const SUCCESS_HTML = `<html><body><h1>Authentication Successful</h1>
<p>You can close this window and return to OpenClaw.</p>
<script>window.close()</script></body></html>`;
// ---------------------------------------------------------------------------
// CallbackServer
// ---------------------------------------------------------------------------
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
export class CallbackServer {
    /** The expected state parameter for CSRF validation. */
    expectedState;
    /** Timeout in ms to wait for the callback. */
    timeoutMs;
    /** The underlying Node.js HTTP server, or `null` if not started. */
    server = null;
    /** The port the server is listening on, or `null` if not started. */
    port = null;
    /** Whether the server has been started. */
    started = false;
    /** Whether the server has been stopped. */
    stopped = false;
    /**
     * Create a new CallbackServer.
     *
     * @param config - Configuration including the expected state and optional timeout.
     */
    constructor(config) {
        this.expectedState = config.expectedState;
        this.timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    }
    /**
     * Start the HTTP server on `127.0.0.1` with a random available port.
     *
     * @returns The port number and the full redirect URI.
     * @throws MCPError if the server is already started.
     */
    async start() {
        if (this.started) {
            throw new MCPError("Callback server is already started", -32010);
        }
        this.started = true;
        const server = createServer();
        this.server = server;
        await new Promise((resolve, reject) => {
            server.once("error", reject);
            server.listen(0, "127.0.0.1", () => {
                server.removeListener("error", reject);
                resolve();
            });
        });
        const address = server.address();
        if (address === null || typeof address === "string") {
            throw new MCPError("Failed to determine callback server address", -32010);
        }
        this.port = address.port;
        return {
            port: this.port,
            redirectUri: `http://127.0.0.1:${this.port}${CALLBACK_PATH}`,
        };
    }
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
    async waitForCallback() {
        if (!this.server || !this.started) {
            throw new MCPError("Callback server has not been started", -32010);
        }
        return new Promise((resolve, reject) => {
            let settled = false;
            const timeoutHandle = setTimeout(() => {
                if (!settled) {
                    settled = true;
                    void this.stop();
                    reject(new MCPError("Authorization timed out", -32010));
                }
            }, this.timeoutMs);
            const settle = (action, value) => {
                if (settled) {
                    return;
                }
                settled = true;
                clearTimeout(timeoutHandle);
                void this.stop();
                if (action === "resolve") {
                    resolve(value);
                }
                else {
                    reject(value);
                }
            };
            // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- server is checked above
            this.server.on("request", (req, res) => {
                // Only handle GET requests to the callback path.
                const requestUrl = new URL(req.url ?? "/", `http://127.0.0.1:${String(this.port)}`);
                if (requestUrl.pathname !== CALLBACK_PATH) {
                    res.writeHead(404, { "Content-Type": "text/plain" });
                    res.end("Not Found");
                    return;
                }
                // Check for OAuth error response.
                const oauthError = requestUrl.searchParams.get("error");
                if (oauthError) {
                    const errorDescription = requestUrl.searchParams.get("error_description") ??
                        "Authorization failed";
                    const errorHtml = buildErrorHtml(`${oauthError}: ${errorDescription}`);
                    res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
                    res.end(errorHtml);
                    settle("reject", new MCPError(`${oauthError}: ${errorDescription}`, -32010));
                    return;
                }
                // Extract code and state parameters.
                const code = requestUrl.searchParams.get("code");
                const state = requestUrl.searchParams.get("state");
                if (!code || !state) {
                    const errorHtml = buildErrorHtml("Missing required query parameters: code and state");
                    res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
                    res.end(errorHtml);
                    settle("reject", new MCPError("Missing required query parameters: code and state", -32010));
                    return;
                }
                // Validate state for CSRF protection.
                if (state !== this.expectedState) {
                    const errorHtml = buildErrorHtml("State mismatch — possible CSRF attack");
                    res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
                    res.end(errorHtml);
                    settle("reject", new MCPError("State mismatch", -32010));
                    return;
                }
                // Success: respond with the success page and resolve.
                res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
                res.end(SUCCESS_HTML);
                settle("resolve", { code, state });
            });
        });
    }
    /**
     * Shut down the HTTP server gracefully.
     *
     * Safe to call multiple times; subsequent calls are no-ops.
     *
     * @returns A promise that resolves when the server has fully closed.
     */
    async stop() {
        if (this.stopped || !this.server) {
            return;
        }
        this.stopped = true;
        const server = this.server;
        this.server = null;
        return new Promise((resolve) => {
            server.close(() => {
                resolve();
            });
        });
    }
    /**
     * Return the redirect URI for this callback server.
     *
     * Only valid after {@link start} has been called.
     *
     * @returns The full redirect URI (e.g., `http://127.0.0.1:12345/callback`).
     * @throws MCPError if the server has not been started.
     */
    getRedirectUri() {
        if (this.port === null) {
            throw new MCPError("Callback server has not been started — redirect URI not available", -32010);
        }
        return `http://127.0.0.1:${this.port}${CALLBACK_PATH}`;
    }
}
// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------
/**
 * Build an error HTML page to show in the user's browser.
 *
 * @param message - The error message to display.
 * @returns An HTML string.
 */
function buildErrorHtml(message) {
    // Escape HTML entities in the message to prevent XSS.
    const escaped = message
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
    return `<html><body><h1>Authentication Failed</h1>
<p>${escaped}</p>
<p>Please close this window and try again.</p></body></html>`;
}
//# sourceMappingURL=callback-server.js.map
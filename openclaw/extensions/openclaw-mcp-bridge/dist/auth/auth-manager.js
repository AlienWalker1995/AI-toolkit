/**
 * Central OAuth 2.1 orchestrator for MCP authorization.
 *
 * AuthManager coordinates the full OAuth 2.1 flow for a single MCP server:
 * - 401 handling: discover metadata, register client, PKCE, browser auth, token exchange
 * - 403 `insufficient_scope` handling: step-up authorization with expanded scopes
 * - Token refresh with re-auth fallback
 * - RFC 8707 `resource` parameter in authorization and token requests
 *
 * Integrates with StreamableHTTPTransport as auth middleware: the transport
 * calls {@link getAccessToken} before each request and delegates 401/403
 * responses to {@link handleUnauthorized} / {@link handleInsufficientScope}.
 *
 * @see https://modelcontextprotocol.io/specification/draft/basic/authorization
 * @see https://datatracker.ietf.org/doc/html/rfc8707
 */
import { randomBytes } from "node:crypto";
import { MCPError } from "../types.js";
import { discoverAuth, parseWWWAuthenticate } from "./discovery.js";
import { registerClient } from "./client-registration.js";
import { generatePKCE } from "./pkce.js";
import { CallbackServer } from "./callback-server.js";
// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
/** Timeout in milliseconds for token exchange HTTP requests. */
const TOKEN_EXCHANGE_TIMEOUT_MS = 10_000;
/** Length in bytes for the random OAuth state parameter (produces 64 hex chars). */
const STATE_BYTES = 32;
// ---------------------------------------------------------------------------
// Default browser opener
// ---------------------------------------------------------------------------
/**
 * Default browser opener that logs the authorization URL to the console.
 *
 * In production, the plugin should provide a real browser opener (e.g.,
 * `child_process.exec('open <url>')` on macOS). This stub ensures the
 * AuthManager works without external dependencies.
 *
 * @param url - The authorization URL the user must visit.
 */
async function defaultOpenBrowser(url) {
    console.log("[OpenClaw] Please open the following URL in your browser to authorize:");
    console.log(url);
}
// ---------------------------------------------------------------------------
// AuthManager
// ---------------------------------------------------------------------------
/**
 * Central OAuth 2.1 orchestrator for a single MCP server.
 *
 * Each MCP server connection should have its own AuthManager instance.
 * The AuthManager caches discovery results and client credentials to avoid
 * redundant network requests across multiple auth flows.
 */
export class AuthManager {
    /** The MCP server URL this manager authenticates against. */
    serverUrl;
    /** Pre-registered client ID from configuration. */
    clientId;
    /** Pre-registered client secret from configuration. */
    clientSecret;
    /** Optional client metadata URL for metadata document registration. */
    clientMetadataUrl;
    /** Token store for persisting and retrieving OAuth tokens. */
    tokenStore;
    /** Function to open a URL in the user's browser. */
    openBrowser;
    /** Cached discovery result to avoid repeated metadata fetches. */
    cachedDiscovery = null;
    /** Cached client credentials to avoid repeated registrations. */
    cachedCredentials = null;
    /**
     * Create a new AuthManager for an MCP server.
     *
     * @param config - Configuration including server URL, optional client
     *   credentials, token store, and browser opener.
     */
    constructor(config) {
        this.serverUrl = config.serverUrl;
        this.clientId = config.clientId;
        this.clientSecret = config.clientSecret;
        this.clientMetadataUrl = config.clientMetadataUrl;
        this.tokenStore = config.tokenStore;
        this.openBrowser = config.openBrowser ?? defaultOpenBrowser;
    }
    // -------------------------------------------------------------------------
    // Public API
    // -------------------------------------------------------------------------
    /**
     * Get a valid access token for this server.
     *
     * Returns a cached, non-expired token if one exists. If the stored token
     * needs refreshing, attempts a token refresh first. Returns `null` if no
     * valid token is available (the caller should then trigger a full auth flow
     * via {@link handleUnauthorized}).
     *
     * @returns The valid access token string, or `null` if not authenticated.
     */
    async getAccessToken() {
        // Try to get a valid (non-expired) token directly.
        const validToken = await this.tokenStore.getValidToken(this.serverUrl);
        if (validToken !== null) {
            return validToken;
        }
        // Check if we have tokens that can be refreshed.
        const needsRefresh = await this.tokenStore.needsRefresh(this.serverUrl);
        if (needsRefresh) {
            const refreshed = await this.refreshToken();
            if (refreshed !== null) {
                return refreshed;
            }
        }
        return null;
    }
    /**
     * Handle a 401 response by performing the full OAuth 2.1 authorization flow.
     *
     * Steps:
     * 1. Discover protected resource and authorization server metadata
     * 2. Register the client with the authorization server
     * 3. Generate PKCE code verifier and challenge
     * 4. Generate a random state parameter for CSRF protection
     * 5. Start a local callback server for the redirect
     * 6. Build the authorization URL with all required parameters
     * 7. Open the user's browser to the authorization URL
     * 8. Wait for the authorization code callback
     * 9. Exchange the authorization code for tokens
     * 10. Store the tokens and return the access token
     *
     * @param wwwAuthHeader - The `WWW-Authenticate` header from the 401 response.
     * @returns The new access token after successful authentication.
     * @throws MCPError if any step of the authorization flow fails.
     */
    async handleUnauthorized(wwwAuthHeader) {
        // Step 1: Discover metadata.
        const discovery = await discoverAuth(this.serverUrl, wwwAuthHeader);
        this.cachedDiscovery = discovery;
        // Step 2: Register client.
        const credentials = await registerClient(discovery.authServerMetadata, {
            clientId: this.clientId,
            clientSecret: this.clientSecret,
            clientMetadataUrl: this.clientMetadataUrl,
        });
        this.cachedCredentials = credentials;
        // Perform the authorization code flow with the discovered scopes.
        return this.performAuthorizationCodeFlow(discovery.authServerMetadata, credentials, discovery.requiredScopes);
    }
    /**
     * Handle a 403 `insufficient_scope` response by re-authorizing with
     * expanded scopes.
     *
     * Parses the `WWW-Authenticate` header to extract the required scopes,
     * merges them with any previously granted scopes, and performs a new
     * authorization code flow with the expanded scope set.
     *
     * @param wwwAuthHeader - The `WWW-Authenticate` header from the 403 response.
     * @returns The new access token with expanded scopes.
     * @throws MCPError if the step-up authorization flow fails.
     */
    async handleInsufficientScope(wwwAuthHeader) {
        // Parse the WWW-Authenticate header to get the required scopes.
        let requiredScopes = [];
        if (wwwAuthHeader) {
            const parsed = parseWWWAuthenticate(wwwAuthHeader);
            if (parsed.scope) {
                requiredScopes = parsed.scope.split(/\s+/).filter(Boolean);
            }
        }
        // Merge with any previously granted scopes.
        const existingTokens = await this.tokenStore.retrieve(this.serverUrl);
        if (existingTokens?.scope) {
            const existingScopes = existingTokens.scope.split(/\s+/).filter(Boolean);
            const mergedSet = new Set([...existingScopes, ...requiredScopes]);
            requiredScopes = [...mergedSet];
        }
        // Use cached discovery or re-discover.
        let discovery = this.cachedDiscovery;
        if (!discovery) {
            discovery = await discoverAuth(this.serverUrl, wwwAuthHeader);
            this.cachedDiscovery = discovery;
        }
        // Use cached credentials or re-register.
        let credentials = this.cachedCredentials;
        if (!credentials) {
            credentials = await registerClient(discovery.authServerMetadata, {
                clientId: this.clientId,
                clientSecret: this.clientSecret,
                clientMetadataUrl: this.clientMetadataUrl,
            });
            this.cachedCredentials = credentials;
        }
        return this.performAuthorizationCodeFlow(discovery.authServerMetadata, credentials, requiredScopes);
    }
    /**
     * Attempt to refresh an expired token using the stored refresh token.
     *
     * If no refresh token is stored, or if the refresh request fails, returns
     * `null`. The caller should fall back to a full re-authorization via
     * {@link handleUnauthorized}.
     *
     * @returns The new access token, or `null` if refresh failed.
     */
    async refreshToken() {
        // Retrieve stored tokens to get the refresh token.
        const stored = await this.tokenStore.retrieve(this.serverUrl);
        if (!stored?.refreshToken) {
            return null;
        }
        // We need the token endpoint. Use cached discovery or re-discover.
        let discovery = this.cachedDiscovery;
        if (!discovery) {
            try {
                discovery = await discoverAuth(this.serverUrl);
                this.cachedDiscovery = discovery;
            }
            catch {
                return null;
            }
        }
        // We need client credentials. Use cached or re-register.
        let credentials = this.cachedCredentials;
        if (!credentials) {
            try {
                credentials = await registerClient(discovery.authServerMetadata, {
                    clientId: this.clientId,
                    clientSecret: this.clientSecret,
                    clientMetadataUrl: this.clientMetadataUrl,
                });
                this.cachedCredentials = credentials;
            }
            catch {
                return null;
            }
        }
        const tokenEndpoint = discovery.authServerMetadata.token_endpoint;
        // Build the refresh token request body.
        const body = new URLSearchParams();
        body.set("grant_type", "refresh_token");
        body.set("refresh_token", stored.refreshToken);
        body.set("client_id", credentials.clientId);
        body.set("resource", this.serverUrl);
        // Include client secret if available.
        if (credentials.clientSecret) {
            body.set("client_secret", credentials.clientSecret);
        }
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), TOKEN_EXCHANGE_TIMEOUT_MS);
        try {
            const response = await fetch(tokenEndpoint, {
                method: "POST",
                headers: {
                    "Content-Type": "application/x-www-form-urlencoded",
                    Accept: "application/json",
                },
                body: body.toString(),
                signal: controller.signal,
            });
            if (!response.ok) {
                // Refresh failed — caller should fall back to full re-auth.
                return null;
            }
            const tokenResponse = (await response.json());
            validateTokenResponse(tokenResponse);
            await this.tokenStore.updateTokens(this.serverUrl, tokenResponse);
            return tokenResponse.access_token;
        }
        catch {
            // Any error during refresh — return null so caller can fall back.
            return null;
        }
        finally {
            clearTimeout(timer);
        }
    }
    /**
     * Clear stored tokens for this server.
     *
     * Also clears cached discovery results and client credentials, forcing
     * a fresh auth flow on the next request.
     */
    async clearTokens() {
        await this.tokenStore.delete(this.serverUrl);
        this.cachedDiscovery = null;
        this.cachedCredentials = null;
    }
    // -------------------------------------------------------------------------
    // Private methods
    // -------------------------------------------------------------------------
    /**
     * Perform the full OAuth 2.1 authorization code flow with PKCE.
     *
     * This is the core flow shared by {@link handleUnauthorized} and
     * {@link handleInsufficientScope}. It opens a browser for user
     * authorization, waits for the callback, exchanges the code for tokens,
     * and stores them.
     *
     * @param authServerMetadata - The authorization server metadata.
     * @param credentials - The client credentials (from registration).
     * @param scopes - The scopes to request in the authorization.
     * @returns The access token from the token exchange.
     * @throws MCPError if any step fails.
     */
    async performAuthorizationCodeFlow(authServerMetadata, credentials, scopes) {
        // Step 3: Generate PKCE code verifier and challenge.
        const pkce = await generatePKCE();
        // Step 4: Generate a random state parameter for CSRF protection.
        const state = randomBytes(STATE_BYTES).toString("hex");
        // Step 5: Create and start a callback server.
        const callbackServer = new CallbackServer({ expectedState: state });
        const { redirectUri } = await callbackServer.start();
        try {
            // Step 6: Build the authorization URL.
            const authUrl = new URL(authServerMetadata.authorization_endpoint);
            authUrl.searchParams.set("response_type", "code");
            authUrl.searchParams.set("client_id", credentials.clientId);
            authUrl.searchParams.set("redirect_uri", redirectUri);
            authUrl.searchParams.set("state", state);
            authUrl.searchParams.set("code_challenge", pkce.codeChallenge);
            authUrl.searchParams.set("code_challenge_method", pkce.codeChallengeMethod);
            authUrl.searchParams.set("resource", this.serverUrl);
            if (scopes.length > 0) {
                authUrl.searchParams.set("scope", scopes.join(" "));
            }
            // Step 7: Open the user's browser.
            await this.openBrowser(authUrl.toString());
            // Step 8: Wait for the authorization code callback.
            const { code } = await callbackServer.waitForCallback();
            // Step 9: Exchange the authorization code for tokens.
            const tokenResponse = await this.exchangeAuthorizationCode(authServerMetadata.token_endpoint, code, redirectUri, pkce.codeVerifier, credentials);
            // Step 10: Store the tokens.
            await this.tokenStore.store(this.serverUrl, tokenResponse);
            return tokenResponse.access_token;
        }
        finally {
            // Ensure the callback server is always stopped, even on error.
            await callbackServer.stop();
        }
    }
    /**
     * Exchange an authorization code for OAuth tokens at the token endpoint.
     *
     * Sends a POST request with `grant_type=authorization_code` and all
     * required parameters including the PKCE code verifier and RFC 8707
     * resource parameter.
     *
     * @param tokenEndpoint - The token endpoint URL.
     * @param code - The authorization code from the callback.
     * @param redirectUri - The redirect URI used in the authorization request.
     * @param codeVerifier - The PKCE code verifier.
     * @param credentials - The client credentials.
     * @returns The parsed token response.
     * @throws MCPError if the exchange fails or times out.
     */
    async exchangeAuthorizationCode(tokenEndpoint, code, redirectUri, codeVerifier, credentials) {
        const body = new URLSearchParams();
        body.set("grant_type", "authorization_code");
        body.set("code", code);
        body.set("redirect_uri", redirectUri);
        body.set("code_verifier", codeVerifier);
        body.set("client_id", credentials.clientId);
        body.set("resource", this.serverUrl);
        // Include client secret if available.
        if (credentials.clientSecret) {
            body.set("client_secret", credentials.clientSecret);
        }
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), TOKEN_EXCHANGE_TIMEOUT_MS);
        try {
            const response = await fetch(tokenEndpoint, {
                method: "POST",
                headers: {
                    "Content-Type": "application/x-www-form-urlencoded",
                    Accept: "application/json",
                },
                body: body.toString(),
                signal: controller.signal,
            });
            if (!response.ok) {
                let detail = "";
                try {
                    const errorBody = (await response.json());
                    if (typeof errorBody["error"] === "string") {
                        detail = `: ${errorBody["error"]}`;
                        if (typeof errorBody["error_description"] === "string") {
                            detail += ` — ${errorBody["error_description"]}`;
                        }
                    }
                }
                catch {
                    // Ignore JSON parse errors on error responses.
                }
                throw new MCPError(`Token exchange failed: ${String(response.status)} ${response.statusText}${detail}`, response.status);
            }
            const tokenResponse = (await response.json());
            validateTokenResponse(tokenResponse);
            return tokenResponse;
        }
        catch (error) {
            if (error instanceof MCPError) {
                throw error;
            }
            if (error instanceof DOMException && error.name === "AbortError") {
                throw new MCPError(`Token exchange timed out after ${String(TOKEN_EXCHANGE_TIMEOUT_MS)}ms: ${tokenEndpoint}`, 408);
            }
            const message = error instanceof Error ? error.message : String(error);
            throw new MCPError(`Token exchange failed for ${tokenEndpoint}: ${message}`, -32006);
        }
        finally {
            clearTimeout(timer);
        }
    }
}
// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------
/**
 * Validate that a token response contains the required fields.
 *
 * @param response - The parsed JSON response body.
 * @throws MCPError if required fields are missing or have invalid types.
 */
function validateTokenResponse(response) {
    if (typeof response.access_token !== "string" || !response.access_token) {
        throw new MCPError("Token response is missing required 'access_token' field", -32006);
    }
    if (typeof response.token_type !== "string" || !response.token_type) {
        throw new MCPError("Token response is missing required 'token_type' field", -32006);
    }
    if (typeof response.expires_in !== "number" || response.expires_in <= 0) {
        throw new MCPError("Token response has invalid or missing 'expires_in' field", -32006);
    }
}
//# sourceMappingURL=auth-manager.js.map
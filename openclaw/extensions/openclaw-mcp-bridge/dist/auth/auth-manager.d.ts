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
import type { TokenStore } from "./token-store.js";
/** Configuration for creating an {@link AuthManager} instance. */
export interface AuthManagerConfig {
    /** The MCP server URL this auth manager handles. */
    serverUrl: string;
    /** Pre-registered client ID from configuration. */
    clientId?: string;
    /** Pre-registered client secret from configuration. */
    clientSecret?: string;
    /** Optional client metadata URL for metadata document registration. */
    clientMetadataUrl?: string;
    /** Token store instance (shared across all auth managers). */
    tokenStore: TokenStore;
    /**
     * Custom function to open a URL in the user's browser.
     * Defaults to logging the URL to the console.
     */
    openBrowser?: (url: string) => Promise<void>;
}
/**
 * Central OAuth 2.1 orchestrator for a single MCP server.
 *
 * Each MCP server connection should have its own AuthManager instance.
 * The AuthManager caches discovery results and client credentials to avoid
 * redundant network requests across multiple auth flows.
 */
export declare class AuthManager {
    /** The MCP server URL this manager authenticates against. */
    private readonly serverUrl;
    /** Pre-registered client ID from configuration. */
    private readonly clientId?;
    /** Pre-registered client secret from configuration. */
    private readonly clientSecret?;
    /** Optional client metadata URL for metadata document registration. */
    private readonly clientMetadataUrl?;
    /** Token store for persisting and retrieving OAuth tokens. */
    private readonly tokenStore;
    /** Function to open a URL in the user's browser. */
    private readonly openBrowser;
    /** Cached discovery result to avoid repeated metadata fetches. */
    private cachedDiscovery;
    /** Cached client credentials to avoid repeated registrations. */
    private cachedCredentials;
    /**
     * Create a new AuthManager for an MCP server.
     *
     * @param config - Configuration including server URL, optional client
     *   credentials, token store, and browser opener.
     */
    constructor(config: AuthManagerConfig);
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
    getAccessToken(): Promise<string | null>;
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
    handleUnauthorized(wwwAuthHeader?: string): Promise<string>;
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
    handleInsufficientScope(wwwAuthHeader?: string): Promise<string>;
    /**
     * Attempt to refresh an expired token using the stored refresh token.
     *
     * If no refresh token is stored, or if the refresh request fails, returns
     * `null`. The caller should fall back to a full re-authorization via
     * {@link handleUnauthorized}.
     *
     * @returns The new access token, or `null` if refresh failed.
     */
    refreshToken(): Promise<string | null>;
    /**
     * Clear stored tokens for this server.
     *
     * Also clears cached discovery results and client credentials, forcing
     * a fresh auth flow on the next request.
     */
    clearTokens(): Promise<void>;
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
    private performAuthorizationCodeFlow;
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
    private exchangeAuthorizationCode;
}
//# sourceMappingURL=auth-manager.d.ts.map
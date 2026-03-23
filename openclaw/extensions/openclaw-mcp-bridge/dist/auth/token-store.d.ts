/**
 * Persistent storage for OAuth tokens, keyed by MCP server URL.
 *
 * Tokens are stored as plain JSON files in `~/.openclaw/mcp/tokens/`
 * with filenames derived from the SHA-256 hash of the server URL.
 * Encryption via OS keychain is deferred to Phase 3.
 *
 * File writes are atomic (write to temp file then rename) to prevent
 * corruption from concurrent access or crashes.
 *
 * @see SPEC.md section 5.3 for token storage specification
 * @see SPEC.md section 5.4 for token lifecycle
 */
/** The on-disk representation of stored OAuth tokens for a single MCP server. */
export interface StoredTokens {
    /** The OAuth 2.0 access token. */
    readonly accessToken: string;
    /** The OAuth 2.0 refresh token, if issued. */
    readonly refreshToken?: string;
    /** The token type (e.g., "Bearer"). */
    readonly tokenType: string;
    /** Unix timestamp in milliseconds when the access token expires. */
    readonly expiresAt: number;
    /** Space-separated scope string, if provided by the authorization server. */
    readonly scope?: string;
    /** The MCP server URL these tokens are associated with. */
    readonly serverUrl: string;
}
/** Configuration options for the {@link TokenStore}. */
export interface TokenStoreConfig {
    /** Directory for token files. Default: `~/.openclaw/mcp/tokens`. */
    storageDir?: string;
}
/**
 * OAuth 2.0 token response from an authorization server.
 *
 * Uses snake_case field names as specified by RFC 6749 section 5.1.
 */
export interface OAuthTokenResponse {
    /** The access token issued by the authorization server. */
    access_token: string;
    /** The type of the token (e.g., "Bearer"). */
    token_type: string;
    /** Lifetime of the access token in seconds. */
    expires_in: number;
    /** The refresh token, which can be used to obtain new access tokens. */
    refresh_token?: string;
    /** Space-separated scope string granted by the authorization server. */
    scope?: string;
}
/**
 * Persistent storage for OAuth tokens, keyed by MCP server URL.
 *
 * Provides CRUD operations for storing, retrieving, and managing OAuth tokens
 * on disk. Token files are plain JSON stored in a configurable directory
 * (default: `~/.openclaw/mcp/tokens`).
 *
 * File writes are performed atomically (write to temp file then rename) to
 * prevent corruption from crashes or concurrent access.
 */
export declare class TokenStore {
    /** The directory where token files are stored. */
    private readonly storageDir;
    /** Whether the storage directory has been ensured to exist. */
    private dirEnsured;
    /**
     * Create a new TokenStore.
     *
     * @param config - Optional configuration. If `storageDir` is not provided,
     *   tokens are stored in `~/.openclaw/mcp/tokens`.
     */
    constructor(config?: TokenStoreConfig);
    /**
     * Ensure the storage directory exists, creating it recursively if needed.
     *
     * This is called lazily before the first write operation and cached so
     * subsequent calls are no-ops.
     */
    private ensureDir;
    /**
     * Compute the file path for a given server URL.
     *
     * @param serverUrl - The MCP server URL.
     * @returns The absolute path to the token file.
     */
    private filePath;
    /**
     * Write data to a file atomically by writing to a temporary file first
     * and then renaming it to the target path.
     *
     * @param targetPath - The final file path.
     * @param data - The string data to write.
     */
    private atomicWrite;
    /**
     * Store OAuth tokens for an MCP server.
     *
     * Converts the token response to the stored format, computing `expiresAt`
     * from the current time plus `expires_in`. Writes the tokens atomically
     * to `<storageDir>/<hash>.json`.
     *
     * @param serverUrl - The MCP server URL these tokens belong to.
     * @param tokens - The OAuth token response from the authorization server.
     */
    store(serverUrl: string, tokens: OAuthTokenResponse): Promise<void>;
    /**
     * Retrieve stored tokens for an MCP server.
     *
     * @param serverUrl - The MCP server URL.
     * @returns The stored tokens, or `null` if no tokens exist for this server.
     */
    retrieve(serverUrl: string): Promise<StoredTokens | null>;
    /**
     * Get a valid (non-expired) access token for an MCP server.
     *
     * Returns `null` if:
     * - No tokens are stored for this server.
     * - The stored token has expired.
     * - The stored token expires within the 60-second buffer window.
     *
     * @param serverUrl - The MCP server URL.
     * @returns The valid access token string, or `null`.
     */
    getValidToken(serverUrl: string): Promise<string | null>;
    /**
     * Check whether the stored token for a server needs to be refreshed.
     *
     * Returns `true` if tokens exist but are expired or expire within
     * the 60-second buffer window.
     *
     * @param serverUrl - The MCP server URL.
     * @returns `true` if a refresh is needed, `false` otherwise.
     */
    needsRefresh(serverUrl: string): Promise<boolean>;
    /**
     * Update stored tokens after a token refresh.
     *
     * Handles refresh token rotation: if the new token response includes a
     * `refresh_token`, it replaces the old one. Otherwise, the existing
     * refresh token is preserved.
     *
     * @param serverUrl - The MCP server URL.
     * @param tokens - The new OAuth token response from the refresh.
     */
    updateTokens(serverUrl: string, tokens: OAuthTokenResponse): Promise<void>;
    /**
     * Delete stored tokens for an MCP server.
     *
     * Removes the token file. If no token file exists, this is a no-op.
     *
     * @param serverUrl - The MCP server URL.
     */
    delete(serverUrl: string): Promise<void>;
    /**
     * List all MCP server URLs that have stored tokens.
     *
     * Reads all `.json` token files in the storage directory and extracts
     * the `serverUrl` field from each.
     *
     * @returns An array of server URL strings.
     */
    listServers(): Promise<string[]>;
}
//# sourceMappingURL=token-store.d.ts.map
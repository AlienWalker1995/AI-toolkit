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
import { mkdir, readFile, writeFile, unlink, readdir, rename } from "node:fs/promises";
import { createHash, randomBytes } from "node:crypto";
import { homedir } from "node:os";
import { join } from "node:path";
import { MCPError } from "../types.js";
// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
/** Default storage directory relative to the user's home directory. */
const DEFAULT_STORAGE_DIR = join(homedir(), ".openclaw", "mcp", "tokens");
/** Number of hex characters to use from the SHA-256 hash for filenames. */
const HASH_TRUNCATION_LENGTH = 16;
/**
 * Buffer in milliseconds before actual expiry to consider a token expired.
 * This prevents using tokens that are about to expire during in-flight requests.
 */
const EXPIRY_BUFFER_MS = 60_000;
// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------
/**
 * Compute a truncated SHA-256 hash of a server URL for use as a filename.
 *
 * @param serverUrl - The MCP server URL to hash.
 * @returns A hex string of length {@link HASH_TRUNCATION_LENGTH}.
 */
function computeServerHash(serverUrl) {
    return createHash("sha256")
        .update(serverUrl)
        .digest("hex")
        .slice(0, HASH_TRUNCATION_LENGTH);
}
/**
 * Convert an {@link OAuthTokenResponse} to {@link StoredTokens}.
 *
 * Computes `expiresAt` from the current time plus the `expires_in` value.
 *
 * @param serverUrl - The MCP server URL these tokens belong to.
 * @param tokens - The OAuth token response from the authorization server.
 * @returns The tokens in stored format.
 */
function toStoredTokens(serverUrl, tokens) {
    const stored = {
        accessToken: tokens.access_token,
        tokenType: tokens.token_type,
        expiresAt: Date.now() + tokens.expires_in * 1000,
        serverUrl,
        ...(tokens.refresh_token !== undefined
            ? { refreshToken: tokens.refresh_token }
            : {}),
        ...(tokens.scope !== undefined ? { scope: tokens.scope } : {}),
    };
    return stored;
}
/**
 * Parse and validate a JSON string as a {@link StoredTokens} object.
 *
 * @param json - Raw JSON string from a token file.
 * @returns The parsed and validated StoredTokens.
 * @throws MCPError if the JSON is invalid or missing required fields.
 */
function parseStoredTokens(json) {
    let parsed;
    try {
        parsed = JSON.parse(json);
    }
    catch {
        throw new MCPError("Token file contains invalid JSON", -32010);
    }
    if (typeof parsed !== "object" || parsed === null) {
        throw new MCPError("Token file does not contain a JSON object", -32010);
    }
    const record = parsed;
    if (typeof record["accessToken"] !== "string") {
        throw new MCPError("Token file is missing required field 'accessToken'", -32010);
    }
    if (typeof record["tokenType"] !== "string") {
        throw new MCPError("Token file is missing required field 'tokenType'", -32010);
    }
    if (typeof record["expiresAt"] !== "number") {
        throw new MCPError("Token file is missing required field 'expiresAt'", -32010);
    }
    if (typeof record["serverUrl"] !== "string") {
        throw new MCPError("Token file is missing required field 'serverUrl'", -32010);
    }
    return parsed;
}
// ---------------------------------------------------------------------------
// TokenStore
// ---------------------------------------------------------------------------
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
export class TokenStore {
    /** The directory where token files are stored. */
    storageDir;
    /** Whether the storage directory has been ensured to exist. */
    dirEnsured = false;
    /**
     * Create a new TokenStore.
     *
     * @param config - Optional configuration. If `storageDir` is not provided,
     *   tokens are stored in `~/.openclaw/mcp/tokens`.
     */
    constructor(config) {
        this.storageDir = config?.storageDir ?? DEFAULT_STORAGE_DIR;
    }
    /**
     * Ensure the storage directory exists, creating it recursively if needed.
     *
     * This is called lazily before the first write operation and cached so
     * subsequent calls are no-ops.
     */
    async ensureDir() {
        if (this.dirEnsured) {
            return;
        }
        await mkdir(this.storageDir, { recursive: true });
        this.dirEnsured = true;
    }
    /**
     * Compute the file path for a given server URL.
     *
     * @param serverUrl - The MCP server URL.
     * @returns The absolute path to the token file.
     */
    filePath(serverUrl) {
        return join(this.storageDir, `${computeServerHash(serverUrl)}.json`);
    }
    /**
     * Write data to a file atomically by writing to a temporary file first
     * and then renaming it to the target path.
     *
     * @param targetPath - The final file path.
     * @param data - The string data to write.
     */
    async atomicWrite(targetPath, data) {
        const suffix = randomBytes(8).toString("hex");
        const tempPath = `${targetPath}.${suffix}.tmp`;
        await writeFile(tempPath, data, "utf-8");
        await rename(tempPath, targetPath);
    }
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
    async store(serverUrl, tokens) {
        await this.ensureDir();
        const stored = toStoredTokens(serverUrl, tokens);
        const path = this.filePath(serverUrl);
        await this.atomicWrite(path, JSON.stringify(stored, null, 2));
    }
    /**
     * Retrieve stored tokens for an MCP server.
     *
     * @param serverUrl - The MCP server URL.
     * @returns The stored tokens, or `null` if no tokens exist for this server.
     */
    async retrieve(serverUrl) {
        const path = this.filePath(serverUrl);
        try {
            const json = await readFile(path, "utf-8");
            return parseStoredTokens(json);
        }
        catch (error) {
            // File not found — no stored tokens.
            if (error instanceof Error &&
                "code" in error &&
                error.code === "ENOENT") {
                return null;
            }
            throw error;
        }
    }
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
    async getValidToken(serverUrl) {
        const stored = await this.retrieve(serverUrl);
        if (stored === null) {
            return null;
        }
        const now = Date.now();
        if (stored.expiresAt < now + EXPIRY_BUFFER_MS) {
            return null;
        }
        return stored.accessToken;
    }
    /**
     * Check whether the stored token for a server needs to be refreshed.
     *
     * Returns `true` if tokens exist but are expired or expire within
     * the 60-second buffer window.
     *
     * @param serverUrl - The MCP server URL.
     * @returns `true` if a refresh is needed, `false` otherwise.
     */
    async needsRefresh(serverUrl) {
        const stored = await this.retrieve(serverUrl);
        if (stored === null) {
            return false;
        }
        const now = Date.now();
        return stored.expiresAt < now + EXPIRY_BUFFER_MS;
    }
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
    async updateTokens(serverUrl, tokens) {
        await this.ensureDir();
        // Read existing tokens to preserve the refresh token if the new
        // response doesn't include one (i.e., no refresh token rotation).
        const existing = await this.retrieve(serverUrl);
        const newStored = toStoredTokens(serverUrl, tokens);
        let merged;
        if (newStored.refreshToken === undefined && existing?.refreshToken) {
            // Preserve existing refresh token when not rotated.
            merged = {
                ...newStored,
                refreshToken: existing.refreshToken,
            };
        }
        else {
            merged = newStored;
        }
        const path = this.filePath(serverUrl);
        await this.atomicWrite(path, JSON.stringify(merged, null, 2));
    }
    /**
     * Delete stored tokens for an MCP server.
     *
     * Removes the token file. If no token file exists, this is a no-op.
     *
     * @param serverUrl - The MCP server URL.
     */
    async delete(serverUrl) {
        const path = this.filePath(serverUrl);
        try {
            await unlink(path);
        }
        catch (error) {
            // Ignore ENOENT — file already doesn't exist.
            if (error instanceof Error &&
                "code" in error &&
                error.code === "ENOENT") {
                return;
            }
            throw error;
        }
    }
    /**
     * List all MCP server URLs that have stored tokens.
     *
     * Reads all `.json` token files in the storage directory and extracts
     * the `serverUrl` field from each.
     *
     * @returns An array of server URL strings.
     */
    async listServers() {
        let files;
        try {
            files = await readdir(this.storageDir);
        }
        catch (error) {
            // Directory doesn't exist — no servers.
            if (error instanceof Error &&
                "code" in error &&
                error.code === "ENOENT") {
                return [];
            }
            throw error;
        }
        const jsonFiles = files.filter((f) => f.endsWith(".json"));
        const servers = [];
        for (const file of jsonFiles) {
            try {
                const json = await readFile(join(this.storageDir, file), "utf-8");
                const stored = parseStoredTokens(json);
                servers.push(stored.serverUrl);
            }
            catch {
                // Skip malformed token files — they will be overwritten on next store.
            }
        }
        return servers;
    }
}
//# sourceMappingURL=token-store.js.map
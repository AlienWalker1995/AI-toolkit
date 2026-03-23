/**
 * OAuth 2.1 metadata discovery for MCP authorization.
 *
 * Implements the full discovery flow:
 * 1. Parse WWW-Authenticate header from 401 responses
 * 2. Fetch Protected Resource Metadata (RFC 9728)
 * 3. Fetch Authorization Server Metadata (RFC 8414 / OIDC Discovery)
 *
 * @see https://datatracker.ietf.org/doc/html/rfc9728
 * @see https://datatracker.ietf.org/doc/html/rfc8414
 * @see https://modelcontextprotocol.io/specification/draft/basic/authorization
 */
import { MCPError } from "../types.js";
// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
/** Timeout in milliseconds for each metadata fetch request. */
const FETCH_TIMEOUT_MS = 10_000;
// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------
/**
 * Fetch JSON from a URL with a timeout and basic validation.
 *
 * @param url - The URL to fetch.
 * @returns The parsed JSON body as `unknown`.
 * @throws MCPError if the fetch fails, times out, or returns non-2xx.
 */
async function fetchJson(url) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
        const response = await fetch(url, {
            method: "GET",
            headers: { Accept: "application/json" },
            signal: controller.signal,
        });
        if (!response.ok) {
            throw new MCPError(`Metadata fetch failed: ${response.status} ${response.statusText} from ${url}`, response.status);
        }
        return (await response.json());
    }
    catch (error) {
        if (error instanceof MCPError) {
            throw error;
        }
        if (error instanceof DOMException && error.name === "AbortError") {
            throw new MCPError(`Metadata fetch timed out after ${FETCH_TIMEOUT_MS}ms: ${url}`, 408);
        }
        const message = error instanceof Error ? error.message : String(error);
        throw new MCPError(`Metadata fetch failed for ${url}: ${message}`, -32001);
    }
    finally {
        clearTimeout(timer);
    }
}
/**
 * Try to fetch JSON from a list of candidate URLs, returning the first
 * successful result. Returns `null` if all attempts fail.
 *
 * @param urls - Ordered list of candidate URLs.
 * @returns The parsed JSON from the first successful fetch, or `null`.
 */
async function fetchFirstSuccessful(urls) {
    for (const url of urls) {
        try {
            return await fetchJson(url);
        }
        catch {
            // Try the next candidate.
        }
    }
    return null;
}
/**
 * Remove a trailing slash from a string, if present.
 *
 * @param s - The input string.
 * @returns The string without a trailing slash.
 */
function stripTrailingSlash(s) {
    return s.endsWith("/") ? s.slice(0, -1) : s;
}
// ---------------------------------------------------------------------------
// parseWWWAuthenticate
// ---------------------------------------------------------------------------
/**
 * Parse a `WWW-Authenticate: Bearer ...` header value.
 *
 * Extracts `resource_metadata`, `scope`, `error`, and `error_description`
 * parameters, handling both quoted (`param="value"`) and unquoted
 * (`param=value`) forms.
 *
 * @param header - The raw header value (e.g., `Bearer resource_metadata="..."`)
 * @returns Parsed authentication parameters.
 */
export function parseWWWAuthenticate(header) {
    // Strip the "Bearer" scheme prefix if present.
    const stripped = header.replace(/^\s*Bearer\s+/i, "");
    // Parse key=value pairs. Values may be quoted or unquoted.
    // Regex matches: key = "quoted value" OR key = unquoted-token
    const params = new Map();
    const paramRegex = /(\w+)\s*=\s*(?:"([^"]*)"|([\w.~:/?#[\]@!$&'()*+,;=%-]*))/g;
    let match;
    while ((match = paramRegex.exec(stripped)) !== null) {
        const key = match[1];
        const value = match[2] ?? match[3];
        params.set(key, value);
    }
    return {
        resourceMetadataUrl: params.get("resource_metadata") ?? null,
        scope: params.get("scope") ?? null,
        error: params.get("error") ?? null,
        errorDescription: params.get("error_description") ?? null,
    };
}
// ---------------------------------------------------------------------------
// fetchProtectedResourceMetadata
// ---------------------------------------------------------------------------
/**
 * Fetch Protected Resource Metadata per RFC 9728.
 *
 * If `wwwAuth.resourceMetadataUrl` is provided, fetches that URL directly.
 * Otherwise, constructs well-known URIs:
 * 1. `https://server/.well-known/oauth-protected-resource/<path>` (if path exists)
 * 2. `https://server/.well-known/oauth-protected-resource` (root fallback)
 *
 * @param serverUrl - The MCP server URL (e.g., `https://example.com/mcp`).
 * @param wwwAuth - Parsed WWW-Authenticate info (optional).
 * @returns The protected resource metadata.
 * @throws MCPError if all discovery attempts fail or the response is invalid.
 */
export async function fetchProtectedResourceMetadata(serverUrl, wwwAuth) {
    // If we have a direct URL from the WWW-Authenticate header, use it.
    if (wwwAuth?.resourceMetadataUrl) {
        const body = await fetchJson(wwwAuth.resourceMetadataUrl);
        return validateProtectedResourceMetadata(body);
    }
    // Construct well-known URIs per RFC 9728.
    const parsed = new URL(serverUrl);
    const origin = `${parsed.protocol}//${parsed.host}`;
    const path = stripTrailingSlash(parsed.pathname);
    const candidateUrls = [];
    // If the server URL has a non-root path, try the path-aware well-known URI first.
    if (path && path !== "/") {
        candidateUrls.push(`${origin}/.well-known/oauth-protected-resource${path}`);
    }
    // Always try the root well-known URI as a fallback.
    candidateUrls.push(`${origin}/.well-known/oauth-protected-resource`);
    const body = await fetchFirstSuccessful(candidateUrls);
    if (body === null) {
        throw new MCPError(`Failed to discover Protected Resource Metadata for ${serverUrl}. ` +
            `Tried: ${candidateUrls.join(", ")}`, -32002);
    }
    return validateProtectedResourceMetadata(body);
}
/**
 * Validate that a fetched JSON body conforms to the ProtectedResourceMetadata
 * shape, specifically that it contains an `authorization_servers` array.
 *
 * @param body - The raw JSON body.
 * @returns The validated metadata.
 * @throws MCPError if required fields are missing.
 */
function validateProtectedResourceMetadata(body) {
    if (typeof body !== "object" || body === null) {
        throw new MCPError("Protected Resource Metadata response is not a JSON object", -32002);
    }
    const record = body;
    if (!Array.isArray(record["authorization_servers"])) {
        throw new MCPError("Protected Resource Metadata is missing required 'authorization_servers' array", -32002);
    }
    if (record["authorization_servers"].length === 0) {
        throw new MCPError("Protected Resource Metadata 'authorization_servers' array is empty", -32002);
    }
    for (const server of record["authorization_servers"]) {
        if (typeof server !== "string") {
            throw new MCPError("Protected Resource Metadata 'authorization_servers' contains non-string entry", -32002);
        }
    }
    return body;
}
// ---------------------------------------------------------------------------
// fetchAuthorizationServerMetadata
// ---------------------------------------------------------------------------
/**
 * Fetch Authorization Server Metadata per RFC 8414 with OIDC Discovery fallback.
 *
 * For issuer URLs with path components (e.g., `https://auth.example.com/tenant1`):
 * 1. Try `https://auth.example.com/.well-known/oauth-authorization-server/tenant1`
 * 2. Try `https://auth.example.com/.well-known/openid-configuration/tenant1`
 * 3. Try `https://auth.example.com/tenant1/.well-known/openid-configuration`
 *
 * For issuer URLs without a path:
 * 1. Try `https://auth.example.com/.well-known/oauth-authorization-server`
 * 2. Try `https://auth.example.com/.well-known/openid-configuration`
 *
 * @param issuerUrl - The authorization server issuer URL.
 * @returns The authorization server metadata.
 * @throws MCPError if all discovery attempts fail or the response is invalid.
 */
export async function fetchAuthorizationServerMetadata(issuerUrl) {
    const parsed = new URL(issuerUrl);
    const origin = `${parsed.protocol}//${parsed.host}`;
    const path = stripTrailingSlash(parsed.pathname);
    const candidateUrls = [];
    if (path && path !== "/") {
        // Issuer URL has a path component.
        candidateUrls.push(`${origin}/.well-known/oauth-authorization-server${path}`);
        candidateUrls.push(`${origin}/.well-known/openid-configuration${path}`);
        candidateUrls.push(`${origin}${path}/.well-known/openid-configuration`);
    }
    else {
        // Root issuer URL — no path component.
        candidateUrls.push(`${origin}/.well-known/oauth-authorization-server`);
        candidateUrls.push(`${origin}/.well-known/openid-configuration`);
    }
    const body = await fetchFirstSuccessful(candidateUrls);
    if (body === null) {
        throw new MCPError(`Failed to discover Authorization Server Metadata for ${issuerUrl}. ` +
            `Tried: ${candidateUrls.join(", ")}`, -32003);
    }
    return validateAuthorizationServerMetadata(body);
}
/**
 * Validate that a fetched JSON body conforms to the AuthorizationServerMetadata
 * shape, specifically that it contains the required fields.
 *
 * @param body - The raw JSON body.
 * @returns The validated metadata.
 * @throws MCPError if required fields are missing.
 */
function validateAuthorizationServerMetadata(body) {
    if (typeof body !== "object" || body === null) {
        throw new MCPError("Authorization Server Metadata response is not a JSON object", -32003);
    }
    const record = body;
    const missingFields = [];
    if (typeof record["issuer"] !== "string") {
        missingFields.push("issuer");
    }
    if (typeof record["authorization_endpoint"] !== "string") {
        missingFields.push("authorization_endpoint");
    }
    if (typeof record["token_endpoint"] !== "string") {
        missingFields.push("token_endpoint");
    }
    if (missingFields.length > 0) {
        throw new MCPError(`Authorization Server Metadata is missing required fields: ${missingFields.join(", ")}`, -32003);
    }
    return body;
}
// ---------------------------------------------------------------------------
// validatePKCESupport
// ---------------------------------------------------------------------------
/**
 * Validate that the authorization server supports PKCE with the S256 method.
 *
 * Per the MCP spec: "MCP clients MUST refuse to proceed" if S256 is not
 * supported by the authorization server.
 *
 * @param metadata - The authorization server metadata.
 * @throws MCPError if `code_challenge_methods_supported` is absent or
 *   does not include `S256`.
 */
export function validatePKCESupport(metadata) {
    const methods = metadata.code_challenge_methods_supported;
    if (!methods || !methods.includes("S256")) {
        throw new MCPError("Authorization server does not support PKCE with S256. " +
            "MCP clients MUST refuse to proceed without S256 support. " +
            `Advertised methods: ${methods ? methods.join(", ") : "(none)"}`, -32004);
    }
}
// ---------------------------------------------------------------------------
// discoverAuth
// ---------------------------------------------------------------------------
/**
 * Orchestrate the full OAuth 2.1 metadata discovery flow for an MCP server.
 *
 * Steps:
 * 1. Parse the `WWW-Authenticate` header (if provided).
 * 2. Fetch Protected Resource Metadata (RFC 9728).
 * 3. Select the first authorization server from the resource metadata.
 * 4. Fetch Authorization Server Metadata (RFC 8414 / OIDC Discovery).
 * 5. Validate PKCE S256 support.
 * 6. Determine required scopes from the WWW-Authenticate `scope` parameter,
 *    falling back to `scopes_supported` from the resource metadata.
 * 7. Return the combined discovery result.
 *
 * @param serverUrl - The MCP server URL (e.g., `https://example.com/mcp`).
 * @param wwwAuthHeader - The raw `WWW-Authenticate` header value (optional).
 * @returns The combined discovery result containing resource metadata,
 *   authorization server metadata, and required scopes.
 * @throws MCPError if any discovery step fails.
 */
export async function discoverAuth(serverUrl, wwwAuthHeader) {
    // Step 1: Parse WWW-Authenticate header.
    const wwwAuth = wwwAuthHeader
        ? parseWWWAuthenticate(wwwAuthHeader)
        : undefined;
    // Step 2: Fetch Protected Resource Metadata.
    const resourceMetadata = await fetchProtectedResourceMetadata(serverUrl, wwwAuth);
    // Step 3: Select the first authorization server.
    const authServerUrl = resourceMetadata.authorization_servers[0];
    // Step 4: Fetch Authorization Server Metadata.
    const authServerMetadata = await fetchAuthorizationServerMetadata(authServerUrl);
    // Step 5: Validate PKCE support.
    validatePKCESupport(authServerMetadata);
    // Step 6: Determine required scopes.
    // Prefer scopes from the WWW-Authenticate header (these are what the
    // server requires for the specific request that was rejected).
    // Fall back to scopes_supported from the resource metadata.
    let requiredScopes = [];
    if (wwwAuth?.scope) {
        requiredScopes = wwwAuth.scope.split(/\s+/).filter(Boolean);
    }
    else if (resourceMetadata.scopes_supported) {
        requiredScopes = [...resourceMetadata.scopes_supported];
    }
    // Step 7: Return combined result.
    return {
        resourceMetadata,
        authServerMetadata,
        requiredScopes,
    };
}
//# sourceMappingURL=discovery.js.map
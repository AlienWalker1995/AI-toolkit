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
/** Metadata about a protected resource, per RFC 9728. */
export interface ProtectedResourceMetadata {
    readonly resource: string;
    readonly authorization_servers: string[];
    readonly scopes_supported?: string[];
    readonly bearer_methods_supported?: string[];
}
/** Metadata about an authorization server, per RFC 8414 / OIDC Discovery. */
export interface AuthorizationServerMetadata {
    readonly issuer: string;
    readonly authorization_endpoint: string;
    readonly token_endpoint: string;
    readonly registration_endpoint?: string;
    readonly scopes_supported?: string[];
    readonly response_types_supported?: string[];
    readonly grant_types_supported?: string[];
    readonly code_challenge_methods_supported?: string[];
    readonly client_id_metadata_document_supported?: boolean;
}
/** Parsed parameters from a `WWW-Authenticate: Bearer ...` header. */
export interface WWWAuthenticateInfo {
    readonly resourceMetadataUrl: string | null;
    readonly scope: string | null;
    readonly error: string | null;
    readonly errorDescription: string | null;
}
/** The combined result of the full discovery flow. */
export interface DiscoveryResult {
    readonly resourceMetadata: ProtectedResourceMetadata;
    readonly authServerMetadata: AuthorizationServerMetadata;
    readonly requiredScopes: string[];
}
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
export declare function parseWWWAuthenticate(header: string): WWWAuthenticateInfo;
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
export declare function fetchProtectedResourceMetadata(serverUrl: string, wwwAuth?: WWWAuthenticateInfo): Promise<ProtectedResourceMetadata>;
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
export declare function fetchAuthorizationServerMetadata(issuerUrl: string): Promise<AuthorizationServerMetadata>;
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
export declare function validatePKCESupport(metadata: AuthorizationServerMetadata): void;
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
export declare function discoverAuth(serverUrl: string, wwwAuthHeader?: string): Promise<DiscoveryResult>;
//# sourceMappingURL=discovery.d.ts.map
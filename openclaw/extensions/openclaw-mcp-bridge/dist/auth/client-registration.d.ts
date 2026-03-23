/**
 * OAuth 2.1 client registration for MCP authorization.
 *
 * Supports three registration methods in priority order:
 * 1. Pre-registered credentials (user provides client_id in config)
 * 2. Client ID Metadata Documents (authorization server fetches metadata)
 * 3. Dynamic Client Registration (RFC 7591 — POST to registration_endpoint)
 *
 * @see https://modelcontextprotocol.io/specification/draft/basic/authorization
 * @see https://datatracker.ietf.org/doc/html/rfc7591
 * @see SPEC.md section 5.2
 */
import type { AuthorizationServerMetadata } from "./discovery.js";
/** Credentials obtained from client registration. */
export interface ClientCredentials {
    readonly clientId: string;
    readonly clientSecret?: string;
    readonly tokenEndpointAuthMethod: "none" | "client_secret_post" | "client_secret_basic";
}
/** Configuration for client registration, typically sourced from user config. */
export interface ClientRegistrationConfig {
    /** Pre-registered client ID from config. */
    clientId?: string;
    /** Pre-registered client secret from config. */
    clientSecret?: string;
    /** URL for Client ID Metadata Document (optional override). */
    clientMetadataUrl?: string;
}
/**
 * A Client ID Metadata Document per the MCP authorization spec.
 *
 * Hosted at an HTTPS URL; the authorization server fetches it to verify
 * the client identity without requiring dynamic registration.
 */
export interface ClientMetadataDocument {
    readonly client_id: string;
    readonly client_name: string;
    readonly redirect_uris: readonly string[];
    readonly grant_types: readonly string[];
    readonly response_types: readonly string[];
    readonly token_endpoint_auth_method: string;
}
/**
 * Attempt to use pre-registered client credentials from the configuration.
 *
 * If the config contains a `clientId`, returns ClientCredentials immediately.
 * The `tokenEndpointAuthMethod` is determined by whether a `clientSecret` is
 * also present: `client_secret_post` if yes, `none` if no.
 *
 * @param config - The client registration configuration.
 * @returns ClientCredentials if `config.clientId` is set, or `null` otherwise.
 */
export declare function usePreRegistered(config: ClientRegistrationConfig): ClientCredentials | null;
/**
 * Build a Client ID Metadata Document for the given metadata URL.
 *
 * The document is served at `metadataUrl` by the caller. The authorization
 * server fetches this URL to verify the client's identity, avoiding the
 * need for dynamic registration.
 *
 * Per the MCP spec, the `client_id` field in the document MUST equal the
 * URL at which the document is hosted.
 *
 * @param metadataUrl - The HTTPS URL where this document will be hosted.
 * @returns The Client ID Metadata Document object.
 */
export declare function buildClientMetadataDocument(metadataUrl: string): ClientMetadataDocument;
/**
 * Register a client via Dynamic Client Registration (RFC 7591).
 *
 * Sends a POST request to the authorization server's registration endpoint
 * with the client metadata. The server responds with assigned credentials
 * including a `client_id` and optionally a `client_secret`.
 *
 * @param registrationEndpoint - The registration endpoint URL from the
 *   authorization server metadata.
 * @param clientName - The human-readable client name to register.
 * @returns The ClientCredentials obtained from the registration response.
 * @throws MCPError if the registration request fails or returns an error.
 */
export declare function registerViaDynamicRegistration(registrationEndpoint: string, clientName?: string): Promise<ClientCredentials>;
/**
 * Orchestrate client registration by trying methods in priority order.
 *
 * Priority order (per SPEC.md section 5.2):
 * 1. **Pre-registered** — If `config.clientId` is provided, use it directly.
 * 2. **Client ID Metadata Documents** — If the authorization server supports
 *    metadata documents (`client_id_metadata_document_supported` is true)
 *    and a `clientMetadataUrl` is available, build and return metadata-based
 *    credentials.
 * 3. **Dynamic Client Registration** — If the authorization server has a
 *    `registration_endpoint`, POST to register dynamically.
 * 4. If none of the above methods are available, throw an MCPError.
 *
 * @param authServerMetadata - The authorization server metadata (from discovery).
 * @param config - The client registration configuration.
 * @returns The client credentials obtained via the first successful method.
 * @throws MCPError if no registration method is available or all methods fail.
 */
export declare function registerClient(authServerMetadata: AuthorizationServerMetadata, config: ClientRegistrationConfig): Promise<ClientCredentials>;
//# sourceMappingURL=client-registration.d.ts.map
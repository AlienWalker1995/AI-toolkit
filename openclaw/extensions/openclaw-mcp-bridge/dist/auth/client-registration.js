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
import { MCPError } from "../types.js";
// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
/** Default client name used in registration requests and metadata documents. */
const CLIENT_NAME = "OpenClaw MCP Client";
/** Default redirect URI for local OAuth callback. */
const DEFAULT_REDIRECT_URI = "http://127.0.0.1/callback";
/** Timeout in milliseconds for registration HTTP requests. */
const REGISTRATION_TIMEOUT_MS = 10_000;
// ---------------------------------------------------------------------------
// usePreRegistered
// ---------------------------------------------------------------------------
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
export function usePreRegistered(config) {
    if (!config.clientId) {
        return null;
    }
    return {
        clientId: config.clientId,
        clientSecret: config.clientSecret,
        tokenEndpointAuthMethod: config.clientSecret
            ? "client_secret_post"
            : "none",
    };
}
// ---------------------------------------------------------------------------
// buildClientMetadataDocument
// ---------------------------------------------------------------------------
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
export function buildClientMetadataDocument(metadataUrl) {
    return {
        client_id: metadataUrl,
        client_name: CLIENT_NAME,
        redirect_uris: [DEFAULT_REDIRECT_URI],
        grant_types: ["authorization_code"],
        response_types: ["code"],
        token_endpoint_auth_method: "none",
    };
}
// ---------------------------------------------------------------------------
// registerViaDynamicRegistration
// ---------------------------------------------------------------------------
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
export async function registerViaDynamicRegistration(registrationEndpoint, clientName = CLIENT_NAME) {
    const requestBody = {
        client_name: clientName,
        redirect_uris: [DEFAULT_REDIRECT_URI],
        grant_types: ["authorization_code"],
        response_types: ["code"],
        token_endpoint_auth_method: "none",
    };
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REGISTRATION_TIMEOUT_MS);
    try {
        const response = await fetch(registrationEndpoint, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Accept: "application/json",
            },
            body: JSON.stringify(requestBody),
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
            throw new MCPError(`Dynamic Client Registration failed: ${response.status} ${response.statusText}${detail}`, response.status);
        }
        const body = (await response.json());
        if (typeof body["client_id"] !== "string" || !body["client_id"]) {
            throw new MCPError("Dynamic Client Registration response is missing required 'client_id' field", -32005);
        }
        const clientId = body["client_id"];
        const clientSecret = typeof body["client_secret"] === "string"
            ? body["client_secret"]
            : undefined;
        return {
            clientId,
            clientSecret,
            tokenEndpointAuthMethod: clientSecret ? "client_secret_post" : "none",
        };
    }
    catch (error) {
        if (error instanceof MCPError) {
            throw error;
        }
        if (error instanceof DOMException && error.name === "AbortError") {
            throw new MCPError(`Dynamic Client Registration timed out after ${REGISTRATION_TIMEOUT_MS}ms: ${registrationEndpoint}`, 408);
        }
        const message = error instanceof Error ? error.message : String(error);
        throw new MCPError(`Dynamic Client Registration failed for ${registrationEndpoint}: ${message}`, -32005);
    }
    finally {
        clearTimeout(timer);
    }
}
// ---------------------------------------------------------------------------
// registerClient
// ---------------------------------------------------------------------------
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
export async function registerClient(authServerMetadata, config) {
    // Method 1: Pre-registered credentials.
    const preRegistered = usePreRegistered(config);
    if (preRegistered) {
        return preRegistered;
    }
    // Method 2: Client ID Metadata Documents.
    if (authServerMetadata.client_id_metadata_document_supported &&
        config.clientMetadataUrl) {
        const metadataDoc = buildClientMetadataDocument(config.clientMetadataUrl);
        return {
            clientId: metadataDoc.client_id,
            clientSecret: undefined,
            tokenEndpointAuthMethod: "none",
        };
    }
    // Method 3: Dynamic Client Registration.
    if (authServerMetadata.registration_endpoint) {
        return registerViaDynamicRegistration(authServerMetadata.registration_endpoint);
    }
    // No method available.
    throw new MCPError("Unable to register OAuth client: no registration method available. " +
        "Provide a 'clientId' in config, or ensure the authorization server " +
        "supports Client ID Metadata Documents or Dynamic Client Registration " +
        `(registration_endpoint). Auth server: ${authServerMetadata.issuer}`, -32005);
}
//# sourceMappingURL=client-registration.js.map
/**
 * TypeBox configuration schema for the MCP client plugin.
 *
 * Defines the full configuration shape including per-server settings
 * (transport, authentication, timeouts) and global plugin settings.
 *
 * @see SPEC.md section 6.2 for the canonical schema definition.
 */
import type { Static } from "@sinclair/typebox";
/**
 * OAuth 2.1 authentication configuration for a single MCP server.
 *
 * Supports pre-registered credentials, authorization server override,
 * and custom scope requests.
 */
export declare const ServerAuthConfig: import("@sinclair/typebox").TObject<{
    /** Pre-registered OAuth client ID (optional). */
    clientId: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TString>;
    /** OAuth client secret for confidential clients (optional). */
    clientSecret: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TString>;
    /** Override the authorization server URL (optional, normally auto-discovered via RFC 9728). */
    authorizationServerUrl: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TString>;
    /** Custom scopes to request (optional, normally derived from WWW-Authenticate). */
    scopes: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TArray<import("@sinclair/typebox").TString>>;
}>;
/**
 * Configuration for a single MCP server connection.
 *
 * Covers HTTP and stdio transports, authentication (API key or OAuth 2.1),
 * tool namespacing, and connection timeouts.
 */
export declare const MCPServerConfig: import("@sinclair/typebox").TObject<{
    /** Whether this server is enabled. */
    enabled: import("@sinclair/typebox").TBoolean;
    /** MCP server endpoint URL (required for HTTP transport). */
    url: import("@sinclair/typebox").TString;
    /** Transport type: HTTP (Streamable HTTP) or stdio (subprocess). */
    transport: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TLiteral<"http">, import("@sinclair/typebox").TLiteral<"stdio">]>>;
    /** Command to run for stdio transport. */
    command: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TString>;
    /** Arguments for the stdio command. */
    args: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TArray<import("@sinclair/typebox").TString>>;
    /** Environment variables for the stdio subprocess. */
    env: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TRecord<import("@sinclair/typebox").TString, import("@sinclair/typebox").TString>>;
    /** OAuth 2.1 authentication configuration. */
    auth: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TObject<{
        /** Pre-registered OAuth client ID (optional). */
        clientId: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TString>;
        /** OAuth client secret for confidential clients (optional). */
        clientSecret: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TString>;
        /** Override the authorization server URL (optional, normally auto-discovered via RFC 9728). */
        authorizationServerUrl: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TString>;
        /** Custom scopes to request (optional, normally derived from WWW-Authenticate). */
        scopes: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TArray<import("@sinclair/typebox").TString>>;
    }>>;
    /** Static API key sent as a Bearer token (simpler alternative to OAuth). */
    apiKey: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TString>;
    /** Namespace prefix for tools from this server (defaults to server name). */
    toolPrefix: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TString>;
    /** Connection timeout in milliseconds. */
    connectTimeoutMs: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TNumber>;
    /** Per-request timeout in milliseconds. */
    requestTimeoutMs: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TNumber>;
}>;
/**
 * Top-level plugin configuration schema.
 *
 * Contains a map of named server configurations and global plugin settings.
 */
export declare const configSchema: import("@sinclair/typebox").TObject<{
    /** Map of server name to server configuration. */
    servers: import("@sinclair/typebox").TRecord<import("@sinclair/typebox").TString, import("@sinclair/typebox").TObject<{
        /** Whether this server is enabled. */
        enabled: import("@sinclair/typebox").TBoolean;
        /** MCP server endpoint URL (required for HTTP transport). */
        url: import("@sinclair/typebox").TString;
        /** Transport type: HTTP (Streamable HTTP) or stdio (subprocess). */
        transport: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TLiteral<"http">, import("@sinclair/typebox").TLiteral<"stdio">]>>;
        /** Command to run for stdio transport. */
        command: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TString>;
        /** Arguments for the stdio command. */
        args: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TArray<import("@sinclair/typebox").TString>>;
        /** Environment variables for the stdio subprocess. */
        env: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TRecord<import("@sinclair/typebox").TString, import("@sinclair/typebox").TString>>;
        /** OAuth 2.1 authentication configuration. */
        auth: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TObject<{
            /** Pre-registered OAuth client ID (optional). */
            clientId: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TString>;
            /** OAuth client secret for confidential clients (optional). */
            clientSecret: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TString>;
            /** Override the authorization server URL (optional, normally auto-discovered via RFC 9728). */
            authorizationServerUrl: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TString>;
            /** Custom scopes to request (optional, normally derived from WWW-Authenticate). */
            scopes: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TArray<import("@sinclair/typebox").TString>>;
        }>>;
        /** Static API key sent as a Bearer token (simpler alternative to OAuth). */
        apiKey: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TString>;
        /** Namespace prefix for tools from this server (defaults to server name). */
        toolPrefix: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TString>;
        /** Connection timeout in milliseconds. */
        connectTimeoutMs: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TNumber>;
        /** Per-request timeout in milliseconds. */
        requestTimeoutMs: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TNumber>;
    }>>;
    /** Interval in milliseconds to re-discover tools from all servers. */
    toolDiscoveryInterval: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TNumber>;
    /** Maximum number of simultaneous server connections. */
    maxConcurrentServers: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TNumber>;
    /** Enable debug logging. */
    debug: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TBoolean>;
    /** Automatically inject MCP tool schemas into agent context. */
    injectSchemas: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TBoolean>;
}>;
/** TypeScript type for a single server's auth configuration. */
export type ServerAuthConfigType = Static<typeof ServerAuthConfig>;
/** TypeScript type for a single MCP server configuration. */
export type MCPServerConfigType = Static<typeof MCPServerConfig>;
/** TypeScript type for the full plugin configuration. */
export type ConfigSchemaType = Static<typeof configSchema>;
//# sourceMappingURL=config-schema.d.ts.map
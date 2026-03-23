/**
 * MCP Manager — orchestrates connections to multiple MCP servers,
 * tool discovery, and tool invocation routing.
 *
 * Manages the full lifecycle of MCP server connections: transport creation,
 * session initialization, tool discovery, tool registry synchronization,
 * and graceful shutdown. Supports both Streamable HTTP and stdio transports.
 *
 * @see SPEC.md section 3 for the architecture overview.
 * @see SPEC.md section 6.4 for plugin entry point integration.
 */
import type { ToolsCallResult, ConnectionStatus, SessionState, MCPTool } from "../types.js";
import { StreamableHTTPTransport } from "../transport/streamable-http.js";
import { StdioTransport } from "../transport/stdio.js";
import { ToolRegistry } from "./tool-registry.js";
import type { RegisteredTool } from "./tool-registry.js";
import type { MCPServerConfigType } from "../config-schema.js";
/** Result of a health check against a single MCP server. */
export interface HealthCheckResult {
    /** Logical name of the server. */
    name: string;
    /** Health status: healthy if ping succeeded, unhealthy on error response, unreachable on connection failure. */
    status: "healthy" | "unhealthy" | "unreachable";
    /** Round-trip latency of the ping in milliseconds. */
    latencyMs: number;
    /** Timestamp when this health check was performed. */
    lastChecked: Date;
    /** Number of consecutive failures tracked for this server. */
    consecutiveFailures: number;
}
/** Represents a live connection to a single MCP server. */
export interface ServerConnection {
    /** Logical name of this server (the key in the config map). */
    readonly name: string;
    /** The server configuration used to establish this connection. */
    readonly config: MCPServerConfigType;
    /** The transport instance managing communication with this server. */
    readonly transport: StreamableHTTPTransport | StdioTransport;
    /** Current connection status. */
    status: ConnectionStatus;
    /** MCP session state, populated after a successful initialize handshake. */
    sessionState: SessionState | null;
    /** Number of tools discovered from this server. */
    toolCount: number;
    /** The most recent error message, or null if no error. */
    lastError: string | null;
    /** Timestamp when the connection was established, or null if never connected. */
    connectedAt: Date | null;
    /** Number of consecutive failures observed for this server (resets on success). */
    consecutiveFailures: number;
}
/** Configuration for the MCPManager. */
export interface MCPManagerConfig {
    /** Map of server name to server configuration. */
    readonly servers: Record<string, MCPServerConfigType>;
    /** Interval in ms to re-discover tools from all servers (default: 300000). */
    readonly toolDiscoveryInterval?: number;
    /** Maximum number of simultaneous server connections (default: 20). */
    readonly maxConcurrentServers?: number;
    /** Enable debug logging (default: false). */
    readonly debug?: boolean;
    /** Maximum number of retry attempts when reconnecting to a failed server (default: 5). */
    readonly maxRetryAttempts?: number;
    /** Base delay in ms for exponential backoff (default: 1000). */
    readonly retryBaseDelayMs?: number;
    /** Maximum delay in ms for exponential backoff (default: 60000). */
    readonly retryMaxDelayMs?: number;
}
/**
 * Manages connections to multiple MCP servers, coordinates tool discovery,
 * and routes tool calls to the appropriate server.
 *
 * Provides the core connection lifecycle for the MCP client plugin:
 * connect, disconnect, reconcile config changes, discover tools, and
 * invoke remote tools via the ToolRegistry.
 */
export declare class MCPManager {
    /** Manager configuration. */
    private readonly config;
    /** Tool registry for namespace-prefixed tool management. */
    private readonly toolRegistry;
    /** Active server connections keyed by server name. */
    private readonly connections;
    /** Maximum concurrent server connections. */
    private readonly maxConcurrentServers;
    /** Whether debug logging is enabled. */
    private readonly debug;
    /** Maximum number of retry attempts for reconnection with backoff. */
    private readonly maxRetryAttempts;
    /** Base delay in ms for exponential backoff. */
    private readonly retryBaseDelayMs;
    /** Maximum delay in ms for exponential backoff. */
    private readonly retryMaxDelayMs;
    /**
     * Create a new MCPManager.
     *
     * @param config - Manager configuration including server definitions and global settings.
     */
    constructor(config: MCPManagerConfig);
    /**
     * Connect to all enabled servers defined in the configuration.
     *
     * Connections are made in parallel, respecting the maxConcurrentServers limit.
     * Individual connection failures are logged as warnings but do not cause the
     * entire batch to fail.
     *
     * @returns Resolves when all connection attempts have completed (or failed).
     */
    connectAll(): Promise<void>;
    /**
     * Connect to a single MCP server.
     *
     * Creates the appropriate transport (HTTP or stdio), performs the MCP
     * initialize handshake, discovers available tools, and registers them
     * in the ToolRegistry.
     *
     * @param name - Logical name for the server (used as the config key and tool namespace).
     * @param serverConfig - The server's configuration.
     * @throws {MCPError} If the connection or initialization fails.
     */
    connect(name: string, serverConfig: MCPServerConfigType): Promise<void>;
    /**
     * Disconnect from a single MCP server.
     *
     * Terminates the session (for HTTP: sends DELETE; for stdio: stops the process),
     * unregisters the server's tools from the ToolRegistry, and removes the
     * connection record.
     *
     * @param name - The logical name of the server to disconnect.
     */
    disconnect(name: string): Promise<void>;
    /**
     * Disconnect from all connected servers.
     *
     * Disconnections happen in parallel. Individual failures are logged but
     * do not prevent other servers from being disconnected.
     *
     * @returns Resolves when all disconnection attempts have completed.
     */
    disconnectAll(): Promise<void>;
    /**
     * Invoke a remote MCP tool by its namespaced name.
     *
     * Resolves the namespaced tool name to a server and original tool name via
     * the ToolRegistry, then sends a `tools/call` JSON-RPC request to the
     * appropriate server's transport.
     *
     * @param namespacedToolName - The full namespaced tool name (e.g., "tavily__search").
     * @param args - Arguments to pass to the tool.
     * @returns The tool call result.
     * @throws {MCPError} If the tool is not found or the server is not connected.
     */
    callTool(namespacedToolName: string, args: Record<string, unknown>): Promise<ToolsCallResult>;
    /**
     * Reconcile the current connections with a new configuration.
     *
     * Compares the new config against the current state and:
     * - Disconnects servers that were removed or disabled.
     * - Connects servers that were newly added or enabled.
     * - Reconnects servers whose configuration changed (URL, auth, etc.).
     *
     * @param newConfig - The new manager configuration to apply.
     */
    reconcile(newConfig: MCPManagerConfig): Promise<void>;
    /**
     * Re-discover tools from one or all connected servers.
     *
     * Sends a `tools/list` request to the specified server (or all servers)
     * and updates the ToolRegistry with the fresh tool list.
     *
     * @param serverName - Optional server name to refresh. If omitted, all servers are refreshed.
     */
    refreshTools(serverName?: string): Promise<void>;
    /**
     * Return all active server connections with their current status.
     *
     * @returns An array of ServerConnection records.
     */
    getConnections(): ServerConnection[];
    /**
     * Return the connection for a specific server by name.
     *
     * @param name - The logical server name.
     * @returns The ServerConnection, or undefined if not found.
     */
    getConnection(name: string): ServerConnection | undefined;
    /**
     * List tools available on a specific connected server.
     *
     * Re-fetches the tool list from the server via `tools/list`.
     *
     * @param serverName - The logical name of the server to query.
     * @returns An array of MCPTool definitions from the server.
     * @throws {MCPError} If the server is not connected.
     */
    listTools(serverName: string): Promise<MCPTool[]>;
    /**
     * Return all registered tools across all servers.
     *
     * @returns A flat array of RegisteredTool entries.
     */
    getRegisteredTools(): RegisteredTool[];
    /**
     * Return the ToolRegistry instance for direct access.
     *
     * @returns The ToolRegistry managing tool registrations.
     */
    getToolRegistry(): ToolRegistry;
    /**
     * Check the health of one or all connected servers by sending a JSON-RPC
     * `ping` request and measuring the round-trip latency.
     *
     * @param serverName - Optional server name. If omitted, all servers are checked.
     * @returns A single HealthCheckResult when a name is given, or an array when omitted.
     */
    healthCheck(serverName?: string): Promise<HealthCheckResult | HealthCheckResult[]>;
    /**
     * Perform a health check on a single server by sending a `ping` JSON-RPC request.
     *
     * @param name - The server name to check.
     * @returns The HealthCheckResult for this server.
     */
    private healthCheckServer;
    /**
     * Execute a tool call on a given connection. Factored out for reuse
     * by the auto-reconnect logic in `callTool`.
     *
     * @param connection - The server connection to use.
     * @param toolName - The original (un-namespaced) tool name.
     * @param args - Arguments to pass to the tool.
     * @param namespacedToolName - The full namespaced tool name (for error messages).
     * @returns The tool call result.
     * @throws {MCPError} If the RPC response is an error.
     */
    private executeToolCall;
    /**
     * Attempt to reconnect to a server using exponential backoff with jitter.
     *
     * Disconnects the existing session, then retries `connect()` up to
     * `maxRetryAttempts` times with increasing delays. If all attempts fail,
     * the server status is set to "error".
     *
     * @param name - The server name to reconnect.
     * @throws {MCPError} If reconnection fails after all retry attempts.
     */
    private reconnectWithBackoff;
    /**
     * Compute the backoff delay for a given retry attempt.
     *
     * Uses exponential backoff (base * 2^attempt) clamped to a maximum,
     * plus random jitter in the range [0, 1000) ms to prevent thundering herd.
     *
     * @param attempt - Zero-based retry attempt number.
     * @returns The delay in milliseconds before the next retry.
     */
    private computeBackoffDelay;
    /**
     * Determine whether an error represents a connection-level failure
     * (as opposed to a logical tool error from the server).
     *
     * Connection errors include network failures, timeouts, and transport
     * errors that indicate the server is unreachable.
     *
     * @param error - The error to inspect.
     * @returns True if the error is likely a connection/transport failure.
     */
    private isConnectionError;
    /**
     * Sleep for a given number of milliseconds.
     *
     * @param ms - Duration in milliseconds.
     * @returns A promise that resolves after the delay.
     */
    private sleep;
    /**
     * Create a StreamableHTTPTransport for an HTTP-based server.
     *
     * If the server config includes an `apiKey`, sets the Authorization header
     * as a Bearer token.
     *
     * @param serverConfig - The server configuration.
     * @returns A configured StreamableHTTPTransport instance.
     */
    private createHTTPTransport;
    /**
     * Create a StdioTransport for a subprocess-based server.
     *
     * @param serverConfig - The server configuration (must include `command`).
     * @returns A configured StdioTransport instance.
     * @throws {MCPError} If the `command` field is missing.
     */
    private createStdioTransport;
    /**
     * Perform the MCP initialize handshake with a server.
     *
     * For HTTP transports, calls the built-in `initialize()` method.
     * For stdio transports, constructs and sends the initialize request manually.
     *
     * @param name - The server name (for logging).
     * @param transport - The transport to use for the handshake.
     * @returns The server's InitializeResult.
     * @throws {MCPError} If the handshake fails.
     */
    private initializeSession;
    /**
     * Discover tools from a server via the `tools/list` MCP method.
     *
     * Handles cursor-based pagination to retrieve all available tools.
     *
     * @param name - The server name (for logging).
     * @param transport - The transport to use for the request.
     * @returns The complete array of MCPTool definitions from the server.
     * @throws {MCPError} If the tools/list request fails.
     */
    private discoverTools;
    /**
     * Refresh tools for a single connected server.
     *
     * @param name - The server name to refresh.
     * @throws {MCPError} If the server is not connected.
     */
    private refreshToolsForServer;
    /**
     * Compare two server configurations to determine if they differ in a way
     * that requires reconnection.
     *
     * Compares URL, transport type, command, args, apiKey, and auth settings.
     *
     * @param oldConfig - The previous server configuration.
     * @param newConfig - The new server configuration.
     * @returns True if the configuration has changed and requires reconnection.
     */
    private hasConfigChanged;
    /**
     * Log a message to the console when debug mode is enabled.
     *
     * @param message - The message to log.
     */
    private log;
}
//# sourceMappingURL=mcp-manager.d.ts.map
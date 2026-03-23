/**
 * Tool Registry — manages the mapping between remote MCP tools and
 * locally-registered OpenClaw tools with namespace prefixing.
 *
 * Each remote MCP tool is registered under a namespaced name of the form
 * `<prefix>__<toolName>` to prevent collisions across servers. The `__`
 * separator is chosen because it is unlikely to appear in tool names.
 *
 * @see SPEC.md section 6.5 for the namespacing convention.
 */
import type { MCPTool } from "../types.js";
/** A registered tool with its server origin. */
export interface RegisteredTool {
    /** Namespaced name: "serverName__toolName" */
    readonly namespacedName: string;
    /** Original tool name on the remote server */
    readonly originalName: string;
    /** Server this tool belongs to */
    readonly serverName: string;
    /** Tool description from the MCP server */
    readonly description: string;
    /** JSON Schema for the tool's input parameters */
    readonly inputSchema: Record<string, unknown>;
}
/** Configuration options for the ToolRegistry. */
export interface ToolRegistryConfig {
    /** Interval in ms to re-discover tools (0 = disabled) */
    readonly discoveryIntervalMs: number;
}
/**
 * Manages dynamic registration of remote MCP tools as namespaced OpenClaw tools.
 *
 * Tools from multiple MCP servers are stored in a single registry, each prefixed
 * with its server name (or a custom prefix) to avoid name collisions.
 */
export declare class ToolRegistry {
    /** Registry config (merged with defaults). */
    private readonly config;
    /**
     * Map from server name to its array of registered tools.
     * This is the primary ownership structure.
     */
    private readonly serverTools;
    /**
     * Map from namespaced tool name to the RegisteredTool entry.
     * Acts as a fast lookup index that is rebuilt on registration changes.
     */
    private readonly toolIndex;
    /**
     * Create a new ToolRegistry.
     *
     * @param config - Optional partial configuration. Missing fields use defaults.
     */
    constructor(config?: Partial<ToolRegistryConfig>);
    /**
     * Register (or re-register) all tools for a given server.
     *
     * Takes the server name and the tools array from a `tools/list` response,
     * creates namespaced names of the form `<prefix>__<toolName>`, and stores
     * them in the registry. If the server was already registered, its previous
     * tools are replaced (supporting re-discovery).
     *
     * @param serverName - The logical name of the MCP server.
     * @param tools - The tools array from the server's `tools/list` response.
     * @param prefix - Optional namespace prefix; defaults to `serverName`.
     * @returns The array of RegisteredTool entries that were registered.
     */
    registerServer(serverName: string, tools: readonly MCPTool[], prefix?: string): RegisteredTool[];
    /**
     * Remove all tools for a given server from the registry.
     *
     * @param serverName - The server whose tools should be unregistered.
     */
    unregisterServer(serverName: string): void;
    /**
     * Look up a tool by its full namespaced name.
     *
     * @param name - The namespaced tool name (e.g. "tavily__search").
     * @returns The RegisteredTool entry, or undefined if not found.
     */
    getToolByNamespacedName(name: string): RegisteredTool | undefined;
    /**
     * Parse a namespaced tool name back into the server name and original tool name.
     *
     * Used by MCPManager to route tool calls to the correct server.
     *
     * @param namespacedName - The full namespaced name (e.g. "tavily__search").
     * @returns An object with `serverName` and `toolName`, or undefined if the
     *          tool is not found in the registry.
     */
    resolveToolCall(namespacedName: string): {
        serverName: string;
        toolName: string;
    } | undefined;
    /**
     * Return all registered tools across all servers.
     *
     * @returns A flat array of every RegisteredTool in the registry.
     */
    getAllTools(): RegisteredTool[];
    /**
     * Return the tools registered for a specific server.
     *
     * @param serverName - The server name to filter by.
     * @returns An array of RegisteredTool entries for that server, or an empty
     *          array if the server is not registered.
     */
    getToolsForServer(serverName: string): RegisteredTool[];
    /**
     * Return the names of all servers that have registered tools.
     *
     * @returns An array of server name strings.
     */
    getServerNames(): string[];
    /**
     * Return the total number of registered tools across all servers.
     *
     * @returns The tool count.
     */
    getToolCount(): number;
    /**
     * Remove all tools and servers from the registry.
     */
    clear(): void;
    /**
     * Return the configured discovery interval in milliseconds.
     *
     * @returns The discovery interval, or 0 if periodic discovery is disabled.
     */
    getDiscoveryIntervalMs(): number;
}
//# sourceMappingURL=tool-registry.d.ts.map
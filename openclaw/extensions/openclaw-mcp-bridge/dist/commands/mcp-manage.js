/**
 * /mcp slash command handler.
 *
 * Parses the raw argument string from the skill command-dispatch and routes
 * to the appropriate subcommand handler. Returns formatted text output for
 * display to the user.
 *
 * @see SPEC.md section 8 for the slash command specification.
 */
// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
/** Horizontal divider used in formatted output. */
const DIVIDER = "\u2500".repeat(50);
/** Available subcommands with their descriptions (for the help output). */
const SUBCOMMANDS = [
    { name: "servers", description: "List all configured servers with status, auth type, and tool count" },
    { name: "tools", description: "List all tools, or tools for a specific server" },
    { name: "status", description: "Show detailed status for a specific server" },
    { name: "connect", description: "Add and connect to a new MCP server at runtime" },
    { name: "disconnect", description: "Disconnect from an MCP server" },
    { name: "auth", description: "Trigger the OAuth 2.1 authorization flow for a server" },
    { name: "refresh", description: "Re-discover tools from one or all servers" },
    { name: "help", description: "Show this help message" },
];
// ---------------------------------------------------------------------------
// Argument Parsing
// ---------------------------------------------------------------------------
/**
 * Parse a raw argument string into the subcommand and its arguments.
 *
 * @param rawArgs - The raw argument string from the slash command invocation.
 * @returns An object containing the subcommand name and remaining arguments.
 */
function parseArgs(rawArgs) {
    const tokens = rawArgs.trim().split(/\s+/).filter((t) => t.length > 0);
    if (tokens.length === 0) {
        return { subcommand: "servers", args: [] };
    }
    const [subcommand, ...args] = tokens;
    return { subcommand, args };
}
// ---------------------------------------------------------------------------
// Auth Description Helpers
// ---------------------------------------------------------------------------
/**
 * Determine the authentication type description for a server connection.
 *
 * @param connection - The server connection to inspect.
 * @returns A human-readable auth type string (e.g., "API Key", "OAuth", "None").
 */
function getAuthDescription(connection) {
    const config = connection.config;
    if (config.apiKey !== undefined) {
        return "API Key";
    }
    if (config.auth !== undefined) {
        return "OAuth";
    }
    return "None";
}
/**
 * Determine the transport description for a server connection.
 *
 * For HTTP servers, returns the URL. For stdio servers, returns a
 * `stdio://command args...` representation.
 *
 * @param connection - The server connection to inspect.
 * @returns A human-readable transport/URL string.
 */
function getTransportUrl(connection) {
    const config = connection.config;
    const transportType = config.transport ?? "http";
    if (transportType === "stdio") {
        const cmd = config.command ?? "unknown";
        const args = config.args ?? [];
        return `stdio://${cmd} ${args.join(" ")}`.trim();
    }
    return config.url;
}
/**
 * Format a connection status string with optional error detail.
 *
 * @param connection - The server connection to inspect.
 * @returns A human-readable status string.
 */
function formatStatus(connection) {
    switch (connection.status) {
        case "connected": {
            const transportType = connection.config.transport ?? "http";
            if (transportType === "stdio") {
                return "Running";
            }
            return "Connected";
        }
        case "connecting":
            return "Connecting...";
        case "disconnected":
            return "Disconnected";
        case "error": {
            const errorDetail = connection.lastError ?? "Unknown error";
            return `Error \u2014 ${errorDetail}`;
        }
    }
}
/**
 * Truncate a string to a specified maximum length, appending an ellipsis if truncated.
 *
 * @param value - The string to truncate.
 * @param maxLength - The maximum length including the ellipsis.
 * @returns The original or truncated string.
 */
function truncate(value, maxLength) {
    if (value.length <= maxLength) {
        return value;
    }
    return value.substring(0, maxLength - 3) + "...";
}
// ---------------------------------------------------------------------------
// Subcommand Handlers
// ---------------------------------------------------------------------------
/**
 * Handle the `servers` subcommand: list all configured servers.
 *
 * @param manager - The MCPManager instance.
 * @returns Formatted text listing all servers.
 */
function handleServers(manager) {
    const connections = manager.getConnections();
    if (connections.length === 0) {
        return "No MCP servers configured.";
    }
    const lines = [];
    lines.push(`MCP Servers (${String(connections.length)} configured)`);
    lines.push(DIVIDER);
    for (const conn of connections) {
        const url = getTransportUrl(conn);
        const status = formatStatus(conn);
        const auth = getAuthDescription(conn);
        const toolCount = String(conn.toolCount);
        lines.push(`  ${conn.name.padEnd(16)}${url}`);
        lines.push(`${"".padEnd(18)}Status: ${status} | Auth: ${auth} | Tools: ${toolCount}`);
        lines.push("");
    }
    lines.push(DIVIDER);
    return lines.join("\n");
}
/**
 * Handle the `tools` subcommand: list tools, optionally filtered by server.
 *
 * @param manager - The MCPManager instance.
 * @param args - Optional arguments; first arg is the server name filter.
 * @returns Formatted text listing tools.
 */
function handleTools(manager, args) {
    const serverFilter = args.length > 0 ? args[0] : undefined;
    let tools;
    if (serverFilter !== undefined) {
        const registry = manager.getToolRegistry();
        tools = registry.getToolsForServer(serverFilter);
        if (tools.length === 0) {
            // Check if the server exists at all
            const connection = manager.getConnection(serverFilter);
            if (connection === undefined) {
                return `Unknown server: "${serverFilter}". Run /mcp servers to see available servers.`;
            }
            return `No tools registered for server "${serverFilter}".`;
        }
    }
    else {
        tools = manager.getRegisteredTools();
        if (tools.length === 0) {
            return "No MCP tools registered.";
        }
    }
    const lines = [];
    const header = serverFilter !== undefined
        ? `MCP Tools for "${serverFilter}" (${String(tools.length)} total)`
        : `MCP Tools (${String(tools.length)} total)`;
    lines.push(header);
    lines.push(DIVIDER);
    for (const tool of tools) {
        const description = tool.description.length > 0
            ? truncate(tool.description, 60)
            : "(no description)";
        lines.push(`  ${tool.namespacedName.padEnd(30)}${description}`);
    }
    lines.push(DIVIDER);
    return lines.join("\n");
}
/**
 * Handle the `status` subcommand: detailed status for a single server.
 *
 * @param manager - The MCPManager instance.
 * @param args - Arguments; first arg is the required server name.
 * @returns Formatted text with detailed server status.
 */
function handleStatus(manager, args) {
    if (args.length === 0) {
        return 'Usage: /mcp status <serverName>\n\nPlease provide a server name.';
    }
    const serverName = args[0];
    const connection = manager.getConnection(serverName);
    if (connection === undefined) {
        return `Unknown server: "${serverName}". Run /mcp servers to see available servers.`;
    }
    const lines = [];
    lines.push(`Server: ${connection.name}`);
    lines.push(DIVIDER);
    // URL / Transport
    const url = getTransportUrl(connection);
    lines.push(`  URL:              ${url}`);
    const transportType = connection.config.transport ?? "http";
    lines.push(`  Transport:        ${transportType}`);
    // Connection status
    lines.push(`  Status:           ${formatStatus(connection)}`);
    // Session ID (truncated)
    const sessionId = connection.sessionState?.sessionId ?? null;
    if (sessionId !== null) {
        lines.push(`  Session ID:       ${truncate(sessionId, 24)}`);
    }
    else {
        lines.push("  Session ID:       (none)");
    }
    // Connected since
    if (connection.connectedAt !== null) {
        lines.push(`  Connected since:  ${connection.connectedAt.toISOString()}`);
    }
    else {
        lines.push("  Connected since:  (never)");
    }
    // Tool count
    lines.push(`  Tools:            ${String(connection.toolCount)}`);
    // Auth type
    lines.push(`  Auth:             ${getAuthDescription(connection)}`);
    // Last error
    if (connection.lastError !== null) {
        lines.push(`  Last error:       ${connection.lastError}`);
    }
    lines.push(DIVIDER);
    return lines.join("\n");
}
/**
 * Handle the `disconnect` subcommand: disconnect from a server.
 *
 * @param manager - The MCPManager instance.
 * @param args - Arguments; first arg is the required server name.
 * @returns Confirmation message.
 */
async function handleDisconnect(manager, args) {
    if (args.length === 0) {
        return 'Usage: /mcp disconnect <serverName>\n\nPlease provide a server name.';
    }
    const serverName = args[0];
    const connection = manager.getConnection(serverName);
    if (connection === undefined) {
        return `Unknown server: "${serverName}". Run /mcp servers to see available servers.`;
    }
    await manager.disconnect(serverName);
    return `Disconnected from server "${serverName}".`;
}
/**
 * Handle the `refresh` subcommand: re-discover tools from one or all servers.
 *
 * @param manager - The MCPManager instance.
 * @param args - Optional arguments; first arg is the server name to refresh.
 * @returns Confirmation message with the new tool count.
 */
async function handleRefresh(manager, args) {
    const serverName = args.length > 0 ? args[0] : undefined;
    if (serverName !== undefined) {
        const connection = manager.getConnection(serverName);
        if (connection === undefined) {
            return `Unknown server: "${serverName}". Run /mcp servers to see available servers.`;
        }
        await manager.refreshTools(serverName);
        // Re-fetch the connection to get the updated tool count
        const updated = manager.getConnection(serverName);
        const newCount = updated !== undefined ? updated.toolCount : 0;
        return `Refreshed tools for "${serverName}": ${String(newCount)} tool(s) discovered.`;
    }
    await manager.refreshTools();
    const allTools = manager.getRegisteredTools();
    return `Refreshed tools for all servers: ${String(allTools.length)} tool(s) total.`;
}
/**
 * Handle the `auth` subcommand: trigger the OAuth 2.1 flow for a server.
 *
 * Supports an optional `--code <code>` flag for headless environments where
 * the user has already obtained an authorization code out-of-band.
 *
 * @param manager - The MCPManager instance.
 * @param args - Arguments; first arg is the required server name.
 * @param resolveAuth - Optional resolver to obtain the AuthManager for a server.
 * @returns A success or failure message.
 */
async function handleAuth(manager, args, resolveAuth) {
    if (args.length === 0) {
        return 'Usage: /mcp auth <serverName> [--code <code>]\n\nPlease provide a server name.';
    }
    const serverName = args[0];
    const connection = manager.getConnection(serverName);
    if (connection === undefined) {
        return `Unknown server: "${serverName}". Run /mcp servers to see available servers.`;
    }
    // Check that the server has OAuth auth configured.
    if (connection.config.auth === undefined) {
        return `Server "${serverName}" does not have OAuth authentication configured.`;
    }
    if (resolveAuth === undefined) {
        return `Auth management is not available. No AuthManager resolver was provided.`;
    }
    const authManager = resolveAuth(serverName);
    if (authManager === undefined) {
        return `No AuthManager found for server "${serverName}".`;
    }
    // Parse the optional --code flag from args.
    let authCode;
    const codeIdx = args.indexOf("--code");
    if (codeIdx !== -1 && codeIdx + 1 < args.length) {
        authCode = args[codeIdx + 1];
    }
    try {
        if (authCode !== undefined) {
            // Headless flow: the user already has an authorization code.
            // Pass the code as the WWW-Authenticate hint is not needed for this path,
            // but handleUnauthorized will initiate discovery + exchange.
            // For headless auth, we pass the code as a custom header hint.
            await authManager.handleUnauthorized(`code=${authCode}`);
        }
        else {
            await authManager.handleUnauthorized();
        }
        return `OAuth authorization for server "${serverName}" completed successfully.`;
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return `OAuth authorization for server "${serverName}" failed: ${message}`;
    }
}
/**
 * Handle the `connect` subcommand: add and connect to a new MCP server at runtime.
 *
 * Parses the URL and optional flags from the argument list:
 *   /mcp connect <url> [--name <name>] [--transport http|stdio]
 *
 * If `--name` is not provided, a name is derived from the URL hostname.
 *
 * @param manager - The MCPManager instance.
 * @param args - Arguments; first arg is the required URL.
 * @returns A success message with the number of tools discovered.
 */
async function handleConnect(manager, args) {
    if (args.length === 0) {
        return 'Usage: /mcp connect <url> [--name <name>] [--transport http|stdio]\n\nPlease provide a server URL.';
    }
    const url = args[0];
    // Parse optional --name flag.
    let name;
    const nameIdx = args.indexOf("--name");
    if (nameIdx !== -1 && nameIdx + 1 < args.length) {
        name = args[nameIdx + 1];
    }
    // Parse optional --transport flag.
    let transport = "http";
    const transportIdx = args.indexOf("--transport");
    if (transportIdx !== -1 && transportIdx + 1 < args.length) {
        const transportValue = args[transportIdx + 1];
        if (transportValue !== "http" && transportValue !== "stdio") {
            return `Invalid transport: "${transportValue}". Must be "http" or "stdio".`;
        }
        transport = transportValue;
    }
    // Derive a name from the URL hostname if not provided.
    if (name === undefined) {
        try {
            const parsed = new URL(url);
            name = parsed.hostname.replace(/\./g, "-");
        }
        catch {
            return `Invalid URL: "${url}". Please provide a valid URL.`;
        }
    }
    // Check if a server with this name already exists.
    const existing = manager.getConnection(name);
    if (existing !== undefined) {
        return `A server named "${name}" already exists. Use a different name with --name or disconnect the existing server first.`;
    }
    try {
        await manager.connect(name, {
            url,
            transport,
            enabled: true,
        });
        const connection = manager.getConnection(name);
        const toolCount = connection !== undefined ? connection.toolCount : 0;
        return `Connected to server "${name}": ${String(toolCount)} tool(s) discovered.`;
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return `Failed to connect to server "${name}": ${message}`;
    }
}
/**
 * Handle the `help` subcommand: list available subcommands.
 *
 * @returns Formatted help text.
 */
function handleHelp() {
    const lines = [];
    lines.push("MCP Management Commands");
    lines.push(DIVIDER);
    for (const cmd of SUBCOMMANDS) {
        lines.push(`  /mcp ${cmd.name.padEnd(16)}${cmd.description}`);
    }
    lines.push(DIVIDER);
    return lines.join("\n");
}
// ---------------------------------------------------------------------------
// Main Command Handler
// ---------------------------------------------------------------------------
/**
 * Handle a `/mcp` slash command invocation.
 *
 * Parses the raw argument string, dispatches to the appropriate subcommand
 * handler, and returns formatted text output for display to the user.
 *
 * @param rawArgs - The raw argument string following `/mcp` (e.g., "servers", "tools tavily").
 * @param manager - The MCPManager instance managing server connections.
 * @param resolveAuth - Optional function to resolve an AuthManager for a given server name.
 * @returns Formatted text output describing the result of the command.
 */
export async function handleMCPCommand(rawArgs, manager, resolveAuth) {
    const { subcommand, args } = parseArgs(rawArgs);
    switch (subcommand) {
        case "servers":
            return handleServers(manager);
        case "tools":
            return handleTools(manager, args);
        case "status":
            return handleStatus(manager, args);
        case "connect":
            return handleConnect(manager, args);
        case "disconnect":
            return handleDisconnect(manager, args);
        case "auth":
            return handleAuth(manager, args, resolveAuth);
        case "refresh":
            return handleRefresh(manager, args);
        case "help":
            return handleHelp();
        default:
            return `Unknown subcommand: "${subcommand}". Run /mcp help for a list of available commands.`;
    }
}
//# sourceMappingURL=mcp-manage.js.map
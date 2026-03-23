/**
 * /mcp slash command handler.
 *
 * Parses the raw argument string from the skill command-dispatch and routes
 * to the appropriate subcommand handler. Returns formatted text output for
 * display to the user.
 *
 * @see SPEC.md section 8 for the slash command specification.
 */
import type { MCPManager } from "../manager/mcp-manager.js";
import type { AuthManager } from "../auth/auth-manager.js";
/**
 * Function that resolves an AuthManager instance for a given server name.
 *
 * Returns `undefined` if no AuthManager is configured for the server
 * (e.g., the server uses API key auth or no auth at all).
 */
export type AuthManagerResolver = (serverName: string) => AuthManager | undefined;
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
export declare function handleMCPCommand(rawArgs: string, manager: MCPManager, resolveAuth?: AuthManagerResolver): Promise<string>;
//# sourceMappingURL=mcp-manage.d.ts.map
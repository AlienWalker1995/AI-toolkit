/**
 * Core type definitions for the MCP client plugin.
 *
 * Includes JSON-RPC 2.0 message types, MCP-specific protocol types,
 * transport-level types, and the base error class.
 *
 * @see https://www.jsonrpc.org/specification for JSON-RPC 2.0
 * @see https://modelcontextprotocol.io/specification/2025-03-26 for MCP
 */
// ---------------------------------------------------------------------------
// Error Types
// ---------------------------------------------------------------------------
/**
 * Base error class for all MCP client errors.
 *
 * Extends the built-in Error with a numeric `code` field for JSON-RPC
 * error codes or application-specific error codes.
 */
export class MCPError extends Error {
    /** Numeric error code (JSON-RPC or application-specific). */
    code;
    /**
     * Create a new MCPError.
     *
     * @param message - Human-readable error description.
     * @param code - Numeric error code.
     */
    constructor(message, code) {
        super(message);
        this.name = "MCPError";
        this.code = code;
    }
}
//# sourceMappingURL=types.js.map
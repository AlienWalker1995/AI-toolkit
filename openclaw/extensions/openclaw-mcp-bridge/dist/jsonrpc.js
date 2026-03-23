/**
 * JSON-RPC 2.0 encoding, decoding, validation, and type guard utilities.
 *
 * Provides factory functions for constructing JSON-RPC messages, a parser
 * for incoming messages with validation, type guard predicates, and
 * standard JSON-RPC error code constants.
 *
 * @see https://www.jsonrpc.org/specification
 */
import { MCPError } from "./types.js";
// ---------------------------------------------------------------------------
// Standard JSON-RPC 2.0 Error Codes
// ---------------------------------------------------------------------------
/** Invalid JSON was received by the server. */
export const PARSE_ERROR = -32700;
/** The JSON sent is not a valid Request object. */
export const INVALID_REQUEST = -32600;
/** The method does not exist or is not available. */
export const METHOD_NOT_FOUND = -32601;
/** Invalid method parameter(s). */
export const INVALID_PARAMS = -32602;
/** Internal JSON-RPC error. */
export const INTERNAL_ERROR = -32603;
// ---------------------------------------------------------------------------
// Factory Functions
// ---------------------------------------------------------------------------
/**
 * Build a JSON-RPC 2.0 request object.
 *
 * @param method - The RPC method name.
 * @param params - Optional parameters for the method.
 * @param id - Request identifier (string or number).
 * @returns A fully formed JsonRpcRequest.
 */
export function createRequest(method, params, id) {
    const request = params !== undefined
        ? { jsonrpc: "2.0", id, method, params }
        : { jsonrpc: "2.0", id, method };
    return request;
}
/**
 * Build a JSON-RPC 2.0 notification (a request without an id).
 *
 * @param method - The RPC method name.
 * @param params - Optional parameters for the method.
 * @returns A fully formed JsonRpcNotification.
 */
export function createNotification(method, params) {
    const notification = params !== undefined
        ? { jsonrpc: "2.0", method, params }
        : { jsonrpc: "2.0", method };
    return notification;
}
/**
 * Build a JSON-RPC 2.0 success response.
 *
 * @param id - The request id this response corresponds to.
 * @param result - The result payload.
 * @returns A fully formed JsonRpcSuccessResponse.
 */
export function createResponse(id, result) {
    return { jsonrpc: "2.0", id, result };
}
/**
 * Build a JSON-RPC 2.0 error response.
 *
 * @param id - The request id this response corresponds to (null if unknown).
 * @param code - Numeric error code.
 * @param message - Human-readable error description.
 * @param data - Optional additional error data.
 * @returns A fully formed JsonRpcErrorResponse.
 */
export function createErrorResponse(id, code, message, data) {
    const error = data !== undefined
        ? { code, message, data }
        : { code, message };
    return { jsonrpc: "2.0", id, error };
}
// ---------------------------------------------------------------------------
// Type Guards
// ---------------------------------------------------------------------------
/**
 * Check whether an unknown value is a plain object (non-null, non-array).
 *
 * @param value - The value to check.
 * @returns True if value is a plain object.
 */
function isPlainObject(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
/**
 * Check whether a value is a valid JSON-RPC 2.0 version tag.
 *
 * @param value - The value to check.
 * @returns True if value is the string "2.0".
 */
function isJsonRpc20(value) {
    return value === "2.0";
}
/**
 * Type guard: checks whether a parsed message is a JSON-RPC 2.0 request.
 *
 * A request has `jsonrpc: "2.0"`, a `method` string, and an `id`.
 *
 * @param msg - The message to check.
 * @returns True if the message is a JsonRpcRequest.
 */
export function isRequest(msg) {
    if (!isPlainObject(msg))
        return false;
    return (isJsonRpc20(msg["jsonrpc"]) &&
        typeof msg["method"] === "string" &&
        "id" in msg &&
        (typeof msg["id"] === "string" || typeof msg["id"] === "number"));
}
/**
 * Type guard: checks whether a parsed message is a JSON-RPC 2.0 notification.
 *
 * A notification has `jsonrpc: "2.0"`, a `method` string, and no `id`.
 *
 * @param msg - The message to check.
 * @returns True if the message is a JsonRpcNotification.
 */
export function isNotification(msg) {
    if (!isPlainObject(msg))
        return false;
    return (isJsonRpc20(msg["jsonrpc"]) &&
        typeof msg["method"] === "string" &&
        !("id" in msg));
}
/**
 * Type guard: checks whether a parsed message is a JSON-RPC 2.0 success response.
 *
 * A success response has `jsonrpc: "2.0"`, an `id`, and a `result` field.
 *
 * @param msg - The message to check.
 * @returns True if the message is a JsonRpcSuccessResponse.
 */
function isSuccessResponse(msg) {
    if (!isPlainObject(msg))
        return false;
    return (isJsonRpc20(msg["jsonrpc"]) &&
        "id" in msg &&
        "result" in msg &&
        !("error" in msg));
}
/**
 * Type guard: checks whether a parsed message is a JSON-RPC 2.0 error response.
 *
 * An error response has `jsonrpc: "2.0"`, an `id`, and an `error` object
 * with numeric `code` and string `message`.
 *
 * @param msg - The message to check.
 * @returns True if the message is a JsonRpcErrorResponse.
 */
export function isError(msg) {
    if (!isPlainObject(msg))
        return false;
    if (!isJsonRpc20(msg["jsonrpc"]))
        return false;
    if (!("id" in msg))
        return false;
    if (!("error" in msg))
        return false;
    const err = msg["error"];
    if (!isPlainObject(err))
        return false;
    return typeof err["code"] === "number" && typeof err["message"] === "string";
}
/**
 * Type guard: checks whether a parsed message is a JSON-RPC 2.0 response
 * (either success or error).
 *
 * @param msg - The message to check.
 * @returns True if the message is a JsonRpcResponse.
 */
export function isResponse(msg) {
    return isSuccessResponse(msg) || isError(msg);
}
/**
 * Parse and validate an incoming JSON-RPC message string.
 *
 * Handles single requests, notifications, responses, error responses,
 * and batch arrays. Throws an MCPError on invalid JSON or unrecognizable
 * message structure.
 *
 * @param json - The raw JSON string to parse.
 * @returns A discriminated union describing the parsed message type.
 * @throws {MCPError} With PARSE_ERROR if the JSON is invalid.
 * @throws {MCPError} With INVALID_REQUEST if the message structure is unrecognizable.
 */
export function parseMessage(json) {
    let parsed;
    try {
        parsed = JSON.parse(json);
    }
    catch {
        throw new MCPError("Parse error: invalid JSON", PARSE_ERROR);
    }
    // Batch
    if (Array.isArray(parsed)) {
        if (parsed.length === 0) {
            throw new MCPError("Invalid request: batch array must not be empty", INVALID_REQUEST);
        }
        const messages = [];
        for (const item of parsed) {
            const single = classifySingleMessage(item);
            messages.push(single);
        }
        return { type: "batch", messages };
    }
    // Single message
    const message = classifySingleMessage(parsed);
    if (isRequest(message)) {
        return { type: "request", message };
    }
    if (isNotification(message)) {
        return { type: "notification", message };
    }
    // Must be a response (success or error)
    return { type: "response", message: message };
}
/**
 * Classify a single parsed JSON value as a JSON-RPC message.
 *
 * @param value - The parsed value to classify.
 * @returns The value cast to its appropriate JsonRpc message type.
 * @throws {MCPError} With INVALID_REQUEST if the value is not a valid JSON-RPC message.
 */
function classifySingleMessage(value) {
    if (isRequest(value))
        return value;
    if (isNotification(value))
        return value;
    if (isResponse(value))
        return value;
    throw new MCPError("Invalid request: message is not a valid JSON-RPC 2.0 request, notification, or response", INVALID_REQUEST);
}
// ---------------------------------------------------------------------------
// Batch Response Parsing
// ---------------------------------------------------------------------------
/**
 * Parse a JSON-RPC batch response array and index by id.
 *
 * Accepts the parsed body of a batch response (expected to be an array of
 * JSON-RPC response objects) and returns a Map keyed by each response's `id`.
 * Non-response entries (e.g., notifications included in the batch response)
 * are silently skipped. Responses with a `null` id are also skipped since
 * they cannot be matched back to a specific request.
 *
 * @param body - The parsed JSON body (should be an array of response objects).
 * @returns A Map from response id to JsonRpcResponse.
 * @throws {MCPError} With INVALID_REQUEST if the body is not an array.
 */
export function parseBatchResponse(body) {
    if (!Array.isArray(body)) {
        throw new MCPError("Invalid batch response: expected an array", INVALID_REQUEST);
    }
    const map = new Map();
    for (const item of body) {
        if (isResponse(item) && item.id !== null) {
            map.set(item.id, item);
        }
    }
    return map;
}
//# sourceMappingURL=jsonrpc.js.map
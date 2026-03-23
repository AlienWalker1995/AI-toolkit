/**
 * JSON-RPC 2.0 encoding, decoding, validation, and type guard utilities.
 *
 * Provides factory functions for constructing JSON-RPC messages, a parser
 * for incoming messages with validation, type guard predicates, and
 * standard JSON-RPC error code constants.
 *
 * @see https://www.jsonrpc.org/specification
 */
import type { JsonRpcRequest, JsonRpcResponse, JsonRpcSuccessResponse, JsonRpcErrorResponse, JsonRpcNotification, JsonRpcBatch } from "./types.js";
/** Invalid JSON was received by the server. */
export declare const PARSE_ERROR: -32700;
/** The JSON sent is not a valid Request object. */
export declare const INVALID_REQUEST: -32600;
/** The method does not exist or is not available. */
export declare const METHOD_NOT_FOUND: -32601;
/** Invalid method parameter(s). */
export declare const INVALID_PARAMS: -32602;
/** Internal JSON-RPC error. */
export declare const INTERNAL_ERROR: -32603;
/**
 * Build a JSON-RPC 2.0 request object.
 *
 * @param method - The RPC method name.
 * @param params - Optional parameters for the method.
 * @param id - Request identifier (string or number).
 * @returns A fully formed JsonRpcRequest.
 */
export declare function createRequest(method: string, params: Record<string, unknown> | unknown[] | undefined, id: string | number): JsonRpcRequest;
/**
 * Build a JSON-RPC 2.0 notification (a request without an id).
 *
 * @param method - The RPC method name.
 * @param params - Optional parameters for the method.
 * @returns A fully formed JsonRpcNotification.
 */
export declare function createNotification(method: string, params?: Record<string, unknown> | unknown[]): JsonRpcNotification;
/**
 * Build a JSON-RPC 2.0 success response.
 *
 * @param id - The request id this response corresponds to.
 * @param result - The result payload.
 * @returns A fully formed JsonRpcSuccessResponse.
 */
export declare function createResponse(id: string | number | null, result: unknown): JsonRpcSuccessResponse;
/**
 * Build a JSON-RPC 2.0 error response.
 *
 * @param id - The request id this response corresponds to (null if unknown).
 * @param code - Numeric error code.
 * @param message - Human-readable error description.
 * @param data - Optional additional error data.
 * @returns A fully formed JsonRpcErrorResponse.
 */
export declare function createErrorResponse(id: string | number | null, code: number, message: string, data?: unknown): JsonRpcErrorResponse;
/**
 * Type guard: checks whether a parsed message is a JSON-RPC 2.0 request.
 *
 * A request has `jsonrpc: "2.0"`, a `method` string, and an `id`.
 *
 * @param msg - The message to check.
 * @returns True if the message is a JsonRpcRequest.
 */
export declare function isRequest(msg: unknown): msg is JsonRpcRequest;
/**
 * Type guard: checks whether a parsed message is a JSON-RPC 2.0 notification.
 *
 * A notification has `jsonrpc: "2.0"`, a `method` string, and no `id`.
 *
 * @param msg - The message to check.
 * @returns True if the message is a JsonRpcNotification.
 */
export declare function isNotification(msg: unknown): msg is JsonRpcNotification;
/**
 * Type guard: checks whether a parsed message is a JSON-RPC 2.0 error response.
 *
 * An error response has `jsonrpc: "2.0"`, an `id`, and an `error` object
 * with numeric `code` and string `message`.
 *
 * @param msg - The message to check.
 * @returns True if the message is a JsonRpcErrorResponse.
 */
export declare function isError(msg: unknown): msg is JsonRpcErrorResponse;
/**
 * Type guard: checks whether a parsed message is a JSON-RPC 2.0 response
 * (either success or error).
 *
 * @param msg - The message to check.
 * @returns True if the message is a JsonRpcResponse.
 */
export declare function isResponse(msg: unknown): msg is JsonRpcResponse;
/** Result of parsing a JSON-RPC message string. */
export type ParsedMessage = {
    readonly type: "request";
    readonly message: JsonRpcRequest;
} | {
    readonly type: "notification";
    readonly message: JsonRpcNotification;
} | {
    readonly type: "response";
    readonly message: JsonRpcResponse;
} | {
    readonly type: "batch";
    readonly messages: JsonRpcBatch;
};
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
export declare function parseMessage(json: string): ParsedMessage;
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
export declare function parseBatchResponse(body: unknown): Map<string | number, JsonRpcResponse>;
//# sourceMappingURL=jsonrpc.d.ts.map
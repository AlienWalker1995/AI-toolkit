/**
 * Server-Sent Events (SSE) stream parser.
 *
 * Implements the SSE event-stream interpretation algorithm per the
 * WHATWG HTML specification:
 * https://html.spec.whatwg.org/multipage/server-sent-events.html#event-stream-interpretation
 *
 * Accepts a ReadableStream<Uint8Array> or AsyncIterable<Uint8Array> and yields
 * parsed SSEEvent objects as an async generator.
 *
 * @module
 */
import type { SSEEvent } from "../types.js";
/**
 * Stateful SSE parser that processes a byte stream and emits SSEEvent objects.
 *
 * The parser tracks the `retry` interval and `lastEventId` across events, as
 * required by the SSE specification. The `retry` value and `lastEventId` are
 * exposed as read-only properties for use by transport-level reconnection logic.
 */
export declare class SSEParser {
    /** The most recently received retry interval, in milliseconds. */
    private _retryMs;
    /**
     * The last event ID received. This is "sticky" -- it persists across
     * dispatched events and is only updated when a new `id:` field arrives.
     */
    private _lastEventId;
    private _eventType;
    private _dataBuffer;
    private _currentId;
    /** Leftover bytes from the previous chunk that did not end with a line break. */
    private _pending;
    /** The TextDecoder used to convert Uint8Array chunks to strings. */
    private readonly _decoder;
    /** The current retry interval in milliseconds, or `undefined` if none set. */
    get retryMs(): number | undefined;
    /** The last event ID received (sticky across events). */
    get lastEventId(): string;
    /**
     * Parse a complete SSE stream and yield events.
     *
     * @param input - A ReadableStream or AsyncIterable of raw bytes.
     * @yields Parsed SSEEvent objects.
     */
    parse(input: ReadableStream<Uint8Array> | AsyncIterable<Uint8Array>): AsyncGenerator<SSEEvent>;
    /**
     * Process a single line from the event stream.
     *
     * @returns An SSEEvent if an empty line triggers dispatch, otherwise null.
     */
    private _processLine;
    /**
     * Attempt to dispatch the currently accumulated event.
     *
     * Called when an empty line is encountered (event boundary) or at
     * end-of-stream. Resets the per-event accumulation state afterward.
     *
     * @returns The SSEEvent if there was data to dispatch, otherwise null.
     */
    private _dispatch;
    /**
     * Reset the per-event accumulation state.
     * Note: `_lastEventId` and `_retryMs` are intentionally NOT reset
     * (they are sticky across events per the SSE spec).
     */
    private _reset;
}
/**
 * Parse an SSE byte stream and yield SSEEvent objects.
 *
 * This is a convenience wrapper around {@link SSEParser} for callers that
 * do not need access to the parser's stateful properties (retryMs,
 * lastEventId).
 *
 * @param input - A ReadableStream or AsyncIterable of raw bytes.
 * @yields Parsed SSEEvent objects.
 *
 * @example
 * ```ts
 * const response = await fetch("https://example.com/events");
 * for await (const event of parseSSEStream(response.body!)) {
 *   console.log(event.event, event.data);
 * }
 * ```
 */
export declare function parseSSEStream(input: ReadableStream<Uint8Array> | AsyncIterable<Uint8Array>): AsyncGenerator<SSEEvent>;
//# sourceMappingURL=sse-parser.d.ts.map
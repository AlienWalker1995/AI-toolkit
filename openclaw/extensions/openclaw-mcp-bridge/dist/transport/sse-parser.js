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
// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
/**
 * Normalize an input that is either a `ReadableStream<Uint8Array>` or an
 * `AsyncIterable<Uint8Array>` into an `AsyncIterable<Uint8Array>`.
 *
 * ReadableStream has a `[Symbol.asyncIterator]` in modern runtimes, but we
 * also support obtaining a reader manually for environments where the
 * async-iterator protocol is not available on ReadableStream.
 */
function toAsyncIterable(input) {
    // If the input already supports the async-iterable protocol, use it directly.
    if (Symbol.asyncIterator in input) {
        return input;
    }
    // Otherwise, wrap the ReadableStream reader in an async generator.
    const stream = input;
    return {
        [Symbol.asyncIterator]() {
            const reader = stream.getReader();
            return {
                async next() {
                    const { done, value } = await reader.read();
                    if (done) {
                        return { done: true, value: undefined };
                    }
                    return { done: false, value };
                },
                async return() {
                    reader.releaseLock();
                    return { done: true, value: undefined };
                },
            };
        },
    };
}
// ---------------------------------------------------------------------------
// SSEParser — stateful parser with retry tracking
// ---------------------------------------------------------------------------
/**
 * Stateful SSE parser that processes a byte stream and emits SSEEvent objects.
 *
 * The parser tracks the `retry` interval and `lastEventId` across events, as
 * required by the SSE specification. The `retry` value and `lastEventId` are
 * exposed as read-only properties for use by transport-level reconnection logic.
 */
export class SSEParser {
    // -- Persistent state (survives event dispatch) --
    /** The most recently received retry interval, in milliseconds. */
    _retryMs;
    /**
     * The last event ID received. This is "sticky" -- it persists across
     * dispatched events and is only updated when a new `id:` field arrives.
     */
    _lastEventId = "";
    // -- Per-event accumulation state (reset on dispatch) --
    _eventType = "";
    _dataBuffer = [];
    _currentId;
    // -- Byte-level buffering for line splitting --
    /** Leftover bytes from the previous chunk that did not end with a line break. */
    _pending = "";
    /** The TextDecoder used to convert Uint8Array chunks to strings. */
    _decoder = new TextDecoder();
    // -------------------------------------------------------------------------
    // Public read-only accessors
    // -------------------------------------------------------------------------
    /** The current retry interval in milliseconds, or `undefined` if none set. */
    get retryMs() {
        return this._retryMs;
    }
    /** The last event ID received (sticky across events). */
    get lastEventId() {
        return this._lastEventId;
    }
    // -------------------------------------------------------------------------
    // Core parsing
    // -------------------------------------------------------------------------
    /**
     * Parse a complete SSE stream and yield events.
     *
     * @param input - A ReadableStream or AsyncIterable of raw bytes.
     * @yields Parsed SSEEvent objects.
     */
    async *parse(input) {
        const iterable = toAsyncIterable(input);
        for await (const chunk of iterable) {
            const text = this._decoder.decode(chunk, { stream: true });
            // Combine with any leftover from the previous chunk.
            const combined = this._pending + text;
            // Split on any of the three valid SSE line endings: \r\n, \r, \n.
            // We use a regex that matches each line ending variant in priority order
            // (longest match first for \r\n).
            const lines = combined.split(/\r\n|\r|\n/);
            // The last element may be an incomplete line — save it for the next chunk.
            this._pending = lines.pop();
            for (const line of lines) {
                const event = this._processLine(line);
                if (event !== null) {
                    yield event;
                }
            }
        }
        // Flush any remaining text from the decoder.
        const remaining = this._decoder.decode(new Uint8Array(), { stream: false });
        if (remaining.length > 0 || this._pending.length > 0) {
            const finalText = this._pending + remaining;
            this._pending = "";
            if (finalText.length > 0) {
                // Process the final line (which lacks a trailing newline).
                const event = this._processLine(finalText);
                if (event !== null) {
                    yield event;
                }
                // Per the spec, an end-of-stream also triggers dispatch if there is
                // accumulated data.
                const eof = this._dispatch();
                if (eof !== null) {
                    yield eof;
                }
            }
        }
        else {
            // End of stream -- dispatch any accumulated event.
            const eof = this._dispatch();
            if (eof !== null) {
                yield eof;
            }
        }
    }
    // -------------------------------------------------------------------------
    // Line processing (per the SSE interpretation algorithm)
    // -------------------------------------------------------------------------
    /**
     * Process a single line from the event stream.
     *
     * @returns An SSEEvent if an empty line triggers dispatch, otherwise null.
     */
    _processLine(line) {
        // Empty line → dispatch the current event.
        if (line === "") {
            return this._dispatch();
        }
        // Lines starting with ':' are comments — ignore.
        if (line.startsWith(":")) {
            return null;
        }
        // Split on the first ':' to get field name and value.
        const colonIndex = line.indexOf(":");
        let field;
        let value;
        if (colonIndex === -1) {
            // No colon: the entire line is the field name, value is empty string.
            field = line;
            value = "";
        }
        else {
            field = line.slice(0, colonIndex);
            // Per spec: if the character immediately after the colon is a space,
            // remove it (one space only).
            value = line.slice(colonIndex + 1);
            if (value.startsWith(" ")) {
                value = value.slice(1);
            }
        }
        switch (field) {
            case "event":
                this._eventType = value;
                break;
            case "data":
                this._dataBuffer.push(value);
                break;
            case "id":
                // Per the spec, if the field value contains U+0000 NULL, ignore the
                // entire field (do not update last-event-id).
                if (!value.includes("\0")) {
                    this._currentId = value;
                    this._lastEventId = value;
                }
                break;
            case "retry":
                // The value must consist of ASCII digits only.
                if (/^\d+$/.test(value)) {
                    this._retryMs = parseInt(value, 10);
                }
                break;
            default:
                // Unknown field names are ignored per the spec.
                break;
        }
        return null;
    }
    // -------------------------------------------------------------------------
    // Event dispatch
    // -------------------------------------------------------------------------
    /**
     * Attempt to dispatch the currently accumulated event.
     *
     * Called when an empty line is encountered (event boundary) or at
     * end-of-stream. Resets the per-event accumulation state afterward.
     *
     * @returns The SSEEvent if there was data to dispatch, otherwise null.
     */
    _dispatch() {
        // Per the spec: if the data buffer is empty, the event is discarded.
        if (this._dataBuffer.length === 0) {
            this._reset();
            return null;
        }
        // Concatenate accumulated data lines with newline separators.
        const data = this._dataBuffer.join("\n");
        // Default event type is "message" when no `event:` field was provided.
        const eventType = this._eventType || "message";
        const event = {
            event: eventType,
            data,
            ...(this._currentId !== undefined ? { id: this._currentId } : {}),
            ...(this._retryMs !== undefined ? { retry: this._retryMs } : {}),
        };
        this._reset();
        return event;
    }
    /**
     * Reset the per-event accumulation state.
     * Note: `_lastEventId` and `_retryMs` are intentionally NOT reset
     * (they are sticky across events per the SSE spec).
     */
    _reset() {
        this._eventType = "";
        this._dataBuffer = [];
        this._currentId = undefined;
    }
}
// ---------------------------------------------------------------------------
// Convenience async generator function
// ---------------------------------------------------------------------------
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
export async function* parseSSEStream(input) {
    const parser = new SSEParser();
    yield* parser.parse(input);
}
//# sourceMappingURL=sse-parser.js.map
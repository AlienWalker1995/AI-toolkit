/**
 * stdio transport for MCP servers running as local subprocesses.
 *
 * Spawns a child process and communicates via newline-delimited JSON on
 * stdin/stdout. Stderr output is captured and exposed via a logging callback.
 * Supports auto-restart on unexpected process exit with configurable retry limits.
 *
 * @see https://modelcontextprotocol.io/specification/2025-03-26/basic/transports
 */
import type { JsonRpcRequest, JsonRpcNotification, JsonRpcResponse, JsonRpcMessage } from "../types.js";
/** Configuration for the stdio transport subprocess. */
export interface StdioTransportConfig {
    /** The command to execute (e.g., "npx", "node", "python"). */
    readonly command: string;
    /** Arguments to pass to the command. */
    readonly args: string[];
    /** Environment variables to set for the subprocess. */
    readonly env: Record<string, string>;
    /** Maximum number of automatic restart attempts on unexpected exit (default: 3). */
    readonly maxRestartAttempts?: number;
    /** Timeout in milliseconds to wait for graceful shutdown before SIGKILL (default: 5000). */
    readonly shutdownTimeoutMs?: number;
}
/**
 * MCP transport over stdio (subprocess stdin/stdout).
 *
 * Spawns a child process and communicates using newline-delimited JSON-RPC 2.0
 * messages. Each JSON-RPC message is serialized as a single line (no embedded
 * newlines) terminated by `\n`.
 */
export declare class StdioTransport {
    private readonly config;
    private readonly maxRestartAttempts;
    private readonly shutdownTimeoutMs;
    private process;
    private stdoutReader;
    private stderrReader;
    private status;
    private restartCount;
    private stoppingIntentionally;
    private messageHandler;
    private errorHandler;
    private stderrHandler;
    private readonly pendingRequests;
    /**
     * Create a new StdioTransport.
     *
     * @param config - Subprocess configuration including command, args, and env.
     */
    constructor(config: StdioTransportConfig);
    /**
     * Spawn the subprocess and begin reading from stdout/stderr.
     *
     * @returns Resolves when the process has been spawned and streams are connected.
     * @throws {MCPError} If the process fails to spawn.
     */
    start(): Promise<void>;
    /**
     * Send a JSON-RPC message by writing newline-delimited JSON to the subprocess stdin.
     *
     * The message is serialized as a single-line JSON string followed by `\n`.
     *
     * @param message - The JSON-RPC request, notification, or response to send.
     * @throws {MCPError} If the subprocess is not running or stdin is not writable.
     */
    send(message: JsonRpcRequest | JsonRpcNotification | JsonRpcResponse): Promise<void>;
    /**
     * Send a JSON-RPC request and wait for the matching response by id.
     *
     * @param request - The JSON-RPC request to send.
     * @returns The matching JSON-RPC response.
     * @throws {MCPError} If the subprocess exits before a response is received.
     */
    sendAndReceive(request: JsonRpcRequest): Promise<JsonRpcResponse>;
    /**
     * Register a handler for incoming JSON-RPC messages (requests, notifications, responses).
     *
     * Only one handler can be registered at a time; subsequent calls replace the previous handler.
     *
     * @param handler - Callback invoked for each parsed incoming message.
     */
    onMessage(handler: (msg: JsonRpcMessage) => void): void;
    /**
     * Register a handler for transport-level errors.
     *
     * Only one handler can be registered at a time; subsequent calls replace the previous handler.
     *
     * @param handler - Callback invoked when an error occurs.
     */
    onError(handler: (error: Error) => void): void;
    /**
     * Register a handler for stderr output lines from the subprocess.
     *
     * Only one handler can be registered at a time; subsequent calls replace the previous handler.
     *
     * @param handler - Callback invoked for each line written to stderr.
     */
    onStderr(handler: (line: string) => void): void;
    /**
     * Stop the subprocess gracefully.
     *
     * Closes stdin to signal the subprocess to exit, then waits for the process
     * to terminate. If the process does not exit within the configured shutdown
     * timeout, it is killed with SIGKILL.
     *
     * @returns Resolves when the process has fully exited.
     */
    stop(): Promise<void>;
    /**
     * Check whether the subprocess is currently running.
     *
     * @returns True if the subprocess is alive and connected.
     */
    isRunning(): boolean;
    /**
     * Spawn the subprocess and wire up event listeners for stdout, stderr, and process exit.
     */
    private spawnProcess;
    /**
     * Parse a single line from stdout as a JSON-RPC message.
     *
     * Invalid JSON lines are logged as warnings and skipped.
     *
     * @param line - A single line of text from the subprocess stdout.
     */
    private handleStdoutLine;
    /**
     * Dispatch a single parsed JSON-RPC message to pending request handlers
     * or the general message handler.
     *
     * @param msg - The parsed JSON-RPC message.
     */
    private dispatchMessage;
    /**
     * Handle an unexpected process exit by attempting an auto-restart.
     *
     * If the restart count has exceeded the maximum, the transport remains in the
     * error state and no further restarts are attempted.
     */
    private handleUnexpectedExit;
    /**
     * Emit an error to the registered error handler, if any.
     *
     * @param error - The error to emit.
     */
    private emitError;
    /**
     * Reject all pending sendAndReceive promises with the given error.
     *
     * @param error - The error to reject pending requests with.
     */
    private rejectAllPending;
    /**
     * Close and clean up readline interfaces for stdout and stderr.
     */
    private cleanupReaders;
}
//# sourceMappingURL=stdio.d.ts.map
/**
 * stdio transport for MCP servers running as local subprocesses.
 *
 * Spawns a child process and communicates via newline-delimited JSON on
 * stdin/stdout. Stderr output is captured and exposed via a logging callback.
 * Supports auto-restart on unexpected process exit with configurable retry limits.
 *
 * @see https://modelcontextprotocol.io/specification/2025-03-26/basic/transports
 */
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { MCPError } from "../types.js";
import { parseMessage, isResponse, INTERNAL_ERROR } from "../jsonrpc.js";
// ---------------------------------------------------------------------------
// Internal Constants
// ---------------------------------------------------------------------------
/** Default maximum restart attempts. */
const DEFAULT_MAX_RESTART_ATTEMPTS = 3;
/** Default graceful shutdown timeout in milliseconds. */
const DEFAULT_SHUTDOWN_TIMEOUT_MS = 5000;
// ---------------------------------------------------------------------------
// StdioTransport
// ---------------------------------------------------------------------------
/**
 * MCP transport over stdio (subprocess stdin/stdout).
 *
 * Spawns a child process and communicates using newline-delimited JSON-RPC 2.0
 * messages. Each JSON-RPC message is serialized as a single line (no embedded
 * newlines) terminated by `\n`.
 */
export class StdioTransport {
    config;
    maxRestartAttempts;
    shutdownTimeoutMs;
    process = null;
    stdoutReader = null;
    stderrReader = null;
    status = "disconnected";
    restartCount = 0;
    stoppingIntentionally = false;
    messageHandler = null;
    errorHandler = null;
    stderrHandler = null;
    pendingRequests = new Map();
    /**
     * Create a new StdioTransport.
     *
     * @param config - Subprocess configuration including command, args, and env.
     */
    constructor(config) {
        this.config = config;
        this.maxRestartAttempts =
            config.maxRestartAttempts ?? DEFAULT_MAX_RESTART_ATTEMPTS;
        this.shutdownTimeoutMs =
            config.shutdownTimeoutMs ?? DEFAULT_SHUTDOWN_TIMEOUT_MS;
    }
    /**
     * Spawn the subprocess and begin reading from stdout/stderr.
     *
     * @returns Resolves when the process has been spawned and streams are connected.
     * @throws {MCPError} If the process fails to spawn.
     */
    async start() {
        if (this.process !== null && this.status === "connected") {
            return;
        }
        this.stoppingIntentionally = false;
        this.status = "connecting";
        this.spawnProcess();
    }
    /**
     * Send a JSON-RPC message by writing newline-delimited JSON to the subprocess stdin.
     *
     * The message is serialized as a single-line JSON string followed by `\n`.
     *
     * @param message - The JSON-RPC request, notification, or response to send.
     * @throws {MCPError} If the subprocess is not running or stdin is not writable.
     */
    async send(message) {
        if (this.process === null || this.process.stdin === null) {
            throw new MCPError("Cannot send message: subprocess is not running", INTERNAL_ERROR);
        }
        const line = JSON.stringify(message);
        return new Promise((resolve, reject) => {
            this.process.stdin.write(line + "\n", "utf-8", (err) => {
                if (err) {
                    reject(new MCPError(`Failed to write to subprocess stdin: ${err.message}`, INTERNAL_ERROR));
                }
                else {
                    resolve();
                }
            });
        });
    }
    /**
     * Send a JSON-RPC request and wait for the matching response by id.
     *
     * @param request - The JSON-RPC request to send.
     * @returns The matching JSON-RPC response.
     * @throws {MCPError} If the subprocess exits before a response is received.
     */
    async sendAndReceive(request) {
        const responsePromise = new Promise((resolve, reject) => {
            this.pendingRequests.set(request.id, { resolve, reject });
        });
        try {
            await this.send(request);
        }
        catch (error) {
            this.pendingRequests.delete(request.id);
            throw error;
        }
        return responsePromise;
    }
    /**
     * Register a handler for incoming JSON-RPC messages (requests, notifications, responses).
     *
     * Only one handler can be registered at a time; subsequent calls replace the previous handler.
     *
     * @param handler - Callback invoked for each parsed incoming message.
     */
    onMessage(handler) {
        this.messageHandler = handler;
    }
    /**
     * Register a handler for transport-level errors.
     *
     * Only one handler can be registered at a time; subsequent calls replace the previous handler.
     *
     * @param handler - Callback invoked when an error occurs.
     */
    onError(handler) {
        this.errorHandler = handler;
    }
    /**
     * Register a handler for stderr output lines from the subprocess.
     *
     * Only one handler can be registered at a time; subsequent calls replace the previous handler.
     *
     * @param handler - Callback invoked for each line written to stderr.
     */
    onStderr(handler) {
        this.stderrHandler = handler;
    }
    /**
     * Stop the subprocess gracefully.
     *
     * Closes stdin to signal the subprocess to exit, then waits for the process
     * to terminate. If the process does not exit within the configured shutdown
     * timeout, it is killed with SIGKILL.
     *
     * @returns Resolves when the process has fully exited.
     */
    async stop() {
        this.stoppingIntentionally = true;
        if (this.process === null) {
            this.status = "disconnected";
            return;
        }
        const proc = this.process;
        // Reject all pending requests
        this.rejectAllPending(new MCPError("Transport is shutting down", INTERNAL_ERROR));
        // Close readline interfaces
        this.cleanupReaders();
        // Close stdin to signal the subprocess
        if (proc.stdin !== null && !proc.stdin.destroyed) {
            proc.stdin.end();
        }
        // Wait for graceful exit or force kill after timeout
        await new Promise((resolve) => {
            let resolved = false;
            let killTimer = null;
            const finish = () => {
                if (resolved)
                    return;
                resolved = true;
                if (killTimer !== null) {
                    clearTimeout(killTimer);
                }
                this.process = null;
                this.status = "disconnected";
                resolve();
            };
            // If the process is already dead, finish immediately
            if (proc.exitCode !== null || proc.killed) {
                finish();
                return;
            }
            proc.once("exit", finish);
            // Send SIGTERM
            proc.kill("SIGTERM");
            // If still alive after timeout, send SIGKILL
            killTimer = setTimeout(() => {
                if (!resolved && proc.exitCode === null && !proc.killed) {
                    proc.kill("SIGKILL");
                }
            }, this.shutdownTimeoutMs);
        });
    }
    /**
     * Check whether the subprocess is currently running.
     *
     * @returns True if the subprocess is alive and connected.
     */
    isRunning() {
        return (this.process !== null &&
            this.process.exitCode === null &&
            !this.process.killed &&
            this.status === "connected");
    }
    // ---------------------------------------------------------------------------
    // Private Methods
    // ---------------------------------------------------------------------------
    /**
     * Spawn the subprocess and wire up event listeners for stdout, stderr, and process exit.
     */
    spawnProcess() {
        const mergedEnv = {
            ...process.env,
            ...this.config.env,
        };
        const child = spawn(this.config.command, this.config.args, {
            stdio: ["pipe", "pipe", "pipe"],
            env: mergedEnv,
        });
        this.process = child;
        // Handle spawn errors (e.g., command not found)
        child.on("error", (err) => {
            this.status = "error";
            this.emitError(new MCPError(`Failed to spawn subprocess "${this.config.command}": ${err.message}`, INTERNAL_ERROR));
            this.handleUnexpectedExit();
        });
        // Wire up stdout for JSON-RPC messages
        if (child.stdout !== null) {
            this.stdoutReader = createInterface({ input: child.stdout });
            this.stdoutReader.on("line", (line) => {
                this.handleStdoutLine(line);
            });
        }
        // Wire up stderr for logging
        if (child.stderr !== null) {
            this.stderrReader = createInterface({ input: child.stderr });
            this.stderrReader.on("line", (line) => {
                if (this.stderrHandler !== null) {
                    this.stderrHandler(line);
                }
            });
        }
        // Handle process exit
        child.on("exit", (code, signal) => {
            if (this.stoppingIntentionally) {
                return;
            }
            this.status = "error";
            this.emitError(new MCPError(`Subprocess exited unexpectedly (code=${String(code)}, signal=${String(signal)})`, INTERNAL_ERROR));
            this.rejectAllPending(new MCPError("Subprocess exited unexpectedly", INTERNAL_ERROR));
            this.cleanupReaders();
            this.process = null;
            this.handleUnexpectedExit();
        });
        this.status = "connected";
    }
    /**
     * Parse a single line from stdout as a JSON-RPC message.
     *
     * Invalid JSON lines are logged as warnings and skipped.
     *
     * @param line - A single line of text from the subprocess stdout.
     */
    handleStdoutLine(line) {
        const trimmed = line.trim();
        if (trimmed.length === 0) {
            return;
        }
        let parsed;
        try {
            parsed = parseMessage(trimmed);
        }
        catch {
            this.emitError(new MCPError(`Invalid JSON-RPC message from subprocess: ${trimmed.substring(0, 200)}`, INTERNAL_ERROR));
            return;
        }
        if (parsed.type === "batch") {
            for (const msg of parsed.messages) {
                this.dispatchMessage(msg);
            }
        }
        else {
            this.dispatchMessage(parsed.message);
        }
    }
    /**
     * Dispatch a single parsed JSON-RPC message to pending request handlers
     * or the general message handler.
     *
     * @param msg - The parsed JSON-RPC message.
     */
    dispatchMessage(msg) {
        // If it is a response, check for a pending request
        if (isResponse(msg)) {
            const pending = this.pendingRequests.get(msg.id);
            if (pending !== undefined) {
                this.pendingRequests.delete(msg.id);
                pending.resolve(msg);
                return;
            }
        }
        // Otherwise delegate to the general message handler
        if (this.messageHandler !== null) {
            this.messageHandler(msg);
        }
    }
    /**
     * Handle an unexpected process exit by attempting an auto-restart.
     *
     * If the restart count has exceeded the maximum, the transport remains in the
     * error state and no further restarts are attempted.
     */
    handleUnexpectedExit() {
        if (this.stoppingIntentionally) {
            return;
        }
        if (this.restartCount >= this.maxRestartAttempts) {
            this.emitError(new MCPError(`Subprocess failed after ${String(this.maxRestartAttempts)} restart attempts; giving up`, INTERNAL_ERROR));
            this.status = "error";
            return;
        }
        this.restartCount += 1;
        this.status = "connecting";
        this.spawnProcess();
    }
    /**
     * Emit an error to the registered error handler, if any.
     *
     * @param error - The error to emit.
     */
    emitError(error) {
        if (this.errorHandler !== null) {
            this.errorHandler(error);
        }
    }
    /**
     * Reject all pending sendAndReceive promises with the given error.
     *
     * @param error - The error to reject pending requests with.
     */
    rejectAllPending(error) {
        for (const [id, pending] of this.pendingRequests) {
            pending.reject(error);
            this.pendingRequests.delete(id);
        }
    }
    /**
     * Close and clean up readline interfaces for stdout and stderr.
     */
    cleanupReaders() {
        if (this.stdoutReader !== null) {
            this.stdoutReader.close();
            this.stdoutReader = null;
        }
        if (this.stderrReader !== null) {
            this.stderrReader.close();
            this.stderrReader = null;
        }
    }
}
//# sourceMappingURL=stdio.js.map
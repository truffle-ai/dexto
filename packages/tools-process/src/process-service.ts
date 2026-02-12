/**
 * Process Service
 *
 * Secure command execution and process management for Dexto internal tools
 */

import { spawn, ChildProcess } from 'node:child_process';
import * as crypto from 'node:crypto';
import * as path from 'node:path';
import {
    ProcessConfig,
    ExecuteOptions,
    ProcessResult,
    ProcessHandle,
    ProcessOutput,
    ProcessInfo,
    OutputBuffer,
} from './types.js';
import { CommandValidator } from './command-validator.js';
import { ProcessError } from './errors.js';
import type { IDextoLogger } from '@dexto/core';
import { DextoLogComponent } from '@dexto/core';

const DEFAULT_TIMEOUT = 120000; // 2 minutes

/**
 * Background process tracking
 */
interface BackgroundProcess {
    processId: string;
    command: string;
    child: ChildProcess;
    startedAt: Date;
    completedAt?: Date | undefined;
    status: 'running' | 'completed' | 'failed';
    exitCode?: number | undefined;
    outputBuffer: OutputBuffer;
    description?: string | undefined;
}

/**
 * ProcessService - Handles command execution and process management
 *
 * This service receives fully-validated configuration from the Process Tools Factory.
 * All defaults have been applied by the factory's schema, so the service trusts the config
 * and uses it as-is without any fallback logic.
 *
 * TODO: Add tests for this class
 */
export class ProcessService {
    private config: ProcessConfig;
    private commandValidator: CommandValidator;
    private initialized: boolean = false;
    private initPromise: Promise<void> | null = null;
    private backgroundProcesses: Map<string, BackgroundProcess> = new Map();
    private logger: IDextoLogger;

    /**
     * Create a new ProcessService with validated configuration.
     *
     * @param config - Fully-validated configuration from the factory schema.
     *                 All required fields have values, defaults already applied.
     * @param logger - Logger instance for this service
     */
    constructor(config: ProcessConfig, logger: IDextoLogger) {
        // Config is already fully validated with defaults applied - just use it
        this.config = config;

        this.logger = logger.createChild(DextoLogComponent.PROCESS);
        this.commandValidator = new CommandValidator(this.config, this.logger);
    }

    /**
     * Initialize the service.
     * Safe to call multiple times - subsequent calls return the same promise.
     */
    initialize(): Promise<void> {
        if (this.initPromise) {
            return this.initPromise;
        }

        this.initPromise = this.doInitialize();
        return this.initPromise;
    }

    /**
     * Internal initialization logic.
     */
    private async doInitialize(): Promise<void> {
        if (this.initialized) {
            this.logger.debug('ProcessService already initialized');
            return;
        }

        // Clean up any stale processes on startup
        this.backgroundProcesses.clear();

        this.initialized = true;
        this.logger.info('ProcessService initialized successfully');
    }

    /**
     * Ensure the service is initialized before use.
     * Tools should call this at the start of their execute methods.
     * Safe to call multiple times - will await the same initialization promise.
     */
    async ensureInitialized(): Promise<void> {
        if (this.initialized) {
            return;
        }
        await this.initialize();
    }

    /**
     * Execute a command
     */
    async executeCommand(
        command: string,
        options: ExecuteOptions = {}
    ): Promise<ProcessResult | ProcessHandle> {
        await this.ensureInitialized();

        // Validate command
        const validation = this.commandValidator.validateCommand(command);
        if (!validation.isValid || !validation.normalizedCommand) {
            throw ProcessError.invalidCommand(command, validation.error || 'Unknown error');
        }

        const normalizedCommand = validation.normalizedCommand;

        // Note: Command-level approval removed - approval is now handled at the tool level
        // in ToolManager with pattern-based approval for bash commands.
        // CommandValidator still validates for dangerous patterns (blocks truly dangerous commands)
        // but no longer triggers a second approval prompt.

        // Handle timeout - clamp to valid range to prevent negative/NaN/invalid values
        const rawTimeout =
            options.timeout !== undefined && Number.isFinite(options.timeout)
                ? options.timeout
                : DEFAULT_TIMEOUT;
        const timeout = Math.max(1, Math.min(rawTimeout, this.config.maxTimeout));

        // Setup working directory
        const cwd: string = this.resolveSafeCwd(options.cwd);

        // Setup environment - filter out undefined values
        const env: Record<string, string> = {};
        for (const [key, value] of Object.entries({
            ...process.env,
            ...this.config.environment,
            ...options.env,
        })) {
            if (value !== undefined) {
                env[key] = value;
            }
        }

        // If running in background, return the process handle directly
        if (options.runInBackground) {
            return await this.executeInBackground(normalizedCommand, options);
        }

        // Execute command in foreground
        return await this.executeForeground(normalizedCommand, {
            cwd,
            timeout,
            env,
            ...(options.description !== undefined && { description: options.description }),
            ...(options.abortSignal !== undefined && { abortSignal: options.abortSignal }),
        });
    }

    private static readonly SIGKILL_TIMEOUT_MS = 200;

    /**
     * Kill a process tree (process group on Unix, taskkill on Windows)
     */
    private async killProcessTree(pid: number, child: ChildProcess): Promise<void> {
        if (process.platform === 'win32') {
            // Windows: use taskkill with /t flag to kill process tree
            await new Promise<void>((resolve) => {
                const killer = spawn('taskkill', ['/pid', String(pid), '/f', '/t'], {
                    stdio: 'ignore',
                });
                killer.once('exit', () => resolve());
                killer.once('error', () => resolve());
            });
        } else {
            // Unix: kill process group using negative PID
            try {
                process.kill(-pid, 'SIGTERM');
                await new Promise((res) => setTimeout(res, ProcessService.SIGKILL_TIMEOUT_MS));
                if (child.exitCode === null) {
                    process.kill(-pid, 'SIGKILL');
                }
            } catch {
                // Fallback to killing just the process if group kill fails
                child.kill('SIGTERM');
                await new Promise((res) => setTimeout(res, ProcessService.SIGKILL_TIMEOUT_MS));
                if (child.exitCode === null) {
                    child.kill('SIGKILL');
                }
            }
        }
    }

    /**
     * Execute command in foreground with timeout and abort support
     */
    private executeForeground(
        command: string,
        options: {
            cwd: string;
            timeout: number;
            env: Record<string, string>;
            description?: string;
            abortSignal?: AbortSignal;
        }
    ): Promise<ProcessResult> {
        return new Promise((resolve, reject) => {
            const startTime = Date.now();
            let stdout = '';
            let stderr = '';
            let stdoutBytes = 0;
            let stderrBytes = 0;
            let outputTruncated = false;
            let killed = false;
            let aborted = false;
            let closed = false;
            const maxBuffer = this.config.maxOutputBuffer;

            // Check if already aborted before starting
            if (options.abortSignal?.aborted) {
                this.logger.debug(`Command cancelled before execution: ${command}`);
                resolve({
                    stdout: '',
                    stderr: '(Command was cancelled)',
                    exitCode: 130, // Standard exit code for SIGINT
                    duration: 0,
                });
                return;
            }

            this.logger.debug(`Executing command: ${command}`);

            // Spawn process with shell and detached for process group support (Unix)
            const child = spawn(command, {
                cwd: options.cwd,
                env: options.env,
                shell: true,
                detached: process.platform !== 'win32', // Create process group on Unix
            });

            // Setup timeout
            const timeoutHandle = setTimeout(() => {
                killed = true;
                if (child.pid) {
                    void this.killProcessTree(child.pid, child);
                } else {
                    child.kill('SIGTERM');
                }
            }, options.timeout);

            // Setup abort handler
            const abortHandler = () => {
                if (closed) return;
                aborted = true;
                this.logger.debug(`Command cancelled by user: ${command}`);
                clearTimeout(timeoutHandle);
                if (child.pid) {
                    void this.killProcessTree(child.pid, child);
                } else {
                    child.kill('SIGTERM');
                }
            };

            options.abortSignal?.addEventListener('abort', abortHandler, { once: true });

            // Collect stdout with buffer limit
            child.stdout?.on('data', (data) => {
                if (outputTruncated) return; // Ignore further data after truncation

                const chunk = data.toString();
                const chunkBytes = Buffer.byteLength(chunk, 'utf8');

                if (stdoutBytes + stderrBytes + chunkBytes <= maxBuffer) {
                    stdout += chunk;
                    stdoutBytes += chunkBytes;
                } else {
                    // Add remaining bytes up to limit, then truncate
                    const remaining = maxBuffer - stdoutBytes - stderrBytes;
                    if (remaining > 0) {
                        stdout += chunk.slice(0, remaining);
                        stdoutBytes += remaining;
                    }
                    stdout += '\n...[truncated]';
                    outputTruncated = true;
                    this.logger.warn(`Output buffer full for command: ${command}`);
                }
            });

            // Collect stderr with buffer limit
            child.stderr?.on('data', (data) => {
                if (outputTruncated) return; // Ignore further data after truncation

                const chunk = data.toString();
                const chunkBytes = Buffer.byteLength(chunk, 'utf8');

                if (stdoutBytes + stderrBytes + chunkBytes <= maxBuffer) {
                    stderr += chunk;
                    stderrBytes += chunkBytes;
                } else {
                    // Add remaining bytes up to limit, then truncate
                    const remaining = maxBuffer - stdoutBytes - stderrBytes;
                    if (remaining > 0) {
                        stderr += chunk.slice(0, remaining);
                        stderrBytes += remaining;
                    }
                    stderr += '\n...[truncated]';
                    outputTruncated = true;
                    this.logger.warn(`Output buffer full for command: ${command}`);
                }
            });

            // Handle completion
            child.on('close', (code, signal) => {
                closed = true;
                clearTimeout(timeoutHandle);
                options.abortSignal?.removeEventListener('abort', abortHandler);
                const duration = Date.now() - startTime;

                // Handle abort - return result instead of rejecting
                if (aborted) {
                    stdout += '\n\n(Command was cancelled)';
                    this.logger.debug(`Command cancelled after ${duration}ms: ${command}`);
                    resolve({
                        stdout,
                        stderr,
                        exitCode: 130, // Standard exit code for SIGINT
                        duration,
                    });
                    return;
                }

                if (killed) {
                    reject(ProcessError.timeout(command, options.timeout));
                    return;
                }

                let exitCode = typeof code === 'number' ? code : 1;
                if (code === null) {
                    stderr += `\nProcess terminated by signal ${signal ?? 'UNKNOWN'}`;
                }

                this.logger.debug(
                    `Command completed with exit code ${exitCode} in ${duration}ms: ${command}`
                );

                resolve({
                    stdout,
                    stderr,
                    exitCode,
                    duration,
                });
            });

            // Handle errors
            child.on('error', (error) => {
                clearTimeout(timeoutHandle);
                options.abortSignal?.removeEventListener('abort', abortHandler);

                // Check for specific error types
                if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
                    reject(ProcessError.commandNotFound(command));
                } else if ((error as NodeJS.ErrnoException).code === 'EACCES') {
                    reject(ProcessError.permissionDenied(command));
                } else {
                    reject(ProcessError.executionFailed(command, error.message));
                }
            });
        });
    }

    /**
     * Execute command in background
     */
    private async executeInBackground(
        command: string,
        options: ExecuteOptions
    ): Promise<ProcessHandle> {
        // Check concurrent process limit
        const runningCount = Array.from(this.backgroundProcesses.values()).filter(
            (p) => p.status === 'running'
        ).length;

        if (runningCount >= this.config.maxConcurrentProcesses) {
            throw ProcessError.tooManyProcesses(runningCount, this.config.maxConcurrentProcesses);
        }

        // Generate unique process ID
        const processId = crypto.randomBytes(4).toString('hex');

        // Setup working directory
        const cwd: string = this.resolveSafeCwd(options.cwd);

        // Setup environment - filter out undefined values
        const env: Record<string, string> = {};
        for (const [key, value] of Object.entries({
            ...process.env,
            ...this.config.environment,
            ...options.env,
        })) {
            if (value !== undefined) {
                env[key] = value;
            }
        }

        this.logger.debug(`Starting background process ${processId}: ${command}`);

        // Spawn process
        const child = spawn(command, {
            cwd,
            env,
            shell: true,
            detached: false,
        });

        // Create output buffer
        const outputBuffer: OutputBuffer = {
            stdout: [],
            stderr: [],
            complete: false,
            lastRead: Date.now(),
            bytesUsed: 0,
            truncated: false,
        };

        // Track background process
        const bgProcess: BackgroundProcess = {
            processId,
            command,
            child,
            startedAt: new Date(),
            status: 'running',
            outputBuffer,
            description: options.description,
        };

        this.backgroundProcesses.set(processId, bgProcess);

        // Enforce background timeout
        const bgTimeout = Math.max(
            1,
            Math.min(options.timeout || DEFAULT_TIMEOUT, this.config.maxTimeout)
        );
        let killEscalationTimer: ReturnType<typeof setTimeout> | null = null;
        const killTimer = setTimeout(() => {
            if (bgProcess.status === 'running') {
                this.logger.warn(
                    `Background process ${processId} timed out after ${bgTimeout}ms, sending SIGTERM`
                );
                child.kill('SIGTERM');
                // Escalate to SIGKILL if process doesn't terminate within 5s
                killEscalationTimer = setTimeout(() => {
                    if (bgProcess.status === 'running') {
                        this.logger.warn(
                            `Background process ${processId} did not respond to SIGTERM, sending SIGKILL`
                        );
                        child.kill('SIGKILL');
                    }
                }, 5000);
            }
        }, bgTimeout);

        // bytesUsed is kept on outputBuffer for correct accounting across reads

        // Setup output collection with buffer limit
        child.stdout?.on('data', (data) => {
            const chunk = data.toString();
            const chunkBytes = Buffer.byteLength(chunk, 'utf8');

            if (outputBuffer.bytesUsed + chunkBytes <= this.config.maxOutputBuffer) {
                outputBuffer.stdout.push(chunk);
                outputBuffer.bytesUsed += chunkBytes;
            } else {
                if (!outputBuffer.truncated) {
                    outputBuffer.truncated = true;
                    this.logger.warn(`Output buffer full for process ${processId}`);
                }
            }
        });

        child.stderr?.on('data', (data) => {
            const chunk = data.toString();
            const chunkBytes = Buffer.byteLength(chunk, 'utf8');

            if (outputBuffer.bytesUsed + chunkBytes <= this.config.maxOutputBuffer) {
                outputBuffer.stderr.push(chunk);
                outputBuffer.bytesUsed += chunkBytes;
            } else {
                if (!outputBuffer.truncated) {
                    outputBuffer.truncated = true;
                    this.logger.warn(`Error buffer full for process ${processId}`);
                }
            }
        });

        // Handle completion
        child.on('close', (code) => {
            clearTimeout(killTimer);
            if (killEscalationTimer) clearTimeout(killEscalationTimer);
            bgProcess.status = code === 0 ? 'completed' : 'failed';
            bgProcess.exitCode = code ?? undefined;
            bgProcess.completedAt = new Date();
            bgProcess.outputBuffer.complete = true;

            this.logger.debug(`Background process ${processId} completed with exit code ${code}`);
        });

        // Handle errors
        child.on('error', (error) => {
            clearTimeout(killTimer);
            if (killEscalationTimer) clearTimeout(killEscalationTimer);
            bgProcess.status = 'failed';
            bgProcess.completedAt = new Date();
            bgProcess.outputBuffer.complete = true;
            const chunk = `Error: ${error.message}`;
            const chunkBytes = Buffer.byteLength(chunk, 'utf8');
            if (bgProcess.outputBuffer.bytesUsed + chunkBytes <= this.config.maxOutputBuffer) {
                bgProcess.outputBuffer.stderr.push(chunk);
                bgProcess.outputBuffer.bytesUsed += chunkBytes;
            } else {
                if (!bgProcess.outputBuffer.truncated) {
                    bgProcess.outputBuffer.truncated = true;
                    this.logger.warn(`Error buffer full for process ${processId}`);
                }
            }

            this.logger.error(`Background process ${processId} failed: ${error.message}`);
        });

        return {
            processId,
            command,
            pid: child.pid,
            startedAt: bgProcess.startedAt,
            description: options.description,
        };
    }

    /**
     * Get output from a background process
     */
    async getProcessOutput(processId: string): Promise<ProcessOutput> {
        await this.ensureInitialized();

        const bgProcess = this.backgroundProcesses.get(processId);
        if (!bgProcess) {
            throw ProcessError.processNotFound(processId);
        }

        // Get new output since last read
        const stdout = bgProcess.outputBuffer.stdout.join('');
        const stderr = bgProcess.outputBuffer.stderr.join('');

        // Clear the buffer (data has been read) and reset byte counter
        bgProcess.outputBuffer.stdout = [];
        bgProcess.outputBuffer.stderr = [];
        bgProcess.outputBuffer.lastRead = Date.now();
        bgProcess.outputBuffer.bytesUsed = 0;

        return {
            stdout,
            stderr,
            status: bgProcess.status,
            exitCode: bgProcess.exitCode,
            duration: bgProcess.completedAt
                ? bgProcess.completedAt.getTime() - bgProcess.startedAt.getTime()
                : undefined,
        };
    }

    /**
     * Kill a background process
     */
    async killProcess(processId: string): Promise<void> {
        await this.ensureInitialized();

        const bgProcess = this.backgroundProcesses.get(processId);
        if (!bgProcess) {
            throw ProcessError.processNotFound(processId);
        }

        if (bgProcess.status !== 'running') {
            this.logger.debug(`Process ${processId} is not running (status: ${bgProcess.status})`);
            return; // Already completed
        }

        try {
            bgProcess.child.kill('SIGTERM');

            // Force kill after timeout
            setTimeout(() => {
                // Escalate based on actual process state, not our status flag
                if (bgProcess.child.exitCode === null) {
                    bgProcess.child.kill('SIGKILL');
                }
            }, 5000);

            this.logger.debug(`Process ${processId} sent SIGTERM`);
        } catch (error) {
            throw ProcessError.killFailed(
                processId,
                error instanceof Error ? error.message : String(error)
            );
        }
    }

    /**
     * List all background processes
     */
    async listProcesses(): Promise<ProcessInfo[]> {
        await this.ensureInitialized();

        return Array.from(this.backgroundProcesses.values()).map((bgProcess) => ({
            processId: bgProcess.processId,
            command: bgProcess.command,
            pid: bgProcess.child.pid,
            status: bgProcess.status,
            startedAt: bgProcess.startedAt,
            completedAt: bgProcess.completedAt,
            exitCode: bgProcess.exitCode,
            description: bgProcess.description,
        }));
    }

    /**
     * Get buffer size in bytes
     */
    private getBufferSize(buffer: OutputBuffer): number {
        const stdoutSize = buffer.stdout.reduce((sum, line) => sum + line.length, 0);
        const stderrSize = buffer.stderr.reduce((sum, line) => sum + line.length, 0);
        return stdoutSize + stderrSize;
    }

    /**
     * Get service configuration
     */
    getConfig(): Readonly<ProcessConfig> {
        return { ...this.config };
    }

    /**
     * Resolve and confine cwd to the configured working directory
     */
    private resolveSafeCwd(cwd?: string): string {
        const baseDir = this.config.workingDirectory || process.cwd();
        if (!cwd) return baseDir;
        const candidate = path.isAbsolute(cwd) ? path.resolve(cwd) : path.resolve(baseDir, cwd);
        const rel = path.relative(baseDir, candidate);
        const outside = rel.startsWith('..') || path.isAbsolute(rel);
        if (outside) {
            throw ProcessError.invalidWorkingDirectory(
                cwd,
                `Working directory must be within ${baseDir}`
            );
        }
        return candidate;
    }

    /**
     * Cleanup completed processes
     */
    async cleanup(): Promise<void> {
        const now = Date.now();
        const CLEANUP_AGE = 3600000; // 1 hour

        for (const [processId, bgProcess] of this.backgroundProcesses.entries()) {
            if (bgProcess.status !== 'running' && bgProcess.completedAt) {
                const age = now - bgProcess.completedAt.getTime();
                if (age > CLEANUP_AGE) {
                    this.backgroundProcesses.delete(processId);
                    this.logger.debug(`Cleaned up old process ${processId}`);
                }
            }
        }
    }
}

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
import { logger } from '../logger/index.js';

const DEFAULT_TIMEOUT = 120000; // 2 minutes
const DEFAULT_MAX_TIMEOUT = 600000; // 10 minutes
const DEFAULT_MAX_CONCURRENT_PROCESSES = 5;
const DEFAULT_MAX_OUTPUT_BUFFER = 1024 * 1024; // 1MB

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
 */
export class ProcessService {
    private config: ProcessConfig;
    private commandValidator: CommandValidator;
    private initialized: boolean = false;
    private backgroundProcesses: Map<string, BackgroundProcess> = new Map();

    constructor(config: Partial<ProcessConfig> = {}) {
        // Set defaults
        this.config = {
            securityLevel: config.securityLevel || 'moderate',
            maxTimeout: config.maxTimeout || DEFAULT_MAX_TIMEOUT,
            maxConcurrentProcesses:
                config.maxConcurrentProcesses || DEFAULT_MAX_CONCURRENT_PROCESSES,
            maxOutputBuffer: config.maxOutputBuffer || DEFAULT_MAX_OUTPUT_BUFFER,
            allowedCommands: config.allowedCommands || [],
            blockedCommands: config.blockedCommands || [],
            environment: config.environment || {},
            workingDirectory: config.workingDirectory,
        };

        this.commandValidator = new CommandValidator(this.config);
    }

    /**
     * Initialize the service
     */
    async initialize(): Promise<void> {
        if (this.initialized) {
            logger.debug('ProcessService already initialized');
            return;
        }

        // Clean up any stale processes on startup
        this.backgroundProcesses.clear();

        this.initialized = true;
        logger.info('ProcessService initialized successfully');
    }

    /**
     * Execute a command
     */
    async executeCommand(
        command: string,
        options: ExecuteOptions = {}
    ): Promise<ProcessResult | ProcessHandle> {
        if (!this.initialized) {
            throw ProcessError.notInitialized();
        }

        // Validate command
        const validation = this.commandValidator.validateCommand(command);
        if (!validation.isValid || !validation.normalizedCommand) {
            throw ProcessError.invalidCommand(command, validation.error || 'Unknown error');
        }

        const normalizedCommand = validation.normalizedCommand;

        // Check if command requires approval (e.g., dangerous commands like rm, git push)
        if (validation.requiresApproval) {
            if (!options.approvalFunction) {
                // No approval mechanism provided - fail safe
                throw ProcessError.approvalRequired(
                    normalizedCommand,
                    'Command requires approval but no approval mechanism provided'
                );
            }

            logger.info(
                `Command requires approval: ${normalizedCommand} - requesting user confirmation`
            );
            const approved = await options.approvalFunction(normalizedCommand);

            if (!approved) {
                logger.info(`Command approval denied: ${normalizedCommand}`);
                throw ProcessError.approvalDenied(normalizedCommand);
            }

            logger.info(`Command approved: ${normalizedCommand}`);
        }

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
        });
    }

    /**
     * Execute command in foreground with timeout
     */
    private executeForeground(
        command: string,
        options: { cwd: string; timeout: number; env: Record<string, string>; description?: string }
    ): Promise<ProcessResult> {
        return new Promise((resolve, reject) => {
            const startTime = Date.now();
            let stdout = '';
            let stderr = '';
            let killed = false;
            let closed = false;

            logger.debug(`Executing command: ${command}`);

            // Spawn process with shell
            const child = spawn(command, {
                cwd: options.cwd,
                env: options.env,
                shell: true,
            });

            // Setup timeout
            const timeoutHandle = setTimeout(() => {
                killed = true;
                child.kill('SIGTERM');
                setTimeout(() => {
                    // If still not closed, force kill
                    if (!closed && child.exitCode === null) {
                        child.kill('SIGKILL');
                    }
                }, 5000); // Force kill after 5 seconds
            }, options.timeout);

            // Collect stdout
            child.stdout?.on('data', (data) => {
                stdout += data.toString();
            });

            // Collect stderr
            child.stderr?.on('data', (data) => {
                stderr += data.toString();
            });

            // Handle completion
            child.on('close', (code, signal) => {
                closed = true;
                clearTimeout(timeoutHandle);
                const duration = Date.now() - startTime;

                if (killed) {
                    reject(ProcessError.timeout(command, options.timeout));
                    return;
                }

                let exitCode = typeof code === 'number' ? code : 1;
                if (code === null) {
                    stderr += `\nProcess terminated by signal ${signal ?? 'UNKNOWN'}`;
                }

                logger.debug(
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

        logger.debug(`Starting background process ${processId}: ${command}`);

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
        const killTimer = setTimeout(() => {
            if (bgProcess.status === 'running') {
                logger.warn(
                    `Background process ${processId} timed out after ${bgTimeout}ms, sending SIGTERM`
                );
                child.kill('SIGTERM');
                // Escalate to SIGKILL if process doesn't terminate
                setTimeout(() => {
                    if (bgProcess.status === 'running') {
                        logger.warn(
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
                    logger.warn(`Output buffer full for process ${processId}`);
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
                    logger.warn(`Error buffer full for process ${processId}`);
                }
            }
        });

        // Handle completion
        child.on('close', (code) => {
            clearTimeout(killTimer);
            bgProcess.status = code === 0 ? 'completed' : 'failed';
            bgProcess.exitCode = code ?? undefined;
            bgProcess.completedAt = new Date();
            bgProcess.outputBuffer.complete = true;

            logger.debug(`Background process ${processId} completed with exit code ${code}`);
        });

        // Handle errors
        child.on('error', (error) => {
            clearTimeout(killTimer);
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
                    logger.warn(`Error buffer full for process ${processId}`);
                }
            }

            logger.error(`Background process ${processId} failed: ${error.message}`);
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
        if (!this.initialized) {
            throw ProcessError.notInitialized();
        }

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
        if (!this.initialized) {
            throw ProcessError.notInitialized();
        }

        const bgProcess = this.backgroundProcesses.get(processId);
        if (!bgProcess) {
            throw ProcessError.processNotFound(processId);
        }

        if (bgProcess.status !== 'running') {
            logger.debug(`Process ${processId} is not running (status: ${bgProcess.status})`);
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

            logger.debug(`Process ${processId} sent SIGTERM`);
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
        if (!this.initialized) {
            throw ProcessError.notInitialized();
        }

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
                    logger.debug(`Cleaned up old process ${processId}`);
                }
            }
        }
    }
}

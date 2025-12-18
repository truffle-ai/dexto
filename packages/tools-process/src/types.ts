/**
 * Process Service Types
 *
 * Types and interfaces for command execution and process management
 */

/**
 * Process execution options
 */
export interface ExecuteOptions {
    /** Working directory */
    cwd?: string | undefined;
    /** Timeout in milliseconds (max: 600000) */
    timeout?: number | undefined;
    /** Run command in background */
    runInBackground?: boolean | undefined;
    /** Environment variables */
    env?: Record<string, string> | undefined;
    /** Description of what the command does (5-10 words) */
    description?: string | undefined;
    /** Abort signal for cancellation support */
    abortSignal?: AbortSignal | undefined;
}

/**
 * Process execution result (foreground execution only)
 * For background execution, see ProcessHandle
 */
export interface ProcessResult {
    stdout: string;
    stderr: string;
    exitCode: number;
    duration: number;
}

/**
 * Background process handle
 */
export interface ProcessHandle {
    processId: string;
    command: string;
    pid?: number | undefined; // System process ID
    startedAt: Date;
    description?: string | undefined;
}

/**
 * Process output (for retrieving from background processes)
 */
export interface ProcessOutput {
    stdout: string;
    stderr: string;
    status: 'running' | 'completed' | 'failed';
    exitCode?: number | undefined;
    duration?: number | undefined;
}

/**
 * Process information
 */
export interface ProcessInfo {
    processId: string;
    command: string;
    pid?: number | undefined;
    status: 'running' | 'completed' | 'failed';
    startedAt: Date;
    completedAt?: Date | undefined;
    exitCode?: number | undefined;
    description?: string | undefined;
}

/**
 * Command validation result
 */
export interface CommandValidation {
    isValid: boolean;
    error?: string;
    normalizedCommand?: string;
    requiresApproval?: boolean;
}

/**
 * Process service configuration
 */
export interface ProcessConfig {
    /** Security level for command execution */
    securityLevel: 'strict' | 'moderate' | 'permissive';
    /** Maximum timeout for commands in milliseconds */
    maxTimeout: number;
    /** Maximum concurrent background processes */
    maxConcurrentProcesses: number;
    /** Maximum output buffer size in bytes */
    maxOutputBuffer: number;
    /** Explicitly allowed commands (empty = all allowed with approval) */
    allowedCommands: string[];
    /** Blocked command patterns */
    blockedCommands: string[];
    /** Custom environment variables */
    environment: Record<string, string>;
    /** Working directory (defaults to process.cwd()) */
    workingDirectory?: string | undefined;
}

/**
 * Output buffer management
 */
export interface OutputBuffer {
    stdout: string[];
    stderr: string[];
    complete: boolean;
    lastRead: number; // Timestamp of last read
    bytesUsed: number; // Running byte count for O(1) limit checks
    truncated?: boolean; // True if content was dropped due to limits
}

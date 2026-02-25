/**
 * Debug Logging Utility
 *
 * Cross-platform debug logging that writes to temp directory.
 * Controlled via environment variables for easy enable/disable.
 *
 * Usage:
 *   import { createDebugLogger } from './debugLog.js';
 *   const debug = createDebugLogger('stream');
 *   debug.log('EVENT', { foo: 'bar' });
 *
 * Enable via environment:
 *   DEXTO_DEBUG_STREAM=true dexto
 *   DEXTO_DEBUG_ALL=true dexto  (enables all debug loggers)
 */

import { appendFileSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

export interface DebugLogger {
    /** Log a message with optional data */
    log: (msg: string, data?: Record<string, unknown>) => void;
    /** Check if debug logging is enabled */
    isEnabled: () => boolean;
    /** Get the log file path */
    getLogPath: () => string;
    /** Clear the log file and write a header */
    reset: (header?: string) => void;
}

/**
 * Creates a debug logger for a specific component.
 *
 * @param name Component name (used in env var and filename)
 * @returns Debug logger instance
 *
 * @example
 * const debug = createDebugLogger('stream');
 * // Enabled via DEXTO_DEBUG_STREAM=true or DEXTO_DEBUG_ALL=true
 * // Writes to: {tmpdir}/dexto-debug-stream.log
 */
export function createDebugLogger(name: string): DebugLogger {
    const envVar = `DEXTO_DEBUG_${name.toUpperCase()}`;
    const logPath = join(tmpdir(), `dexto-debug-${name.toLowerCase()}.log`);

    const isEnabled = (): boolean => {
        return process.env[envVar] === 'true' || process.env.DEXTO_DEBUG_ALL === 'true';
    };

    const log = (msg: string, data?: Record<string, unknown>): void => {
        if (!isEnabled()) return;

        try {
            const timestamp = new Date().toISOString().split('T')[1];
            const dataStr = data ? ` ${JSON.stringify(data)}` : '';
            const line = `[${timestamp}] ${msg}${dataStr}\n`;
            appendFileSync(logPath, line);
        } catch {
            // Silently ignore serialization and write errors in debug logging
        }
    };

    const reset = (header?: string): void => {
        if (!isEnabled()) return;

        const defaultHeader = `=== DEXTO DEBUG [${name.toUpperCase()}] ${new Date().toISOString()} ===`;
        try {
            writeFileSync(logPath, `${header ?? defaultHeader}\n`);
        } catch {
            // Silently ignore write errors in debug logging
        }
    };

    return {
        log,
        isEnabled,
        getLogPath: () => logPath,
        reset,
    };
}

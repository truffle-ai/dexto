/**
 * Silent Transport
 *
 * A no-op transport that discards all log entries.
 * Used when logging needs to be completely suppressed (e.g., sub-agents).
 */

import type { LoggerTransport, LogEntry } from '../types.js';

/**
 * SilentTransport - Discards all log entries
 */
export class SilentTransport implements LoggerTransport {
    write(_entry: LogEntry): void {
        // Intentionally do nothing - discard all logs
    }

    destroy(): void {
        // Nothing to clean up
    }
}

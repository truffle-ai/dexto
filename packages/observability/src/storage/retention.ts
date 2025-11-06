import type { StorageManager } from '@dexto/core';
import type { StoredTrace } from './schema.js';

export interface RetentionServiceOptions {
    /**
     * Retention period (e.g., '7d', '30d', '90d')
     * @default '7d'
     */
    retention: string;

    /**
     * Storage key prefix for traces
     * @default 'trace:'
     */
    keyPrefix?: string;

    /**
     * Auto-run cleanup on interval
     * @default false
     */
    autoCleanup?: boolean;

    /**
     * Cleanup interval in milliseconds
     * @default 3600000 (1 hour)
     */
    cleanupInterval?: number;
}

/**
 * Service for managing trace retention and cleanup.
 *
 * Automatically deletes traces older than the configured retention period
 * to prevent unbounded database growth.
 *
 * @example
 * ```typescript
 * const retentionService = new RetentionService(storageManager, {
 *   retention: '7d',
 *   autoCleanup: true,
 *   cleanupInterval: 3600000, // 1 hour
 * });
 *
 * await retentionService.start();
 * // ... later
 * await retentionService.stop();
 * ```
 */
interface ResolvedRetentionOptions {
    retention: string;
    keyPrefix: string;
    autoCleanup: boolean;
    cleanupInterval: number;
}

export class RetentionService {
    private storageManager: StorageManager;
    private options: ResolvedRetentionOptions;
    private cleanupTimer: NodeJS.Timeout | undefined = undefined;
    private isRunning = false;

    constructor(storageManager: StorageManager, options: RetentionServiceOptions) {
        this.storageManager = storageManager;
        this.options = {
            retention: options.retention,
            keyPrefix: options.keyPrefix ?? 'trace:',
            autoCleanup: options.autoCleanup ?? false,
            cleanupInterval: options.cleanupInterval ?? 3600000, // 1 hour
        };
    }

    /**
     * Start the retention service with automatic cleanup
     */
    async start(): Promise<void> {
        if (this.isRunning) {
            return;
        }

        this.isRunning = true;

        if (this.options.autoCleanup) {
            // Run initial cleanup
            await this.cleanup();

            // Schedule periodic cleanup
            this.cleanupTimer = setInterval(() => {
                this.cleanup().catch((error) => {
                    console.error('[RetentionService] Cleanup failed:', error);
                });
            }, this.options.cleanupInterval);
        }
    }

    /**
     * Stop the retention service
     */
    async stop(): Promise<void> {
        if (!this.isRunning) {
            return;
        }

        if (this.cleanupTimer) {
            clearInterval(this.cleanupTimer);
            this.cleanupTimer = undefined;
        }

        this.isRunning = false;
    }

    /**
     * Run cleanup manually to delete old traces
     */
    async cleanup(): Promise<{ deletedCount: number; error?: Error }> {
        try {
            const database = this.storageManager.getDatabase();
            const retentionMs = this.parseRetention(this.options.retention);
            const cutoffTime = Date.now() - retentionMs;

            // List all trace keys
            const traceKeys = await database.list(this.options.keyPrefix);

            let deletedCount = 0;

            // Check each trace and delete if older than retention
            for (const key of traceKeys) {
                try {
                    const trace = await database.get<StoredTrace>(key);

                    if (trace && trace.endTime < cutoffTime) {
                        await database.delete(key);
                        deletedCount++;
                    }
                } catch (error) {
                    // Log error but continue cleanup
                    console.error(`[RetentionService] Failed to process key ${key}:`, error);
                }
            }

            console.log(`[RetentionService] Cleanup complete: deleted ${deletedCount} traces`);
            return { deletedCount };
        } catch (error) {
            console.error('[RetentionService] Cleanup error:', error);
            return {
                deletedCount: 0,
                error: error instanceof Error ? error : new Error(String(error)),
            };
        }
    }

    /**
     * Parse retention string to milliseconds.
     * Supports: 'd' (days), 'h' (hours), 'm' (minutes)
     *
     * @example
     * parseRetention('7d')  // 7 days in ms
     * parseRetention('24h') // 24 hours in ms
     * parseRetention('30m') // 30 minutes in ms
     */
    private parseRetention(retention: string): number {
        const match = retention.match(/^(\d+)([dhm])$/);
        if (!match || !match[1] || !match[2]) {
            throw new Error(
                `Invalid retention format: ${retention}. Expected format: <number><unit> (e.g., 7d, 24h, 30m)`
            );
        }

        const value = parseInt(match[1], 10);
        const unit = match[2] as 'd' | 'h' | 'm';

        switch (unit) {
            case 'd': // days
                return value * 24 * 60 * 60 * 1000;
            case 'h': // hours
                return value * 60 * 60 * 1000;
            case 'm': // minutes
                return value * 60 * 1000;
            default:
                throw new Error(`Unknown retention unit: ${unit}`);
        }
    }

    /**
     * Get the current retention period in milliseconds
     */
    getRetentionMs(): number {
        if (!this.options.retention) {
            throw new Error('Retention period not configured');
        }
        return this.parseRetention(this.options.retention);
    }

    /**
     * Check if service is running
     */
    isServiceRunning(): boolean {
        return this.isRunning;
    }
}

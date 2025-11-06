import type { StorageManager } from '@dexto/core';
import type { StoredTrace } from '../storage/schema.js';
import type { TraceFilters, Pagination, TimeRange } from './schemas.js';

export interface QueryOptions {
    filters?: TraceFilters;
    pagination?: Pagination;
    timeRange?: TimeRange;
}

export interface PaginatedResult<T> {
    data: T[];
    pagination: {
        total: number;
        page: number;
        pageSize: number;
        totalPages: number;
    };
}

/**
 * Service for querying telemetry data from storage.
 */
export class QueryService {
    constructor(private storageManager: StorageManager) {}

    /**
     * List traces with pagination and filtering
     */
    async listTraces(options: QueryOptions = {}): Promise<PaginatedResult<StoredTrace>> {
        const database = this.storageManager.getDatabase();
        const { filters = {}, pagination = { page: 1, pageSize: 20 }, timeRange } = options;

        // List all trace keys
        const traceKeys = await database.list('trace:');

        // Fetch and filter traces
        const allTraces: StoredTrace[] = [];

        for (const key of traceKeys) {
            try {
                const trace = await database.get<StoredTrace>(key);
                if (!trace) continue;

                // Apply filters
                if (!this.matchesFilters(trace, filters, timeRange)) {
                    continue;
                }

                allTraces.push(trace);
            } catch (error) {
                console.error(`[QueryService] Failed to fetch trace ${key}:`, error);
                // Continue with other traces
            }
        }

        // Sort by start time (newest first)
        allTraces.sort((a, b) => b.startTime - a.startTime);

        // Apply pagination
        const page = Math.max(1, pagination.page);
        const pageSize = Math.min(100, Math.max(1, pagination.pageSize)); // Max 100 per page
        const startIndex = (page - 1) * pageSize;
        const endIndex = startIndex + pageSize;

        const paginatedTraces = allTraces.slice(startIndex, endIndex);
        const totalPages = Math.ceil(allTraces.length / pageSize);

        return {
            data: paginatedTraces,
            pagination: {
                total: allTraces.length,
                page,
                pageSize,
                totalPages,
            },
        };
    }

    /**
     * Get single trace by ID
     */
    async getTrace(id: string): Promise<StoredTrace | null> {
        try {
            const database = this.storageManager.getDatabase();
            const key = `trace:${id}`;
            const trace = await database.get<StoredTrace>(key);
            return trace || null;
        } catch (error) {
            console.error(`[QueryService] Failed to fetch trace ${id}:`, error);
            return null;
        }
    }

    /**
     * Get traces for a specific session
     */
    async getTracesBySession(
        sessionId: string,
        options: QueryOptions = {}
    ): Promise<StoredTrace[]> {
        const result = await this.listTraces({
            ...options,
            filters: {
                ...options.filters,
                sessionId,
            },
        });

        return result.data;
    }

    /**
     * Get all traces within a time range
     */
    async getTracesByTimeRange(timeRange: TimeRange): Promise<StoredTrace[]> {
        const result = await this.listTraces({
            timeRange,
            pagination: { page: 1, pageSize: 1000 }, // Large page size for time range queries
        });

        return result.data;
    }

    /**
     * Count traces matching filters
     */
    async countTraces(filters?: TraceFilters, timeRange?: TimeRange): Promise<number> {
        const database = this.storageManager.getDatabase();
        const traceKeys = await database.list('trace:');

        let count = 0;

        for (const key of traceKeys) {
            try {
                const trace = await database.get<StoredTrace>(key);
                if (trace && this.matchesFilters(trace, filters || {}, timeRange)) {
                    count++;
                }
            } catch (error) {
                // Continue counting
            }
        }

        return count;
    }

    /**
     * Get oldest and newest trace timestamps
     */
    async getTraceTimeRange(): Promise<{ oldest: number; newest: number } | null> {
        const database = this.storageManager.getDatabase();
        const traceKeys = await database.list('trace:');

        if (traceKeys.length === 0) {
            return null;
        }

        let oldest = Infinity;
        let newest = 0;

        for (const key of traceKeys) {
            try {
                const trace = await database.get<StoredTrace>(key);
                if (trace) {
                    oldest = Math.min(oldest, trace.startTime);
                    newest = Math.max(newest, trace.endTime);
                }
            } catch (error) {
                // Continue
            }
        }

        return oldest === Infinity ? null : { oldest, newest };
    }

    /**
     * Check if a trace matches the given filters
     */
    private matchesFilters(
        trace: StoredTrace,
        filters: TraceFilters,
        timeRange?: TimeRange
    ): boolean {
        // Time range filter
        if (timeRange) {
            const { start, end } = this.parseTimeRange(timeRange);
            if (start !== undefined && trace.startTime < start) return false;
            if (end !== undefined && trace.endTime > end) return false;
        }

        // Session ID filter
        if (filters.sessionId && trace.sessionId !== filters.sessionId) {
            return false;
        }

        // Provider filter
        if (filters.provider && trace.provider !== filters.provider) {
            return false;
        }

        // Model filter
        if (filters.model && trace.model !== filters.model) {
            return false;
        }

        // Tool name filter
        if (filters.toolName && trace.toolName !== filters.toolName) {
            return false;
        }

        // Status filter
        if (filters.status) {
            const isError = trace.status.code !== 0;
            if (filters.status === 'error' && !isError) return false;
            if (filters.status === 'ok' && isError) return false;
        }

        // Duration filters
        const duration = trace.duration || trace.endTime - trace.startTime;
        if (filters.minDuration !== undefined && duration < filters.minDuration) {
            return false;
        }
        if (filters.maxDuration !== undefined && duration > filters.maxDuration) {
            return false;
        }

        return true;
    }

    /**
     * Parse time range to start/end timestamps
     */
    private parseTimeRange(timeRange: TimeRange): { start?: number; end?: number } {
        if (timeRange.start !== undefined && timeRange.end !== undefined) {
            return { start: timeRange.start, end: timeRange.end };
        }

        if (timeRange.window) {
            const now = Date.now();
            const duration = this.parseTimeWindow(timeRange.window);
            return { start: now - duration, end: now };
        }

        return {};
    }

    /**
     * Parse time window string to milliseconds
     * Supports: 1h, 24h, 7d, 30d
     */
    private parseTimeWindow(window: string): number {
        const match = window.match(/^(\d+)([hd])$/);
        if (!match || !match[1] || !match[2]) {
            throw new Error(`Invalid time window format: ${window}`);
        }

        const value = parseInt(match[1], 10);
        const unit = match[2] as 'h' | 'd';

        switch (unit) {
            case 'h':
                return value * 60 * 60 * 1000;
            case 'd':
                return value * 24 * 60 * 60 * 1000;
            default:
                throw new Error(`Unknown time unit: ${unit}`);
        }
    }
}

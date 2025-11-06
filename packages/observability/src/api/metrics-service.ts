import type { StorageManager } from '@dexto/core';
import type { StoredTrace } from '../storage/schema.js';
import type { TimeRange } from './schemas.js';
import { QueryService } from './query-service.js';

export interface LatencyMetrics {
    p50: number;
    p95: number;
    p99: number;
    mean: number;
}

export interface ThroughputMetrics {
    total: number;
    perMinute: number;
}

export interface TokenUsageMetrics {
    total?: number;
    byProvider?: Record<string, number>;
}

export interface ToolMetrics {
    total: number;
    byTool: Record<string, number>;
    successRate: number;
}

export interface AggregatedMetrics {
    latency: LatencyMetrics;
    errorRate: number;
    throughput: ThroughputMetrics;
    tokenUsage?: TokenUsageMetrics;
    toolCalls?: ToolMetrics;
}

/**
 * Service for calculating metrics from telemetry data.
 */
export class MetricsService {
    private queryService: QueryService;

    constructor(private storageManager: StorageManager) {
        this.queryService = new QueryService(storageManager);
    }

    /**
     * Calculate aggregated metrics for a time range
     */
    async calculateMetrics(
        timeRange?: TimeRange,
        filters?: { sessionId?: string; provider?: string }
    ): Promise<AggregatedMetrics> {
        // Fetch traces for the time range
        const traces = await this.queryService.listTraces({
            ...(timeRange && { timeRange }),
            ...(filters && { filters: filters as any }),
            pagination: { page: 1, pageSize: 10000 }, // Large limit for metrics
        });

        const allTraces = traces.data;

        // Calculate latency metrics
        const latency = this.calculateLatency(allTraces);

        // Calculate error rate
        const errorRate = this.calculateErrorRate(allTraces);

        // Calculate throughput
        const throughput = this.calculateThroughput(allTraces, timeRange);

        // Calculate token usage (if available)
        const tokenUsage = this.calculateTokenUsage(allTraces);

        // Calculate tool metrics (if available)
        const toolCalls = this.calculateToolMetrics(allTraces);

        return {
            latency,
            errorRate,
            throughput,
            ...(tokenUsage && { tokenUsage }),
            ...(toolCalls && { toolCalls }),
        };
    }

    /**
     * Calculate latency percentiles
     */
    private calculateLatency(traces: StoredTrace[]): LatencyMetrics {
        if (traces.length === 0) {
            return { p50: 0, p95: 0, p99: 0, mean: 0 };
        }

        // Extract durations
        const durations = traces
            .map((t) => t.duration ?? t.endTime - t.startTime)
            .sort((a, b) => a - b);

        // Calculate percentiles
        const p50 = this.percentile(durations, 0.5);
        const p95 = this.percentile(durations, 0.95);
        const p99 = this.percentile(durations, 0.99);

        // Calculate mean
        const mean = durations.reduce((sum, d) => sum + d, 0) / durations.length;

        return {
            p50: Math.round(p50),
            p95: Math.round(p95),
            p99: Math.round(p99),
            mean: Math.round(mean),
        };
    }

    /**
     * Calculate error rate (0-1)
     */
    private calculateErrorRate(traces: StoredTrace[]): number {
        if (traces.length === 0) {
            return 0;
        }

        const errorCount = traces.filter((t) => t.status.code !== 0).length;
        return parseFloat((errorCount / traces.length).toFixed(4));
    }

    /**
     * Calculate throughput metrics
     */
    private calculateThroughput(traces: StoredTrace[], timeRange?: TimeRange): ThroughputMetrics {
        const total = traces.length;

        if (total === 0 || !timeRange) {
            return { total, perMinute: 0 };
        }

        // Calculate duration of the time window
        let windowMs: number;
        if (timeRange.start && timeRange.end) {
            windowMs = timeRange.end - timeRange.start;
        } else if (timeRange.window) {
            windowMs = this.parseTimeWindow(timeRange.window);
        } else {
            // Fallback: use actual trace time range
            const startTimes = traces.map((t) => t.startTime);
            const endTimes = traces.map((t) => t.endTime);
            const minStart = Math.min(...startTimes);
            const maxEnd = Math.max(...endTimes);
            windowMs = maxEnd - minStart;
        }

        const windowMinutes = windowMs / (60 * 1000);
        const perMinute = windowMinutes > 0 ? parseFloat((total / windowMinutes).toFixed(2)) : 0;

        return { total, perMinute };
    }

    /**
     * Calculate token usage from trace attributes
     */
    private calculateTokenUsage(traces: StoredTrace[]): TokenUsageMetrics | undefined {
        const byProvider: Record<string, number> = {};
        let total = 0;
        let hasTokenData = false;

        for (const trace of traces) {
            const attrs = trace.attributes || {};

            // Look for token usage in attributes (OpenTelemetry semantic conventions)
            const inputTokens = (attrs['gen_ai.usage.input_tokens'] as number) || 0;
            const outputTokens = (attrs['gen_ai.usage.output_tokens'] as number) || 0;
            const totalTokens =
                (attrs['gen_ai.usage.total_tokens'] as number) || inputTokens + outputTokens;

            if (totalTokens > 0) {
                hasTokenData = true;
                total += totalTokens;

                // Extract provider from span name (e.g., "llm.vercel.streamText" -> "vercel")
                let provider = 'unknown';
                if (trace.name.startsWith('llm.')) {
                    const parts = trace.name.split('.');
                    if (parts.length >= 2 && parts[1]) {
                        provider = parts[1]; // Extract "vercel" from "llm.vercel.streamText"
                    }
                }

                byProvider[provider] = (byProvider[provider] || 0) + totalTokens;
            }
        }

        return hasTokenData ? { total, byProvider } : undefined;
    }

    /**
     * Calculate tool call metrics
     */
    private calculateToolMetrics(traces: StoredTrace[]): ToolMetrics | undefined {
        // Filter for MCP tool spans (span names starting with "mcp.tool.")
        // This captures actual user-facing tools like Read, Write, Bash
        const toolTraces = traces.filter((t) => t.name.startsWith('mcp.tool.'));

        if (toolTraces.length === 0) {
            return undefined;
        }

        const byTool: Record<string, number> = {};
        let successCount = 0;

        for (const trace of toolTraces) {
            // Use toolName from attributes (e.g., "Read", "Write", "Bash")
            // Fall back to span name if toolName not available
            const toolName = trace.toolName || trace.name.replace('mcp.tool.', '');
            byTool[toolName] = (byTool[toolName] || 0) + 1;

            if (trace.status.code === 0) {
                successCount++;
            }
        }

        const successRate = parseFloat((successCount / toolTraces.length).toFixed(4));

        return {
            total: toolTraces.length,
            byTool,
            successRate,
        };
    }

    /**
     * Calculate session-specific metrics
     */
    async calculateSessionMetrics(sessionId: string): Promise<{
        sessionId: string;
        messageCount: number;
        totalDuration: number;
        averageDuration: number;
        errorCount: number;
        toolCallCount: number;
        tokenUsage?: number;
        traces: StoredTrace[];
    }> {
        const traces = await this.queryService.getTracesBySession(sessionId);

        const totalDuration = traces.reduce(
            (sum, t) => sum + (t.duration ?? t.endTime - t.startTime),
            0
        );
        const averageDuration = traces.length > 0 ? totalDuration / traces.length : 0;
        const errorCount = traces.filter((t) => t.status.code !== 0).length;
        const toolCallCount = traces.filter((t) => t.toolName).length;

        // Calculate total token usage for session
        const tokenUsageData = this.calculateTokenUsage(traces);
        const tokenUsage = tokenUsageData?.total;

        return {
            sessionId,
            messageCount: traces.length,
            totalDuration: Math.round(totalDuration),
            averageDuration: Math.round(averageDuration),
            errorCount,
            toolCallCount,
            ...(tokenUsage !== undefined && { tokenUsage }),
            traces,
        };
    }

    /**
     * Calculate percentile value from sorted array
     */
    private percentile(sortedArray: number[], p: number): number {
        if (sortedArray.length === 0) return 0;

        const index = Math.ceil(sortedArray.length * p) - 1;
        return sortedArray[Math.max(0, index)] ?? 0;
    }

    /**
     * Parse time window string to milliseconds
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

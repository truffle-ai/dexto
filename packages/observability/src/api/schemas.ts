import { z } from 'zod';
import { createRoute } from '@hono/zod-openapi';

/**
 * API request/response schemas for observability endpoints
 */

// Common query parameters
export const TimeRangeSchema = z.object({
    start: z.coerce.number().optional().describe('Start timestamp (ms)'),
    end: z.coerce.number().optional().describe('End timestamp (ms)'),
    window: z.string().optional().describe('Time window (e.g., 1h, 24h, 7d)'),
});

export const PaginationSchema = z.object({
    page: z.coerce.number().default(1).describe('Page number (1-indexed)'),
    pageSize: z.coerce.number().default(20).describe('Items per page'),
});

export const TraceFiltersSchema = z.object({
    sessionId: z.string().optional().describe('Filter by session ID'),
    provider: z.string().optional().describe('Filter by LLM provider'),
    model: z.string().optional().describe('Filter by model name'),
    toolName: z.string().optional().describe('Filter by tool name'),
    status: z.enum(['ok', 'error']).optional().describe('Filter by status'),
    minDuration: z.coerce.number().optional().describe('Minimum duration (ms)'),
    maxDuration: z.coerce.number().optional().describe('Maximum duration (ms)'),
});

// Health endpoint
export const HealthResponseSchema = z.object({
    ok: z.boolean(),
    agent: z.object({
        status: z.enum(['running', 'stopped', 'error']),
        uptime: z.number().describe('Uptime in milliseconds'),
    }),
    storage: z.object({
        cache: z.boolean(),
        database: z.boolean(),
        blob: z.boolean(),
    }),
    telemetry: z.object({
        enabled: z.boolean(),
        traceCount: z.number(),
        oldestTrace: z.number().optional(),
        newestTrace: z.number().optional(),
    }),
});

// List traces endpoint
export const ListTracesQuerySchema = z.object({
    ...TimeRangeSchema.shape,
    ...PaginationSchema.shape,
    ...TraceFiltersSchema.shape,
});

export const TraceItemSchema = z.object({
    id: z.string(),
    traceId: z.string(),
    name: z.string(),
    startTime: z.number(),
    endTime: z.number(),
    duration: z.number(),
    status: z.object({
        code: z.number(),
        message: z.string().optional(),
    }),
    sessionId: z.string().optional(),
    provider: z.string().optional(),
    model: z.string().optional(),
    toolName: z.string().optional(),
});

export const ListTracesResponseSchema = z.object({
    ok: z.boolean(),
    data: z.object({
        traces: z.array(TraceItemSchema),
        pagination: z.object({
            total: z.number(),
            page: z.number(),
            pageSize: z.number(),
            totalPages: z.number(),
        }),
    }),
});

// Get trace by ID endpoint
export const GetTraceParamsSchema = z.object({
    id: z.string().describe('Trace ID'),
});

export const TraceDetailSchema = TraceItemSchema.extend({
    parentSpanId: z.string().optional(),
    scope: z.string(),
    kind: z.number(),
    attributes: z.record(z.any()),
    events: z.array(z.any()),
    links: z.array(z.any()),
    createdAt: z.string(),
});

export const GetTraceResponseSchema = z.object({
    ok: z.boolean(),
    data: TraceDetailSchema.nullable(),
});

// Metrics endpoint
export const MetricsQuerySchema = z.object({
    ...TimeRangeSchema.shape,
    sessionId: z.string().optional(),
    provider: z.string().optional(),
});

export const MetricsResponseSchema = z.object({
    ok: z.boolean(),
    data: z.object({
        latency: z.object({
            p50: z.number().describe('50th percentile (ms)'),
            p95: z.number().describe('95th percentile (ms)'),
            p99: z.number().describe('99th percentile (ms)'),
            mean: z.number().describe('Mean duration (ms)'),
        }),
        errorRate: z.number().describe('Error rate (0-1)'),
        throughput: z.object({
            total: z.number().describe('Total requests'),
            perMinute: z.number().describe('Requests per minute'),
        }),
        tokenUsage: z
            .object({
                total: z.number().optional(),
                byProvider: z.record(z.number()).optional(),
            })
            .optional(),
        toolCalls: z
            .object({
                total: z.number(),
                byTool: z.record(z.number()),
                successRate: z.number(),
            })
            .optional(),
    }),
});

// Session metrics endpoint
export const SessionMetricsParamsSchema = z.object({
    sessionId: z.string().describe('Session ID'),
});

export const SessionMetricsResponseSchema = z.object({
    ok: z.boolean(),
    data: z.object({
        sessionId: z.string(),
        messageCount: z.number(),
        totalDuration: z.number(),
        averageDuration: z.number(),
        errorCount: z.number(),
        toolCallCount: z.number(),
        tokenUsage: z.number().optional(),
        traces: z.array(TraceItemSchema),
    }),
});

// Error response
export const ErrorResponseSchema = z.object({
    ok: z.literal(false),
    error: z.object({
        code: z.string(),
        message: z.string(),
        details: z.any().optional(),
    }),
});

// Type exports
export type TimeRange = z.infer<typeof TimeRangeSchema>;
export type Pagination = z.infer<typeof PaginationSchema>;
export type TraceFilters = z.infer<typeof TraceFiltersSchema>;
export type HealthResponse = z.infer<typeof HealthResponseSchema>;
export type ListTracesQuery = z.infer<typeof ListTracesQuerySchema>;
export type ListTracesResponse = z.infer<typeof ListTracesResponseSchema>;
export type GetTraceParams = z.infer<typeof GetTraceParamsSchema>;
export type GetTraceResponse = z.infer<typeof GetTraceResponseSchema>;
export type MetricsQuery = z.infer<typeof MetricsQuerySchema>;
export type MetricsResponse = z.infer<typeof MetricsResponseSchema>;
export type SessionMetricsParams = z.infer<typeof SessionMetricsParamsSchema>;
export type SessionMetricsResponse = z.infer<typeof SessionMetricsResponseSchema>;
export type ErrorResponse = z.infer<typeof ErrorResponseSchema>;

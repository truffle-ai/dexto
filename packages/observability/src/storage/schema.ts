import { z } from 'zod';
import type { ReadableSpan } from '@opentelemetry/sdk-trace-base';

/**
 * Trace data structure for storage/retrieval.
 * Extended from @dexto/core telemetry types with additional storage metadata.
 */
export const TraceSchema = z.object({
    // Span identification
    id: z.string().describe('Span ID'),
    traceId: z.string().describe('Trace ID (groups related spans)'),
    parentSpanId: z.string().optional().describe('Parent span ID for nested spans'),

    // Span metadata
    name: z.string().describe('Span name (e.g., "agent.run", "llm.chat")'),
    scope: z.string().describe('Instrumentation scope'),
    kind: z.number().describe('Span kind from OpenTelemetry'),

    // Timing
    startTime: z.number().describe('Start timestamp (milliseconds)'),
    endTime: z.number().describe('End timestamp (milliseconds)'),
    duration: z.number().optional().describe('Calculated duration (ms)'),

    // Status and data
    status: z
        .object({
            code: z.number(),
            message: z.string().optional(),
        })
        .describe('Span status (ok, error, unset)'),
    attributes: z.record(z.any()).describe('Span attributes (metadata)'),
    events: z.array(z.any()).describe('Span events'),
    links: z.array(z.any()).describe('Links to other spans'),

    // Storage metadata
    createdAt: z.string().describe('ISO timestamp when stored'),
    other: z.record(z.any()).optional().describe('Additional metadata'),
});

/**
 * Stored trace with database-specific fields
 */
export const StoredTraceSchema = TraceSchema.extend({
    // Add index for faster queries
    sessionId: z.string().optional().describe('Session ID from attributes'),
    provider: z.string().optional().describe('LLM provider from attributes'),
    model: z.string().optional().describe('LLM model from attributes'),
    toolName: z.string().optional().describe('Tool name from attributes'),
    errorMessage: z.string().optional().describe('Error message if failed'),
});

export type Trace = z.infer<typeof TraceSchema>;
export type StoredTrace = z.infer<typeof StoredTraceSchema>;

/**
 * Convert OpenTelemetry ReadableSpan to our Trace format
 */
export function spanToTrace(span: ReadableSpan): Trace {
    const spanContext = span.spanContext();
    const startTime = Number(span.startTime[0]) * 1000 + Math.floor(span.startTime[1] / 1_000_000);
    const endTime = Number(span.endTime[0]) * 1000 + Math.floor(span.endTime[1] / 1_000_000);

    return {
        id: spanContext.spanId,
        traceId: spanContext.traceId,
        parentSpanId: span.parentSpanId,
        name: span.name,
        scope: span.instrumentationLibrary.name,
        kind: span.kind,
        startTime,
        endTime,
        duration: endTime - startTime,
        status: {
            code: span.status.code,
            message: span.status.message,
        },
        attributes: span.attributes as Record<string, any>,
        events: span.events,
        links: span.links,
        createdAt: new Date().toISOString(),
    };
}

/**
 * Enhance Trace with indexed fields for faster queries
 */
export function traceToStoredTrace(trace: Trace): StoredTrace {
    const attrs = trace.attributes || {};

    return {
        ...trace,
        sessionId: (attrs.sessionId || attrs['baggage.sessionId']) as string | undefined,
        // Extract provider and model from llm.provider and llm.model attributes
        // Fall back to provider/model for backward compatibility
        provider: (attrs['llm.provider'] || attrs.provider) as string | undefined,
        model: (attrs['llm.model'] || attrs.model) as string | undefined,
        // Extract tool name from tool.name attribute (for MCP tools) or fall back to toolName
        toolName: (attrs['tool.name'] || attrs.toolName) as string | undefined,
        errorMessage: trace.status.code !== 0 ? trace.status.message || 'Unknown error' : undefined,
    };
}

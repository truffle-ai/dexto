import type { ReadableSpan } from '@opentelemetry/sdk-trace-base';

/**
 * Trace data structure for storage/retrieval
 * Used by telemetry storage exporters for persisting trace data
 */
export type Trace = {
    id: string;
    parentSpanId: string;
    name: string;
    traceId: string;
    scope: string;
    kind: ReadableSpan['kind'];
    attributes: ReadableSpan['attributes'];
    status: ReadableSpan['status'];
    events: ReadableSpan['events'];
    links: ReadableSpan['links'];
    other: Record<string, any>;
    startTime: number;
    endTime: number;
    createdAt: string;
};

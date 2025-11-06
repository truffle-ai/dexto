import { Hono } from 'hono';
import type { ReadableSpan } from '@opentelemetry/sdk-trace-base';
import { TelemetryStorageExporter } from '../storage/telemetry-exporter.js';

/**
 * OTLP HTTP receiver that accepts traces from OpenTelemetry agents
 * Compatible with the OpenTelemetry Protocol (OTLP) HTTP spec
 */
export function createOtlpReceiver(exporter: TelemetryStorageExporter) {
    const app = new Hono();

    // OTLP HTTP endpoint - POST /v1/traces
    app.post('/v1/traces', async (c) => {
        try {
            const body = await c.req.json();

            // OTLP format: { resourceSpans: [...] }
            const resourceSpans = body.resourceSpans || [];

            // Extract spans from OTLP format
            const spans: any[] = [];
            for (const resourceSpan of resourceSpans) {
                for (const scopeSpan of resourceSpan.scopeSpans || []) {
                    for (const span of scopeSpan.spans || []) {
                        // Convert OTLP span to ReadableSpan format
                        spans.push(
                            convertOtlpSpanToReadable(span, resourceSpan.resource, scopeSpan.scope)
                        );
                    }
                }
            }

            // Export spans to storage
            if (spans.length > 0) {
                await new Promise<void>((resolve, reject) => {
                    exporter.export(spans as ReadableSpan[], (result) => {
                        if (result.code === 0) {
                            resolve();
                        } else {
                            reject(result.error || new Error('Export failed'));
                        }
                    });
                });

                console.log(`[OTLP] Received and stored ${spans.length} spans`);
            }

            // OTLP expects empty response on success
            return c.body(null, 200);
        } catch (error) {
            console.error('[OTLP] Failed to process traces:', error);
            return c.json({ error: 'Failed to process traces' }, 500);
        }
    });

    return app;
}

/**
 * Convert OTLP span format to ReadableSpan format
 * OTLP uses protobuf-like JSON format, we need to convert it
 */
function convertOtlpSpanToReadable(
    otlpSpan: any,
    resource: any,
    scope: any
): Partial<ReadableSpan> {
    // Convert OTLP timestamps (nanoseconds) to hrtime format [seconds, nanoseconds]
    const startTimeNano = BigInt(otlpSpan.startTimeUnixNano || 0);
    const endTimeNano = BigInt(otlpSpan.endTimeUnixNano || 0);

    const startSeconds = Number(startTimeNano / BigInt(1_000_000_000));
    const startNanos = Number(startTimeNano % BigInt(1_000_000_000));
    const endSeconds = Number(endTimeNano / BigInt(1_000_000_000));
    const endNanos = Number(endTimeNano % BigInt(1_000_000_000));

    // Convert OTLP attributes to key-value object
    const attributes: Record<string, any> = {};
    for (const attr of otlpSpan.attributes || []) {
        attributes[attr.key] = extractOtlpValue(attr.value);
    }

    // Add resource attributes
    for (const attr of resource?.attributes || []) {
        attributes[attr.key] = extractOtlpValue(attr.value);
    }

    return {
        name: otlpSpan.name,
        kind: otlpSpan.kind || 0,
        spanContext: () => ({
            spanId: otlpSpan.spanId || '',
            traceId: otlpSpan.traceId || '',
            traceFlags: otlpSpan.flags || 0,
        }),
        parentSpanId: otlpSpan.parentSpanId,
        startTime: [startSeconds, startNanos],
        endTime: [endSeconds, endNanos],
        status: {
            code: otlpSpan.status?.code || 0,
            message: otlpSpan.status?.message,
        },
        attributes,
        events: otlpSpan.events || [],
        links: otlpSpan.links || [],
        instrumentationLibrary: {
            name: scope?.name || 'unknown',
            version: scope?.version,
        },
    } as any;
}

/**
 * Extract value from OTLP AnyValue format
 */
function extractOtlpValue(value: any): any {
    if (!value) return undefined;

    if (value.stringValue !== undefined) return value.stringValue;
    if (value.intValue !== undefined) return Number(value.intValue);
    if (value.doubleValue !== undefined) return value.doubleValue;
    if (value.boolValue !== undefined) return value.boolValue;
    if (value.arrayValue !== undefined) {
        return value.arrayValue.values?.map(extractOtlpValue) || [];
    }
    if (value.kvlistValue !== undefined) {
        const obj: Record<string, any> = {};
        for (const kv of value.kvlistValue.values || []) {
            obj[kv.key] = extractOtlpValue(kv.value);
        }
        return obj;
    }

    return undefined;
}

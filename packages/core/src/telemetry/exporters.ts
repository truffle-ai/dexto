import { ExportResultCode } from '@opentelemetry/core';
import type { ExportResult } from '@opentelemetry/core';
import type { ReadableSpan, SpanExporter } from '@opentelemetry/sdk-trace-base';

/**
 * Normalizes URL paths for consistent comparison
 * Handles both full URLs and path-only strings
 * @param url - URL or path to normalize
 * @returns Normalized lowercase path without trailing slash
 */
function normalizeUrlPath(url: string): string {
    try {
        const parsedUrl = new URL(url);
        let pathname = parsedUrl.pathname.toLowerCase().trim();
        if (pathname.endsWith('/')) {
            pathname = pathname.slice(0, -1);
        }
        return pathname;
    } catch (_e) {
        // If it's not a valid URL, treat it as a path and normalize
        let path = url.toLowerCase().trim();
        if (path.endsWith('/')) {
            path = path.slice(0, -1);
        }
        return path;
    }
}

/**
 * CompositeExporter wraps multiple span exporters and provides two key features:
 *
 * 1. **Multi-exporter support**: Exports spans to multiple destinations in parallel
 *    (e.g., console for development + OTLP for production monitoring)
 *
 * 2. **Recursive telemetry filtering**: Prevents telemetry infinity loops by filtering
 *    out spans from `/api/telemetry` endpoints. Without this, telemetry API calls would
 *    generate spans, which would be exported via HTTP to `/api/telemetry`, generating
 *    more spans, creating an infinite loop.
 *
 * @example
 * ```typescript
 * const exporter = new CompositeExporter([
 *   new ConsoleSpanExporter(),
 *   new OTLPHttpExporter({ url: 'http://localhost:4318/v1/traces' })
 * ]);
 * ```
 */
export class CompositeExporter implements SpanExporter {
    private exporters: SpanExporter[];

    constructor(exporters: SpanExporter[]) {
        this.exporters = exporters;
    }

    export(spans: ReadableSpan[], resultCallback: (result: ExportResult) => void): void {
        // First collect all traceIds from telemetry endpoint spans
        const telemetryTraceIds = new Set(
            spans
                .filter((span) => {
                    const attrs = span.attributes || {};
                    const relevantHttpAttributes = [
                        attrs['http.target'],
                        attrs['http.route'],
                        attrs['http.url'],
                        attrs['url.path'],
                        attrs['http.request_path'],
                    ];

                    const isTelemetrySpan = relevantHttpAttributes.some((attr) => {
                        if (typeof attr === 'string') {
                            const normalizedPath = normalizeUrlPath(attr);
                            // Check for exact match or path prefix
                            return (
                                normalizedPath === '/api/telemetry' ||
                                normalizedPath.startsWith('/api/telemetry/')
                            );
                        }
                        return false;
                    });
                    return isTelemetrySpan;
                })
                .map((span) => span.spanContext().traceId)
        );

        // Then filter out any spans that have those traceIds
        const filteredSpans = spans.filter(
            (span) => !telemetryTraceIds.has(span.spanContext().traceId)
        );

        // Return early if no spans to export
        if (filteredSpans.length === 0) {
            resultCallback({ code: ExportResultCode.SUCCESS });
            return;
        }

        void Promise.all(
            this.exporters.map(
                (exporter) =>
                    new Promise<ExportResult>((resolve) => {
                        if (exporter.export) {
                            exporter.export(filteredSpans, resolve);
                        } else {
                            resolve({ code: ExportResultCode.FAILED });
                        }
                    })
            )
        )
            .then((results) => {
                const hasError = results.some((r) => r.code === ExportResultCode.FAILED);
                resultCallback({
                    code: hasError ? ExportResultCode.FAILED : ExportResultCode.SUCCESS,
                });
            })
            .catch((error) => {
                console.error('[CompositeExporter] Export error:', error);
                resultCallback({ code: ExportResultCode.FAILED });
            });
    }

    shutdown(): Promise<void> {
        return Promise.all(this.exporters.map((e) => e.shutdown?.() ?? Promise.resolve())).then(
            () => undefined
        );
    }

    forceFlush(): Promise<void> {
        return Promise.all(this.exporters.map((e) => e.forceFlush?.() ?? Promise.resolve())).then(
            () => undefined
        );
    }
}

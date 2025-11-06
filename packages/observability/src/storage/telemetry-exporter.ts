import { ExportResultCode } from '@opentelemetry/core';
import type { ExportResult } from '@opentelemetry/core';
import type { ReadableSpan, SpanExporter } from '@opentelemetry/sdk-trace-base';
import type { StorageManager } from '@dexto/core';
import { spanToTrace, traceToStoredTrace, type StoredTrace } from './schema.js';

export interface TelemetryStorageExporterOptions {
    /**
     * Retention period for traces (e.g., '7d', '30d', '90d')
     * @default '7d'
     */
    retention?: string;

    /**
     * Prefix for storage keys
     * @default 'trace:'
     */
    keyPrefix?: string;

    /**
     * Batch size for exports (spans are exported in batches)
     * @default 100
     */
    batchSize?: number;
}

/**
 * Custom OpenTelemetry exporter that persists spans to Dexto's storage layer.
 *
 * This exporter:
 * - Converts OpenTelemetry spans to Dexto Trace format
 * - Stores traces in the database with indexed fields
 * - Supports configurable retention periods
 * - Handles batch exports efficiently
 *
 * @example
 * ```typescript
 * const exporter = new TelemetryStorageExporter(storageManager, {
 *   retention: '7d',
 * });
 *
 * await Telemetry.init(config, exporter);
 * ```
 */
export class TelemetryStorageExporter implements SpanExporter {
    private storageManager: StorageManager;
    private options: Required<TelemetryStorageExporterOptions>;
    private isShutdown = false;

    constructor(storageManager: StorageManager, options: TelemetryStorageExporterOptions = {}) {
        this.storageManager = storageManager;
        this.options = {
            retention: options.retention || '7d',
            keyPrefix: options.keyPrefix || 'trace:',
            batchSize: options.batchSize || 100,
        };
    }

    /**
     * Export spans to database storage.
     * Called by OpenTelemetry SDK when spans are ready to be exported.
     */
    export(spans: ReadableSpan[], resultCallback: (result: ExportResult) => void): void {
        if (this.isShutdown) {
            resultCallback({
                code: ExportResultCode.FAILED,
                error: new Error('Exporter is shutdown'),
            });
            return;
        }

        // Convert and store spans asynchronously
        void this.exportSpans(spans)
            .then(() => {
                resultCallback({ code: ExportResultCode.SUCCESS });
            })
            .catch((error) => {
                console.error('[TelemetryStorageExporter] Export error:', error);
                resultCallback({
                    code: ExportResultCode.FAILED,
                    error: error instanceof Error ? error : new Error(String(error)),
                });
            });
    }

    /**
     * Internal method to export spans to storage.
     * Converts spans to traces and stores them in batches.
     */
    private async exportSpans(spans: ReadableSpan[]): Promise<void> {
        if (spans.length === 0) {
            return;
        }

        const database = this.storageManager.getDatabase();
        const traces: StoredTrace[] = [];

        // Convert spans to stored traces
        for (const span of spans) {
            try {
                const trace = spanToTrace(span);
                const storedTrace = traceToStoredTrace(trace);
                traces.push(storedTrace);
            } catch (error) {
                console.error('[TelemetryStorageExporter] Failed to convert span:', error);
                // Continue with other spans
            }
        }

        // Store traces in batches
        const batches = this.batchArray(traces, this.options.batchSize);

        for (const batch of batches) {
            await Promise.all(
                batch.map(async (trace) => {
                    const key = `${this.options.keyPrefix}${trace.id}`;
                    await database.set(key, trace);
                })
            );
        }
    }

    /**
     * Split array into batches
     */
    private batchArray<T>(array: T[], batchSize: number): T[][] {
        const batches: T[][] = [];
        for (let i = 0; i < array.length; i += batchSize) {
            batches.push(array.slice(i, i + batchSize));
        }
        return batches;
    }

    /**
     * Shutdown the exporter.
     * Flushes any pending spans and prevents further exports.
     */
    async shutdown(): Promise<void> {
        if (this.isShutdown) {
            return;
        }
        this.isShutdown = true;
        // No cleanup needed for database storage
    }

    /**
     * Force flush any pending spans.
     * Since we export synchronously, this is a no-op.
     */
    async forceFlush(): Promise<void> {
        // Spans are exported immediately in export(), no buffering
    }
}

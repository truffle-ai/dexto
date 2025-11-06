/**
 * Storage layer for persisting OpenTelemetry spans to database
 */

export { TelemetryStorageExporter } from './telemetry-exporter.js';
export { RetentionService } from './retention.js';
export type { Trace, StoredTrace } from './schema.js';
export { TraceSchema, StoredTraceSchema } from './schema.js';

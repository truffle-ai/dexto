// this file is used to link packages from core to our generated instrumentation file
// without this, the user will need to install all the packages manually

export { NodeSDK } from '@opentelemetry/sdk-node';
export { ConsoleSpanExporter } from '@opentelemetry/sdk-trace-node';
export { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
export { ATTR_SERVICE_NAME } from '@opentelemetry/semantic-conventions';
export { resourceFromAttributes } from '@opentelemetry/resources';
export { OTLPTraceExporter as OTLPHttpExporter } from '@opentelemetry/exporter-trace-otlp-http';
export { OTLPTraceExporter as OTLPGrpcExporter } from '@opentelemetry/exporter-trace-otlp-grpc';
export {
    ParentBasedSampler,
    TraceIdRatioBasedSampler,
    AlwaysOnSampler,
    AlwaysOffSampler,
} from '@opentelemetry/sdk-trace-base';
export type { Sampler } from '@opentelemetry/sdk-trace-base';
export { CompositeExporter } from './exporters.js';

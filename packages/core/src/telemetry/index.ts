export {
    Telemetry,
    type TelemetryRegistrationOptions,
    type TelemetryShutdownHandler,
} from './telemetry.js';
export { OtelConfigurationSchema } from './schemas.js';
export type { OtelConfiguration } from './schemas.js';
export { recordOperationSpan, type OperationSpanOptions } from './operation-span.js';

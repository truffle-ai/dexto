import { propagation, trace } from '@opentelemetry/api';
import type { Context } from '@opentelemetry/api';
import { Telemetry } from './telemetry.js';
import { logger } from '../logger/index.js';

// Helper function to check if telemetry is active
export function hasActiveTelemetry(): boolean {
    logger.debug('hasActiveTelemetry called.');
    try {
        const telemetryInstance = Telemetry.get();
        const isActive = telemetryInstance.isInitialized();
        logger.debug(`hasActiveTelemetry: Telemetry is initialized: ${isActive}`);
        return isActive;
    } catch (error) {
        logger.debug(
            `hasActiveTelemetry: Telemetry not active or initialized. Error: ${error instanceof Error ? error.message : String(error)}`
        );
        return false;
    }
} // Added missing closing brace for hasActiveTelemetry

/**
 * Get baggage values from context
 * @param ctx The context to get baggage values from
 * @returns
 */
export function getBaggageValues(ctx: Context) {
    logger.debug('getBaggageValues called.');
    const currentBaggage = propagation.getBaggage(ctx);
    const requestId = currentBaggage?.getEntry('http.request_id')?.value;
    const componentName = currentBaggage?.getEntry('componentName')?.value;
    const runId = currentBaggage?.getEntry('runId')?.value;
    const threadId = currentBaggage?.getEntry('threadId')?.value;
    const resourceId = currentBaggage?.getEntry('resourceId')?.value;
    logger.debug(
        `getBaggageValues: Extracted - requestId: ${requestId}, componentName: ${componentName}, runId: ${runId}, threadId: ${threadId}, resourceId: ${resourceId}`
    );
    return {
        requestId,
        componentName,
        runId,
        threadId,
        resourceId,
    };
}

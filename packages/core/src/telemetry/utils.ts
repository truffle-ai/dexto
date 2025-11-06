import { propagation } from '@opentelemetry/api';
import type { Context, Span } from '@opentelemetry/api';
import { Telemetry } from './telemetry.js';
import { noOpLogger } from '../logger/v2/noop-logger.js';

// Helper function to check if telemetry is active
export function hasActiveTelemetry(): boolean {
    noOpLogger.silly('hasActiveTelemetry called.');
    try {
        const telemetryInstance = Telemetry.get();
        const isActive = telemetryInstance.isInitialized();
        noOpLogger.silly(`hasActiveTelemetry: Telemetry is initialized: ${isActive}`);
        return isActive;
    } catch (error) {
        noOpLogger.silly(
            `hasActiveTelemetry: Telemetry not active or initialized. Error: ${error instanceof Error ? error.message : String(error)}`
        );
        return false;
    }
}

/**
 * Get baggage values from context
 * @param ctx The context to get baggage values from
 * @returns
 */
export function getBaggageValues(ctx: Context) {
    noOpLogger.silly('getBaggageValues called.');
    const currentBaggage = propagation.getBaggage(ctx);
    const requestId = currentBaggage?.getEntry('http.request_id')?.value;
    const componentName = currentBaggage?.getEntry('componentName')?.value;
    const runId = currentBaggage?.getEntry('runId')?.value;
    const threadId = currentBaggage?.getEntry('threadId')?.value;
    const resourceId = currentBaggage?.getEntry('resourceId')?.value;
    noOpLogger.silly(
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

/**
 * Attaches baggage values from the given context to the provided span as attributes.
 * @param span The OpenTelemetry Span to add attributes to.
 * @param ctx The OpenTelemetry Context from which to extract baggage values.
 */
export function addBaggageAttributesToSpan(span: Span, ctx: Context): void {
    noOpLogger.debug('addBaggageAttributesToSpan called.');
    const { requestId, componentName, runId, threadId, resourceId } = getBaggageValues(ctx);

    if (componentName) {
        span.setAttribute('componentName', componentName);
    }
    if (runId) {
        span.setAttribute('runId', runId);
    }
    if (requestId) {
        span.setAttribute('http.request_id', requestId);
    }
    if (threadId) {
        span.setAttribute('threadId', threadId);
    }
    if (resourceId) {
        span.setAttribute('resourceId', resourceId);
    }
    noOpLogger.debug('addBaggageAttributesToSpan: Baggage attributes added to span.');
}

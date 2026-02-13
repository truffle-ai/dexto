import { propagation } from '@opentelemetry/api';
import type { Context, Span } from '@opentelemetry/api';
import { Telemetry } from './telemetry.js';
import type { Logger } from '../logger/v2/types.js';

// Helper function to check if telemetry is active
export function hasActiveTelemetry(logger?: Logger): boolean {
    logger?.silly('hasActiveTelemetry called.');
    try {
        const telemetryInstance = Telemetry.get();
        const isActive = telemetryInstance.isInitialized();
        logger?.silly(`hasActiveTelemetry: Telemetry is initialized: ${isActive}`);
        return isActive;
    } catch (error) {
        logger?.silly(
            `hasActiveTelemetry: Telemetry not active or initialized. Error: ${error instanceof Error ? error.message : String(error)}`
        );
        return false;
    }
}

/**
 * Get baggage values from context
 * @param ctx The context to get baggage values from
 * @param logger Optional logger instance
 * @returns
 */
export function getBaggageValues(ctx: Context, logger?: Logger) {
    logger?.silly('getBaggageValues called.');
    const currentBaggage = propagation.getBaggage(ctx);
    const requestId = currentBaggage?.getEntry('http.request_id')?.value;
    const componentName = currentBaggage?.getEntry('componentName')?.value;
    const runId = currentBaggage?.getEntry('runId')?.value;
    const threadId = currentBaggage?.getEntry('threadId')?.value;
    const resourceId = currentBaggage?.getEntry('resourceId')?.value;
    const sessionId = currentBaggage?.getEntry('sessionId')?.value;
    logger?.silly(
        `getBaggageValues: Extracted - requestId: ${requestId}, componentName: ${componentName}, runId: ${runId}, threadId: ${threadId}, resourceId: ${resourceId}, sessionId: ${sessionId}`
    );
    return {
        requestId,
        componentName,
        runId,
        threadId,
        resourceId,
        sessionId,
    };
}

/**
 * Attaches baggage values from the given context to the provided span as attributes.
 * @param span The OpenTelemetry Span to add attributes to.
 * @param ctx The OpenTelemetry Context from which to extract baggage values.
 * @param logger Optional logger instance
 */
export function addBaggageAttributesToSpan(span: Span, ctx: Context, logger?: Logger): void {
    logger?.debug('addBaggageAttributesToSpan called.');
    const { requestId, componentName, runId, threadId, resourceId, sessionId } = getBaggageValues(
        ctx,
        logger
    );

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
    if (sessionId) {
        span.setAttribute('sessionId', sessionId);
    }
    logger?.debug('addBaggageAttributesToSpan: Baggage attributes added to span.');
}

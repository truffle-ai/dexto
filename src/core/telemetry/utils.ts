import { propagation } from '@opentelemetry/api';
import type { Context, Span } from '@opentelemetry/api';
import { Telemetry } from './telemetry.js';
import { logger } from '../logger/index.js';

/**
 * Returns whether a Telemetry instance is active/initialized.
 *
 * Attempts to read the global Telemetry instance and returns its initialization state.
 * If the Telemetry instance is not available or an error occurs while checking, this
 * function returns `false`.
 *
 * @returns `true` when telemetry is initialized; otherwise `false`.
 */
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
 * Extracts commonly used baggage entries from an OpenTelemetry Context.
 *
 * Reads the baggage from `ctx` and returns the values (if present) for
 * the keys: `http.request_id`, `componentName`, `runId`, `threadId`, and `resourceId`.
 *
 * @param ctx - OpenTelemetry Context to read baggage from
 * @returns An object with any of the extracted baggage values:
 * - `requestId`, `componentName`, `runId`, `threadId`, `resourceId` (each may be `undefined`)
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

/**
 * Adds baggage-derived values from the provided OpenTelemetry context to the given span as attributes.
 *
 * Extracts these baggage keys and sets the corresponding span attributes when a value is present:
 * - `http.request_id` -> `http.request_id`
 * - `componentName` -> `componentName`
 * - `runId` -> `runId`
 * - `threadId` -> `threadId`
 * - `resourceId` -> `resourceId`
 *
 * @param span - The OpenTelemetry Span to add attributes to.
 * @param ctx - The OpenTelemetry Context to read baggage values from.
 */
export function addBaggageAttributesToSpan(span: Span, ctx: Context): void {
    logger.debug('addBaggageAttributesToSpan called.');
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
    logger.debug('addBaggageAttributesToSpan: Baggage attributes added to span.');
}

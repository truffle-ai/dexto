import type { WebSocket } from 'ws';
import { DextoRuntimeError } from '@core/errors/DextoRuntimeError.js';
import { DextoValidationError } from '@core/errors/DextoValidationError.js';
import { ErrorType } from '@core/errors/types.js';
import { ZodError } from 'zod';
import { zodToIssues } from '@core/utils/result.js';
import { logger } from '@core/logger/index.js';

/**
 * Standardized WebSocket error handler that mirrors HTTP error middleware
 * Sends consistent error messages over WebSocket following the same patterns as REST API
 */
export function sendWebSocketError(ws: WebSocket, error: unknown): void {
    let errorData: any;

    if (error instanceof DextoRuntimeError) {
        errorData = error.toJSON();
    } else if (error instanceof DextoValidationError) {
        errorData = error.toJSON();
    } else if (error instanceof ZodError) {
        const issues = zodToIssues(error);
        const dexErr = new DextoValidationError(issues);
        errorData = dexErr.toJSON();
    } else {
        // Log unexpected errors for debugging
        const errorMessage = error instanceof Error ? error.message : String(error);
        logger.error(`Unhandled WebSocket error: ${errorMessage}`);

        // Generic error response for non-DextoError exceptions
        errorData = {
            code: 'internal_error',
            message: 'An unexpected error occurred',
            scope: 'system',
            type: 'system',
            severity: 'error',
        };
    }

    // Send error event with structured data
    ws.send(
        JSON.stringify({
            event: 'error',
            data: errorData,
        })
    );
}

/**
 * Helper to send validation error for WebSocket input
 */
export function sendWebSocketValidationError(
    ws: WebSocket,
    message: string,
    context?: Record<string, unknown>
): void {
    const errorData = {
        code: 'validation_error',
        message,
        scope: 'user_input',
        type: ErrorType.USER,
        severity: 'error',
        context,
    };

    ws.send(
        JSON.stringify({
            event: 'error',
            data: errorData,
        })
    );
}

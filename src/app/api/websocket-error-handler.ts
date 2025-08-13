import type { WebSocket } from 'ws';
import { DextoRuntimeError } from '@core/errors/DextoRuntimeError.js';
import { DextoValidationError } from '@core/errors/DextoValidationError.js';
import { ErrorType, ErrorScope } from '@core/errors/types.js';
import { AgentErrorCode } from '@core/agent/error-codes.js';
import { ZodError } from 'zod';
import { zodToIssues } from '@core/utils/result.js';
import { logger } from '@core/logger/index.js';

/**
 * Standardized WebSocket error handler that mirrors HTTP error middleware
 * Sends consistent error messages over WebSocket following the same patterns as REST API
 */
export function sendWebSocketError(ws: WebSocket, error: unknown): void {
    let errorData: Record<string, unknown>;

    if (error instanceof DextoRuntimeError) {
        errorData = error.toJSON();
    } else if (error instanceof DextoValidationError) {
        errorData = error.toJSON();
    } else if (error instanceof ZodError) {
        const issues = zodToIssues(error);
        const dexErr = new DextoValidationError(issues);
        errorData = dexErr.toJSON();
    } else {
        // Log unexpected errors with full context for debugging (mirror HTTP middleware)
        const errorMessage = error instanceof Error ? error.message : String(error);
        const errorStack = error instanceof Error ? error.stack : undefined;
        logger.error(`Unhandled WebSocket error: ${errorMessage}`, {
            error: error,
            stack: errorStack,
            type: typeof error,
        });

        // Generic error response for non-DextoError exceptions (mirror HTTP middleware)
        errorData = {
            code: 'internal_error',
            message: 'An unexpected error occurred',
            scope: ErrorScope.AGENT,
            type: ErrorType.SYSTEM,
            severity: 'error',
        };
    }

    // Send error event with structured data (guard against closed sockets)
    try {
        ws.send(
            JSON.stringify({
                event: 'error',
                data: errorData,
            })
        );
    } catch (sendErr) {
        const msg = sendErr instanceof Error ? sendErr.message : String(sendErr);
        logger.error(`Failed to send WebSocket error frame: ${msg}`, { errorData });
    }
}

/**
 * Helper to send validation error for WebSocket input
 */
export function sendWebSocketValidationError(
    ws: WebSocket,
    message: string,
    context?: Record<string, unknown>
): void {
    const dexErr = new DextoValidationError([
        {
            code: AgentErrorCode.API_VALIDATION_ERROR,
            message,
            scope: ErrorScope.AGENT,
            type: ErrorType.USER,
            severity: 'error',
            context,
        },
    ]);

    const data = dexErr.toJSON();

    try {
        ws.send(
            JSON.stringify({
                event: 'error',
                data,
            })
        );
    } catch (sendErr) {
        const msg = sendErr instanceof Error ? sendErr.message : String(sendErr);
        logger.error(`Failed to send WebSocket validation error: ${msg}`, { data });
    }
}

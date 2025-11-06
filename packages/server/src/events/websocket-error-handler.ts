import type { WebSocket } from 'ws';
import {
    DextoRuntimeError,
    DextoValidationError,
    ErrorType,
    ErrorScope,
    AgentErrorCode,
} from '@dexto/core';
import { ZodError } from 'zod';
import { zodToIssues, toError } from '@dexto/core';
import { noOpLogger } from '@dexto/core';

/**
 * TODO: temporarily DUPE OF cli
 * Standardized WebSocket error handler that mirrors HTTP error middleware
 * Sends consistent error messages over WebSocket following the same patterns as REST API
 *
 * TODO: Add typed WebSocket payload interfaces to replace manual JSON structure creation
 */
export function sendWebSocketError(ws: WebSocket, error: unknown, sessionId: string): void {
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
        const errorObj = toError(error);
        const errorStack = error instanceof Error ? error.stack : undefined;
        noOpLogger.error(`Unhandled WebSocket error: ${errorObj.message}`, {
            error: error,
            stack: errorStack,
            type: typeof error,
        });

        // Generic error response for non-DextoError exceptions - include actual error details
        errorData = {
            code: 'internal_error',
            message: errorObj.message,
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
                data: {
                    ...errorData,
                    ...(sessionId ? { sessionId } : {}),
                },
            })
        );
    } catch (sendErr) {
        const msg = sendErr instanceof Error ? sendErr.message : String(sendErr);
        noOpLogger.error(`Failed to send WebSocket error frame: ${msg}`, { errorData });
    }
}

/**
 * Helper to send validation error for WebSocket input
 */
export function sendWebSocketValidationError(
    ws: WebSocket,
    message: string,
    sessionId: string,
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
    noOpLogger.error(`Sending WebSocket validation error: ${message}`, { data });

    try {
        ws.send(
            JSON.stringify({
                event: 'error',
                data: {
                    ...data,
                    ...(sessionId ? { sessionId } : {}),
                },
            })
        );
    } catch (sendErr) {
        const msg = sendErr instanceof Error ? sendErr.message : String(sendErr);
        noOpLogger.error(`Failed to send WebSocket validation error: ${msg}`, { data });
    }
}

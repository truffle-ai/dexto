import { DextoError } from '@core/error/DextoError.js';
import { ErrorScope, ErrorType } from '@core/error/types.js';
import { AgentErrorCode } from './error-codes.js';

/**
 * Agent-specific error factory
 * Creates properly typed errors for Agent operations
 */
export class AgentError {
    /**
     * LLM input missing (model/provider not specified)
     */
    static llmInputMissing() {
        return new DextoError(
            AgentErrorCode.LLM_INPUT_MISSING,
            ErrorScope.AGENT,
            ErrorType.USER,
            'At least model or provider must be specified',
            undefined,
            'Provide either a model name or provider in your LLM configuration'
        );
    }

    /**
     * Agent not started
     */
    static notStarted() {
        return new DextoError(
            AgentErrorCode.NOT_STARTED,
            ErrorScope.AGENT,
            ErrorType.USER,
            'Agent must be started before use',
            undefined,
            'Call agent.start() before using other methods'
        );
    }

    /**
     * Session not found
     */
    static sessionNotFound(sessionId: string) {
        return new DextoError(
            AgentErrorCode.SESSION_NOT_FOUND,
            ErrorScope.AGENT,
            ErrorType.NOT_FOUND,
            `Session ${sessionId} not found`,
            { sessionId },
            'Use an existing session ID or create a new session'
        );
    }

    /**
     * Configuration invalid
     */
    static configInvalid(message: string, details?: unknown) {
        return new DextoError(
            AgentErrorCode.CONFIG_INVALID,
            ErrorScope.AGENT,
            ErrorType.USER,
            message,
            details,
            'Fix the configuration errors and try again'
        );
    }

    /**
     * Agent initialization failed
     */
    static initializationFailed(reason: string, details?: unknown) {
        return new DextoError(
            AgentErrorCode.INITIALIZATION_FAILED,
            ErrorScope.AGENT,
            ErrorType.SYSTEM,
            `Agent initialization failed: ${reason}`,
            details,
            'Check logs for initialization errors'
        );
    }

    /**
     * Run operation failed
     */
    static runFailed(reason: string, details?: unknown) {
        return new DextoError(
            AgentErrorCode.RUN_FAILED,
            ErrorScope.AGENT,
            ErrorType.SYSTEM,
            `Agent run failed: ${reason}`,
            details
        );
    }
}

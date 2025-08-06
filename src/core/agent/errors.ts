import { DextoRuntimeError } from '@core/errors/DextoRuntimeError.js';
import { ErrorScope, ErrorType } from '@core/errors/types.js';
import { AgentErrorCode } from './error-codes.js';

/**
 * Agent-specific error factory
 * Creates properly typed errors for Agent operations
 * Note: Domain-specific errors (LLM, Session, MCP) have been moved to their respective modules
 */
export class AgentError {
    /**
     * Agent not started
     */
    static notStarted() {
        return new DextoRuntimeError(
            AgentErrorCode.NOT_STARTED,
            ErrorScope.AGENT,
            ErrorType.USER,
            'Agent must be started before use',
            undefined,
            'Call agent.start() before using other methods'
        );
    }

    /**
     * Configuration invalid
     */
    static configInvalid(message: string, details?: unknown) {
        return new DextoRuntimeError(
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
        return new DextoRuntimeError(
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
        return new DextoRuntimeError(
            AgentErrorCode.RUN_FAILED,
            ErrorScope.AGENT,
            ErrorType.SYSTEM,
            `Agent run failed: ${reason}`,
            details
        );
    }
}

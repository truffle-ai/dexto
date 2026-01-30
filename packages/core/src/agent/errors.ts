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
     * Agent already started
     */
    static alreadyStarted() {
        return new DextoRuntimeError(
            AgentErrorCode.ALREADY_STARTED,
            ErrorScope.AGENT,
            ErrorType.USER,
            'Agent is already started',
            undefined,
            'Call agent.stop() before starting again'
        );
    }

    /**
     * Agent stopped
     */
    static stopped() {
        return new DextoRuntimeError(
            AgentErrorCode.STOPPED,
            ErrorScope.AGENT,
            ErrorType.USER,
            'Agent has been stopped and cannot be used',
            undefined,
            'Create a new agent instance or restart this one'
        );
    }

    /**
     * Agent switch in progress
     */
    static switchInProgress() {
        return new DextoRuntimeError(
            AgentErrorCode.SWITCH_IN_PROGRESS,
            ErrorScope.AGENT,
            ErrorType.CONFLICT,
            'Agent switch already in progress',
            undefined,
            'Wait for the current switch operation to complete before starting a new one'
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
     * No config path available
     */
    static noConfigPath() {
        return new DextoRuntimeError(
            AgentErrorCode.NO_CONFIG_PATH,
            ErrorScope.AGENT,
            ErrorType.SYSTEM,
            'No configuration file path is available',
            undefined,
            'Agent was created without a config file path, cannot perform file operations'
        );
    }

    /**
     * API validation error
     */
    static apiValidationError(message: string, details?: unknown) {
        return new DextoRuntimeError(
            AgentErrorCode.API_VALIDATION_ERROR,
            ErrorScope.AGENT,
            ErrorType.USER,
            message,
            details,
            'Check the request parameters and try again'
        );
    }

    /**
     * Stream failed with unexpected error
     */
    static streamFailed(message: string, details?: unknown) {
        return new DextoRuntimeError(
            AgentErrorCode.STREAM_FAILED,
            ErrorScope.AGENT,
            ErrorType.SYSTEM,
            message,
            details,
            'Check logs for details'
        );
    }
}

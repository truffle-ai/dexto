import { DextoRuntimeError, ErrorScope, ErrorType } from '@dexto/core';
import { RuntimeErrorCode } from './error-codes.js';

/**
 * Runtime error factory methods
 * Creates properly typed errors for agent runtime operations
 */
export class RuntimeError {
    // Limit errors
    static maxAgentsExceeded(currentCount: number, maxAllowed: number) {
        return new DextoRuntimeError(
            RuntimeErrorCode.MAX_AGENTS_EXCEEDED,
            ErrorScope.AGENT,
            ErrorType.USER,
            `Maximum agents limit exceeded. Current: ${currentCount}, Max: ${maxAllowed}`,
            { currentCount, maxAllowed },
            'Stop some existing agents before spawning new ones'
        );
    }

    // Agent lifecycle errors
    static agentNotFound(agentId: string) {
        return new DextoRuntimeError(
            RuntimeErrorCode.AGENT_NOT_FOUND,
            ErrorScope.AGENT,
            ErrorType.NOT_FOUND,
            `Agent '${agentId}' not found`,
            { agentId },
            'Ensure the agent ID is correct and the agent has been spawned'
        );
    }

    static agentAlreadyExists(agentId: string) {
        return new DextoRuntimeError(
            RuntimeErrorCode.AGENT_ALREADY_EXISTS,
            ErrorScope.AGENT,
            ErrorType.USER,
            `Agent with ID '${agentId}' already exists`,
            { agentId },
            'Use a different agent ID or stop the existing agent first'
        );
    }

    static agentNotStarted(agentId: string) {
        return new DextoRuntimeError(
            RuntimeErrorCode.AGENT_NOT_STARTED,
            ErrorScope.AGENT,
            ErrorType.USER,
            `Agent '${agentId}' has not been started`,
            { agentId },
            'Start the agent before executing tasks'
        );
    }

    static agentAlreadyStopped(agentId: string) {
        return new DextoRuntimeError(
            RuntimeErrorCode.AGENT_ALREADY_STOPPED,
            ErrorScope.AGENT,
            ErrorType.USER,
            `Agent '${agentId}' has already been stopped`,
            { agentId },
            'Spawn a new agent if you need to continue'
        );
    }

    // Spawn errors
    static spawnFailed(cause: string, agentId?: string) {
        return new DextoRuntimeError(
            RuntimeErrorCode.SPAWN_FAILED,
            ErrorScope.AGENT,
            ErrorType.SYSTEM,
            agentId
                ? `Failed to spawn agent '${agentId}': ${cause}`
                : `Failed to spawn agent: ${cause}`,
            { agentId, cause },
            'Check the agent configuration and try again'
        );
    }

    static invalidConfig(message: string, details?: Record<string, unknown>) {
        return new DextoRuntimeError(
            RuntimeErrorCode.INVALID_CONFIG,
            ErrorScope.AGENT,
            ErrorType.USER,
            `Invalid agent configuration: ${message}`,
            details ?? {},
            'Check the configuration and ensure all required fields are provided'
        );
    }

    // Task execution errors
    static taskTimeout(agentId: string, timeoutMs: number) {
        return new DextoRuntimeError(
            RuntimeErrorCode.TASK_TIMEOUT,
            ErrorScope.AGENT,
            ErrorType.TIMEOUT,
            `Task execution timed out for agent '${agentId}' after ${timeoutMs}ms`,
            { agentId, timeoutMs },
            'Increase the timeout or simplify the task'
        );
    }

    static taskFailed(agentId: string, cause: string) {
        return new DextoRuntimeError(
            RuntimeErrorCode.TASK_FAILED,
            ErrorScope.AGENT,
            ErrorType.SYSTEM,
            `Task execution failed for agent '${agentId}': ${cause}`,
            { agentId, cause },
            'Check the task requirements and agent configuration'
        );
    }

    static taskCancelled(agentId: string) {
        return new DextoRuntimeError(
            RuntimeErrorCode.TASK_CANCELLED,
            ErrorScope.AGENT,
            ErrorType.USER,
            `Task execution was cancelled for agent '${agentId}'`,
            { agentId },
            'The task was cancelled by user or system request'
        );
    }
}

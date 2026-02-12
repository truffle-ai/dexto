import { DextoRuntimeError, ErrorScope, ErrorType } from '@dexto/core';
import { AgentSpawnerErrorCode } from './error-codes.js';

/**
 * Agent Spawner tools factory error methods
 */
export class AgentSpawnerError {
    static spawningDisabled() {
        return new DextoRuntimeError(
            AgentSpawnerErrorCode.SPAWNING_DISABLED,
            ErrorScope.TOOLS,
            ErrorType.USER,
            'Agent spawning is disabled in configuration',
            {},
            'Enable spawning in the agent-spawner tool configuration'
        );
    }

    static spawnFailed(cause: string) {
        return new DextoRuntimeError(
            AgentSpawnerErrorCode.SPAWN_FAILED,
            ErrorScope.TOOLS,
            ErrorType.SYSTEM,
            `Failed to spawn sub-agent: ${cause}`,
            { cause },
            'Check the configuration and try again'
        );
    }

    static agentNotFound(agentId: string) {
        return new DextoRuntimeError(
            AgentSpawnerErrorCode.AGENT_NOT_FOUND,
            ErrorScope.TOOLS,
            ErrorType.NOT_FOUND,
            `Sub-agent '${agentId}' not found`,
            { agentId },
            'Ensure the agent ID is correct and the agent is still active'
        );
    }

    static taskFailed(agentId: string, cause: string) {
        return new DextoRuntimeError(
            AgentSpawnerErrorCode.TASK_FAILED,
            ErrorScope.TOOLS,
            ErrorType.SYSTEM,
            `Task execution failed for agent '${agentId}': ${cause}`,
            { agentId, cause },
            'Check the task requirements and try again'
        );
    }

    static invalidConfig(message: string) {
        return new DextoRuntimeError(
            AgentSpawnerErrorCode.INVALID_CONFIG,
            ErrorScope.TOOLS,
            ErrorType.USER,
            `Invalid agent spawner configuration: ${message}`,
            {},
            'Check the configuration and ensure all required fields are provided'
        );
    }
}

/**
 * Runtime-specific error codes
 * Includes errors for agent spawning, lifecycle management, and task execution
 */

export const RUNTIME_ERROR_CODES = [
    'runtime_max_agents_exceeded',
    'runtime_agent_not_found',
    'runtime_agent_already_exists',
    'runtime_agent_not_started',
    'runtime_agent_already_stopped',
    'runtime_spawn_failed',
    'runtime_invalid_config',
    'runtime_task_timeout',
    'runtime_task_failed',
    'runtime_task_cancelled',
] as const;

export type RuntimeErrorCode = (typeof RUNTIME_ERROR_CODES)[number];

const RuntimeErrorCodeValues = {
    // Limit errors
    MAX_AGENTS_EXCEEDED: 'runtime_max_agents_exceeded',

    // Agent lifecycle errors
    AGENT_NOT_FOUND: 'runtime_agent_not_found',
    AGENT_ALREADY_EXISTS: 'runtime_agent_already_exists',
    AGENT_NOT_STARTED: 'runtime_agent_not_started',
    AGENT_ALREADY_STOPPED: 'runtime_agent_already_stopped',

    // Spawn errors
    SPAWN_FAILED: 'runtime_spawn_failed',
    INVALID_CONFIG: 'runtime_invalid_config',

    // Task execution errors
    TASK_TIMEOUT: 'runtime_task_timeout',
    TASK_FAILED: 'runtime_task_failed',
    TASK_CANCELLED: 'runtime_task_cancelled',
} as const satisfies Record<string, RuntimeErrorCode>;

export { RuntimeErrorCodeValues as RuntimeErrorCode };

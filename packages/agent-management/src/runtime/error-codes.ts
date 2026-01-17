/**
 * Runtime-specific error codes
 * Includes errors for agent spawning, lifecycle management, and task execution
 */
export enum RuntimeErrorCode {
    // Limit errors
    MAX_AGENTS_EXCEEDED = 'runtime_max_agents_exceeded',

    // Agent lifecycle errors
    AGENT_NOT_FOUND = 'runtime_agent_not_found',
    AGENT_ALREADY_EXISTS = 'runtime_agent_already_exists',
    AGENT_NOT_STARTED = 'runtime_agent_not_started',
    AGENT_ALREADY_STOPPED = 'runtime_agent_already_stopped',

    // Spawn errors
    SPAWN_FAILED = 'runtime_spawn_failed',
    INVALID_CONFIG = 'runtime_invalid_config',

    // Task execution errors
    TASK_TIMEOUT = 'runtime_task_timeout',
    TASK_FAILED = 'runtime_task_failed',
    TASK_CANCELLED = 'runtime_task_cancelled',
}

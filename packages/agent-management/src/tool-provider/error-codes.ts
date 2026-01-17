/**
 * Agent Spawner Tool Error Codes
 */
export enum AgentSpawnerErrorCode {
    // Spawning errors
    SPAWNING_DISABLED = 'agent_spawner_spawning_disabled',
    SPAWN_FAILED = 'agent_spawner_spawn_failed',

    // Agent errors
    AGENT_NOT_FOUND = 'agent_spawner_agent_not_found',

    // Task errors
    TASK_FAILED = 'agent_spawner_task_failed',

    // Configuration errors
    INVALID_CONFIG = 'agent_spawner_invalid_config',
}

/**
 * Agent Spawner Tools Factory Error Codes
 */

export const AGENT_SPAWNER_ERROR_CODES = [
    'agent_spawner_spawning_disabled',
    'agent_spawner_spawn_failed',
    'agent_spawner_agent_not_found',
    'agent_spawner_task_failed',
    'agent_spawner_invalid_config',
] as const;

export type AgentSpawnerErrorCode = (typeof AGENT_SPAWNER_ERROR_CODES)[number];

// eslint-disable-next-line @typescript-eslint/no-redeclare
export const AgentSpawnerErrorCode = {
    // Spawning errors
    SPAWNING_DISABLED: 'agent_spawner_spawning_disabled',
    SPAWN_FAILED: 'agent_spawner_spawn_failed',

    // Agent errors
    AGENT_NOT_FOUND: 'agent_spawner_agent_not_found',

    // Task errors
    TASK_FAILED: 'agent_spawner_task_failed',

    // Configuration errors
    INVALID_CONFIG: 'agent_spawner_invalid_config',
} as const;

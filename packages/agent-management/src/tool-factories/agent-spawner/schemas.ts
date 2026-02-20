/**
 * Agent Spawner Tools Factory Schemas
 *
 * Zod schemas for the agent spawner tools factory configuration and inputs.
 */

import { z } from 'zod';

// ============================================================================
// Factory Configuration Schema
// ============================================================================

/**
 * Configuration schema for the agent spawner tools factory.
 */
export const AgentSpawnerConfigSchema = z
    .object({
        /** Type discriminator for the factory */
        type: z.literal('agent-spawner'),

        /** Maximum concurrent sub-agents this parent can spawn (default: 5) */
        maxConcurrentAgents: z
            .number()
            .int()
            .positive()
            .default(5)
            .describe('Maximum concurrent sub-agents'),

        /** Default timeout for task execution in milliseconds (default: 1200000 = 20 minutes) */
        defaultTimeout: z
            .number()
            .int()
            .nonnegative()
            .default(1_200_000)
            .describe('Default task timeout in milliseconds (0 = no timeout)'),

        /** Whether spawning is enabled (default: true) */
        allowSpawning: z.boolean().default(true).describe('Whether agent spawning is enabled'),

        /**
         * List of agent IDs from the registry that this parent can spawn.
         * If not provided, any registry agent can be spawned.
         *
         * Example:
         * ```yaml
         * customTools:
         *   - type: agent-spawner
         *     allowedAgents: ["explore-agent", "research-agent"]
         * ```
         */
        allowedAgents: z
            .array(z.string().min(1))
            .optional()
            .describe('Agent IDs from registry that can be spawned (omit to allow all)'),

        /**
         * Agent IDs that should have their tools auto-approved.
         * Use for agents with only read-only/safe tools (e.g., explore-agent).
         *
         * Example:
         * ```yaml
         * customTools:
         *   - type: agent-spawner
         *     allowedAgents: ["explore-agent"]
         *     autoApproveAgents: ["explore-agent"]
         * ```
         */
        autoApproveAgents: z
            .array(z.string().min(1))
            .optional()
            .describe('Agent IDs that should have tools auto-approved (read-only agents)'),
    })
    .strict()
    .describe('Configuration for the agent spawner tools factory');

export type AgentSpawnerConfig = z.output<typeof AgentSpawnerConfigSchema>;

// ============================================================================
// Tool Input Schemas
// ============================================================================

/**
 * Input schema for spawn_agent tool
 *
 * Note: Timeout is configured at the provider level (defaultTimeout in config).
 * We don't expose timeout as a tool parameter because lowering it just wastes runs.
 */
export const SpawnAgentInputSchema = z
    .object({
        /** Short task description (shown in UI/logs) */
        task: z.string().min(1).describe('Short task description for UI/logs'),

        /** Detailed instructions for the sub-agent */
        instructions: z
            .string()
            .min(1)
            .describe('Detailed instructions for the sub-agent to execute'),

        /** Agent ID from registry (optional - uses default minimal agent if not provided) */
        agentId: z.string().min(1).optional().describe('Agent ID from registry'),
    })
    .strict();

export type SpawnAgentInput = z.output<typeof SpawnAgentInputSchema>;

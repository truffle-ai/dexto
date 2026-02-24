/**
 * Agent Spawner Tools Factory Schemas
 *
 * Zod schemas for the agent spawner tools factory configuration and inputs.
 */

import { REASONING_PRESETS, type ReasoningPreset } from '@dexto/core';
import { z } from 'zod';

// ============================================================================
// Factory Configuration Schema
// ============================================================================

export const DEFAULT_SUB_AGENT_MAX_ITERATIONS = 100;
export const DEFAULT_SUB_AGENT_REASONING_PRESET: ReasoningPreset = 'off';

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

        /** Default timeout for task execution in milliseconds (default: 3600000 = 1 hour) */
        defaultTimeout: z
            .number()
            .int()
            .nonnegative()
            .default(3_600_000)
            .describe('Default task timeout in milliseconds (0 = no timeout)'),

        subAgentMaxIterations: z
            .number()
            .int()
            .positive()
            .default(DEFAULT_SUB_AGENT_MAX_ITERATIONS)
            .describe(
                'Max outer-loop tool-call iterations for spawned sub-agents. ' +
                    'Acts as a safety cap to prevent runaway exploration.'
            ),

        subAgentReasoningPreset: z
            .enum(REASONING_PRESETS)
            .default(DEFAULT_SUB_AGENT_REASONING_PRESET)
            .describe(
                'Reasoning tuning preset applied to spawned sub-agents. ' +
                    "Default is 'off' to keep sub-agents fast and lightweight."
            ),

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

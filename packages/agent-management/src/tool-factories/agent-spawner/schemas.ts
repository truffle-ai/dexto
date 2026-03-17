/**
 * Agent Spawner Tools Factory Schemas
 *
 * Zod schemas for the agent spawner tools factory configuration and inputs.
 */

import type { ReasoningVariant } from '@dexto/core';
import { z } from 'zod';

// ============================================================================
// Factory Configuration Schema
// ============================================================================

export const DEFAULT_SUB_AGENT_MAX_ITERATIONS = 100;
export const DEFAULT_SUB_AGENT_REASONING_VARIANT: ReasoningVariant = 'disabled';

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

        subAgentReasoningVariant: z
            .string()
            .trim()
            .min(1)
            .default(DEFAULT_SUB_AGENT_REASONING_VARIANT)
            .describe(
                'Preferred reasoning variant for spawned sub-agents. ' +
                    "Default is 'disabled'. If unsupported by the resolved model, Dexto falls back to the lowest available variant."
            ),

        /** Whether spawning is enabled (default: true) */
        allowSpawning: z.boolean().default(true).describe('Whether agent spawning is enabled'),

        /**
         * List of agent IDs that this parent can spawn from the current inventory.
         * The current inventory is workspace agents by default, plus global agents
         * only when the workspace registry opts into them.
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
            .describe(
                'Agent IDs from the resolved inventory that can be spawned (omit to allow all in-scope agents)'
            ),

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

/**
 * Agent Spawner Tool Provider Schemas
 *
 * Zod schemas for the agent spawner tool provider configuration and inputs.
 */

import { z } from 'zod';

// ============================================================================
// Provider Configuration Schema
// ============================================================================

/**
 * Configuration schema for the agent spawner tool provider
 */
export const AgentSpawnerConfigSchema = z
    .object({
        /** Type discriminator for the provider */
        type: z.literal('agent-spawner'),

        /** Maximum concurrent sub-agents this parent can spawn (default: 5) */
        maxConcurrentAgents: z
            .number()
            .int()
            .positive()
            .default(5)
            .describe('Maximum concurrent sub-agents'),

        /** Default timeout for task execution in milliseconds (default: 300000 = 5 min) */
        defaultTimeout: z
            .number()
            .int()
            .positive()
            .default(300000)
            .describe('Default task timeout in milliseconds'),

        /** Whether spawning is enabled (default: true) */
        allowSpawning: z.boolean().default(true).describe('Whether agent spawning is enabled'),

        /**
         * Named agent configurations that can be spawned by reference.
         * Each entry can be either a simple path string or an object with path and description.
         *
         * Example:
         * ```yaml
         * agents:
         *   # Simple format - just the path
         *   research: "./my-research-agent.yml"
         *
         *   # Full format - with description (shown to LLM in tool description)
         *   explore:
         *     path: "agents/explore-agent/explore-agent.yml"
         *     description: "Lightweight read-only agent for codebase exploration"
         * ```
         */
        agents: z
            .record(
                z.union([
                    z.string().min(1),
                    z.object({
                        path: z.string().min(1).describe('Path to agent config file'),
                        description: z
                            .string()
                            .optional()
                            .describe('Description shown to LLM in spawn_agent tool'),
                    }),
                ])
            )
            .optional()
            .describe('Named agent configurations that can be spawned by reference'),
    })
    .strict()
    .describe('Configuration for the agent spawner tool provider');

export type AgentSpawnerConfig = z.output<typeof AgentSpawnerConfigSchema>;

// ============================================================================
// Tool Input Schemas
// ============================================================================

/**
 * Input schema for spawn_agent tool
 */
export const SpawnAgentInputSchema = z
    .object({
        /** Task description for the sub-agent to execute */
        task: z.string().min(1).describe('Task description for the sub-agent'),

        /**
         * Reference to a named agent configuration.
         * Must match a key in the `agents` map of the agent-spawner config.
         * When provided, the sub-agent uses the referenced config instead of inheriting from parent.
         *
         * Example: "explore" to use the explore agent for codebase exploration
         */
        agentRef: z
            .string()
            .min(1)
            .optional()
            .describe('Reference to a named agent configuration from the agents map'),

        /** Optional custom system prompt for the sub-agent (ignored if agentRef is provided) */
        systemPrompt: z
            .string()
            .optional()
            .describe('Custom system prompt for the sub-agent (ignored if agentRef is provided)'),

        /** Optional timeout in milliseconds */
        timeout: z.number().int().positive().optional().describe('Task timeout in milliseconds'),
    })
    .strict();

export type SpawnAgentInput = z.output<typeof SpawnAgentInputSchema>;

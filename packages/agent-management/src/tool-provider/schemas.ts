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

        /** Optional custom system prompt for the sub-agent */
        systemPrompt: z.string().optional().describe('Custom system prompt for the sub-agent'),

        /** Optional timeout in milliseconds */
        timeout: z.number().int().positive().optional().describe('Task timeout in milliseconds'),
    })
    .strict();

export type SpawnAgentInput = z.output<typeof SpawnAgentInputSchema>;

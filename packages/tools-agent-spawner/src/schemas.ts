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

        /** Whether to destroy the agent after task completion (default: true) */
        ephemeral: z.boolean().default(true).describe('Destroy agent after task completion'),

        /** Optional timeout in milliseconds */
        timeout: z.number().int().positive().optional().describe('Task timeout in milliseconds'),
    })
    .strict();

export type SpawnAgentInput = z.output<typeof SpawnAgentInputSchema>;

/**
 * Input schema for delegate_task tool
 */
export const DelegateTaskInputSchema = z
    .object({
        /** ID of the sub-agent to delegate to */
        agentId: z.string().min(1).describe('ID of the sub-agent'),

        /** Task to execute */
        task: z.string().min(1).describe('Task to execute'),

        /** Optional timeout in milliseconds */
        timeout: z.number().int().positive().optional().describe('Task timeout in milliseconds'),
    })
    .strict();

export type DelegateTaskInput = z.output<typeof DelegateTaskInputSchema>;

/**
 * Input schema for get_agent_status tool
 */
export const GetAgentStatusInputSchema = z
    .object({
        /** ID of the sub-agent */
        agentId: z.string().min(1).describe('ID of the sub-agent'),
    })
    .strict();

export type GetAgentStatusInput = z.output<typeof GetAgentStatusInputSchema>;

/**
 * Input schema for stop_agent tool
 */
export const StopAgentInputSchema = z
    .object({
        /** ID of the sub-agent to stop */
        agentId: z.string().min(1).describe('ID of the sub-agent to stop'),
    })
    .strict();

export type StopAgentInput = z.output<typeof StopAgentInputSchema>;

/**
 * Input schema for list_agents tool (no parameters needed)
 */
export const ListAgentsInputSchema = z.object({}).strict();

export type ListAgentsInput = z.output<typeof ListAgentsInputSchema>;

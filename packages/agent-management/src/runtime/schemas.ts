/**
 * Agent Runtime Schemas
 *
 * Zod schemas for validating runtime configuration and inputs.
 */

import { z } from 'zod';

// ============================================================================
// Constants
// ============================================================================

export const DEFAULT_MAX_AGENTS = 20;
export const DEFAULT_TASK_TIMEOUT = 300000; // 5 minutes

// ============================================================================
// Runtime Configuration Schema
// ============================================================================

/**
 * Schema for AgentRuntime configuration
 */
export const AgentRuntimeConfigSchema = z
    .object({
        maxAgents: z
            .number()
            .int()
            .positive()
            .default(DEFAULT_MAX_AGENTS)
            .describe('Maximum total agents managed by this runtime'),

        defaultTaskTimeout: z
            .number()
            .int()
            .positive()
            .default(DEFAULT_TASK_TIMEOUT)
            .describe('Default task timeout in milliseconds'),
    })
    .strict()
    .describe('Configuration for the AgentRuntime');

export type ValidatedAgentRuntimeConfig = z.output<typeof AgentRuntimeConfigSchema>;

// ============================================================================
// Spawn Configuration Schema
// ============================================================================

/**
 * Schema for SpawnConfig
 * Note: agentConfig is not validated here as it uses the agent-config AgentConfigSchema
 */
export const SpawnConfigSchema = z
    .object({
        agentConfig: z.record(z.unknown()).describe('Base agent configuration'),

        ephemeral: z
            .boolean()
            .default(true)
            .describe('Whether agent should be destroyed after task completion'),

        agentId: z
            .string()
            .min(1)
            .optional()
            .describe('Optional custom agent ID (auto-generated if not provided)'),

        group: z
            .string()
            .min(1)
            .optional()
            .describe('Optional group identifier for logical grouping'),

        metadata: z
            .record(z.unknown())
            .optional()
            .describe('Optional metadata for tracking relationships or context'),
    })
    .strict()
    .describe('Configuration for spawning an agent');

export type ValidatedSpawnConfig = z.output<typeof SpawnConfigSchema>;

// ============================================================================
// Agent Status Schema
// ============================================================================

/**
 * Schema for AgentStatus
 */
export const AgentStatusSchema = z.enum([
    'starting',
    'idle',
    'running',
    'stopping',
    'stopped',
    'error',
]);

export type ValidatedAgentStatus = z.output<typeof AgentStatusSchema>;

// ============================================================================
// Agent Filter Schema
// ============================================================================

/**
 * Schema for AgentFilter
 */
export const AgentFilterSchema = z
    .object({
        group: z.string().optional().describe('Filter by group'),

        status: z
            .union([AgentStatusSchema, z.array(AgentStatusSchema)])
            .optional()
            .describe('Filter by status'),

        ephemeral: z.boolean().optional().describe('Filter by ephemeral flag'),
    })
    .strict()
    .describe('Filter options for listing agents');

export type ValidatedAgentFilter = z.output<typeof AgentFilterSchema>;

/**
 * Agent registry types and interfaces
 */

import { z } from 'zod';

// TODO: Ideally, we should unify this with the agentCard schema to have a consistent agent type for all discovery use cases.
// Base schema for agent metadata
const BaseAgentSchema = z.object({
    name: z.string().describe('Unique identifier for the agent'),
    displayName: z.string().describe('Human-readable display name'),
    description: z.string().describe("Brief description of the agent's purpose"),
    version: z.string().describe('Agent version'),
    author: z.string().optional().describe('Author/maintainer information'),
    tags: z.array(z.string()).optional().describe('Tags for categorization'),
    lastUpdated: z.string().optional().describe('Last update timestamp'),
});

// Schema for raw agent data from JSON file (what's stored in agent-registry.json)
export const RawAgentDataSchema = BaseAgentSchema.extend({
    configFile: z
        .string()
        .describe('Relative path to the agent configuration (from agents directory)'),
}).strict();

export type RawAgentData = z.output<typeof RawAgentDataSchema>;

// Schema for processed agent registry entries with resolved absolute paths
export const AgentRegistryEntrySchema = BaseAgentSchema.extend({
    configFile: z.string().describe('Absolute path to the agent configuration file'),
}).strict();

export type AgentRegistryEntry = z.output<typeof AgentRegistryEntrySchema>;

export interface AgentRegistry {
    /** Get all available agents */
    listAgents(): Promise<AgentRegistryEntry[]>;

    /** Get a specific agent by name */
    getAgent(name: string): Promise<AgentRegistryEntry | null>;

    /** Check if an agent exists in the registry */
    hasAgent(name: string): Promise<boolean>;

    /** Resolve an agent name/path to a config path */
    resolveAgent(nameOrPath: string): Promise<string>;
}

export const AgentRegistryConfigSchema = z
    .object({
        cacheTtl: z
            .number()
            .positive()
            .describe('Cache TTL for remote agents (in seconds)')
            .default(3600),
    })
    .strict();

export type AgentRegistryConfig = z.output<typeof AgentRegistryConfigSchema>;

import { z } from 'zod';

/**
 * Schema for agent data in registry JSON
 */
export const RawAgentDataSchema = z
    .object({
        description: z.string(),
        author: z.string(),
        tags: z.array(z.string()),
        source: z.string(),
        main: z.string().optional(),
    })
    .strict();

export type RawAgentData = z.output<typeof RawAgentDataSchema>;

/**
 * Schema for complete registry JSON
 */
export const RegistrySchema = z
    .object({
        version: z.string(),
        agents: z.record(z.string(), RawAgentDataSchema),
    })
    .strict();

export type Registry = z.output<typeof RegistrySchema>;

/**
 * Agent registry interface
 */
export interface AgentRegistry {
    resolveAgent(nameOrPath: string, injectPreferences?: boolean): Promise<string>;
}

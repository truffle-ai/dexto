import { z } from 'zod';

/**
 * Schema for agent data in registry JSON
 */
export const AgentRegistryEntrySchema = z
    .object({
        description: z.string(),
        author: z.string(),
        tags: z.array(z.string()),
        source: z.string(),
        main: z.string().optional(),
    })
    .strict();

export type AgentRegistryEntry = z.output<typeof AgentRegistryEntrySchema>;

/**
 * Schema for complete registry JSON
 */
export const RegistrySchema = z
    .object({
        version: z.string(),
        agents: z.record(z.string(), AgentRegistryEntrySchema),
    })
    .strict();

export type Registry = z.output<typeof RegistrySchema>;

/**
 * Agent registry interface
 */
export interface AgentRegistry {
    /**
     * Returns true if the registry contains an agent with the provided name
     */
    hasAgent(name: string): boolean;
    /**
     * Returns a map of available agent names to their registry entries
     */
    getAvailableAgents(): Record<string, AgentRegistryEntry>;
    /**
     * Installs an agent from the registry
     */
    installAgent(agentName: string, injectPreferences?: boolean): Promise<string>;
    /**
     * Uninstalls an agent
     */
    uninstallAgent(agentName: string, force?: boolean): Promise<void>;
    /**
     * Returns list of currently installed agents
     */
    getInstalledAgents(): Promise<string[]>;
    /**
     * Resolves and installs/copies the agent; returns the installed path (or main file)
     */
    resolveAgent(
        nameOrPath: string,
        autoInstall?: boolean,
        injectPreferences?: boolean
    ): Promise<string>;
}

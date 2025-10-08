import { z } from 'zod';

export function deriveDisplayName(slug: string): string {
    return slug
        .split('-')
        .filter(Boolean)
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join(' ');
}

/**
 * Schema for agent data in registry JSON
 */
export const AgentRegistryEntrySchema = z
    .object({
        id: z.string().describe('Unique identifier for the agent'),
        name: z.string().describe('Display name for the agent'),
        description: z.string(),
        author: z.string(),
        tags: z.array(z.string()),
        source: z.string(),
        main: z.string().optional(),
        type: z.enum(['builtin', 'custom']).default('builtin').describe('Agent type'),
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

type RawRegistry = {
    version?: unknown;
    agents?: Record<string, unknown> | unknown;
};

/**
 * Normalize legacy registry JSON data to the latest schema before parsing.
 * Ensures required fields like `id` and `name` are populated even if
 * they were omitted by older versions of the CLI/WebUI.
 */
export function normalizeRegistryJson(raw: unknown): RawRegistry {
    if (!raw || typeof raw !== 'object') {
        return { agents: {} };
    }

    const input = raw as RawRegistry;
    const normalizedAgents: Record<string, unknown> = {};

    const agents =
        input.agents && typeof input.agents === 'object' && input.agents !== null
            ? (input.agents as Record<string, unknown>)
            : {};

    for (const [slug, value] of Object.entries(agents)) {
        if (!value || typeof value !== 'object') continue;

        const entry = { ...(value as Record<string, unknown>) };

        const id = typeof entry.id === 'string' && entry.id.trim().length > 0 ? entry.id : slug;
        entry.id = id;

        const name =
            typeof entry.name === 'string' && entry.name.trim().length > 0
                ? entry.name
                : deriveDisplayName(id);
        entry.name = name;

        normalizedAgents[slug] = entry;
    }

    return {
        version:
            typeof input.version === 'string' && input.version.trim().length > 0
                ? input.version
                : '1.0.0',
        agents: normalizedAgents,
    } satisfies RawRegistry;
}

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

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
 * Normalize registry JSON data to ensure consistency.
 * Validates that id field matches the registry key and derives display names if missing.
 */
export function normalizeRegistryJson(raw: unknown): RawRegistry {
    if (!raw || typeof raw !== 'object') {
        return { version: '1.0.0', agents: {} };
    }

    const input = raw as RawRegistry;
    const normalizedAgents: Record<string, unknown> = {};

    const agents =
        input.agents && typeof input.agents === 'object' && input.agents !== null
            ? (input.agents as Record<string, unknown>)
            : {};

    for (const [agentId, value] of Object.entries(agents)) {
        if (!value || typeof value !== 'object') continue;

        const entry = { ...(value as Record<string, unknown>) };

        // Ensure id field exists and matches the key
        if (!entry.id || typeof entry.id !== 'string' || entry.id.trim() !== agentId) {
            entry.id = agentId;
        }

        // Derive display name if missing
        if (!entry.name || typeof entry.name !== 'string' || !entry.name.trim()) {
            entry.name = deriveDisplayName(agentId);
        }

        normalizedAgents[agentId] = entry;
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
     * Returns true if the registry contains an agent with the provided ID
     */
    hasAgent(agentId: string): boolean;
    /**
     * Returns a map of available agent IDs to their registry entries
     */
    getAvailableAgents(): Record<string, AgentRegistryEntry>;
    /**
     * Installs an agent from the registry by ID
     * @param agentId - Unique agent identifier
     * @returns Path to the installed agent config
     */
    installAgent(agentId: string): Promise<string>;
    /**
     * Uninstalls an agent by ID
     * @param agentId - Unique agent identifier
     * @param force - Whether to force uninstall protected agents (default: false)
     */
    uninstallAgent(agentId: string, force?: boolean): Promise<void>;
    /**
     * Returns list of currently installed agent IDs
     */
    getInstalledAgents(): Promise<string[]>;
    /**
     * Resolves an agent ID or path and optionally auto-installs if needed
     * @param idOrPath - Agent ID from registry or filesystem path
     * @param autoInstall - Whether to auto-install from registry (default: true)
     * @returns Path to the agent config file
     */
    resolveAgent(idOrPath: string, autoInstall?: boolean): Promise<string>;
}

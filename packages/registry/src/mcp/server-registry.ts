/**
 * MCP Server Registry Service
 *
 * Provides access to the built-in registry of MCP servers.
 * This is a shared service used by both CLI and WebUI.
 */

import type { ServerRegistryEntry, ServerRegistryFilter } from './types.js';
import builtinRegistryData from './server-registry-data.json' with { type: 'json' };

/**
 * Normalize an ID for comparison
 */
function normalizeId(s: string): string {
    return s
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
}

/**
 * MCP Server Registry Service
 *
 * Manages a registry of available MCP servers that can be quickly added to agents.
 * The built-in registry data is loaded from an external JSON file.
 */
export class ServerRegistryService {
    private static instance: ServerRegistryService;
    private registryEntries: ServerRegistryEntry[] = [];
    private isInitialized = false;

    private constructor() {
        // Private constructor for singleton
    }

    static getInstance(): ServerRegistryService {
        if (!ServerRegistryService.instance) {
            ServerRegistryService.instance = new ServerRegistryService();
        }
        return ServerRegistryService.instance;
    }

    /**
     * Initialize the registry with default entries
     */
    async initialize(): Promise<void> {
        if (this.isInitialized) return;

        // Load built-in registry entries from JSON file
        this.registryEntries = builtinRegistryData as ServerRegistryEntry[];
        this.isInitialized = true;
    }

    /**
     * Get all registry entries with optional filtering
     */
    async getEntries(filter?: ServerRegistryFilter): Promise<ServerRegistryEntry[]> {
        await this.initialize();

        let filtered = [...this.registryEntries];

        if (filter?.category) {
            filtered = filtered.filter((entry) => entry.category === filter.category);
        }

        if (filter?.tags?.length) {
            filtered = filtered.filter((entry) =>
                filter.tags!.some((tag) => entry.tags.includes(tag))
            );
        }

        if (filter?.search) {
            const searchLower = filter.search.toLowerCase();
            filtered = filtered.filter(
                (entry) =>
                    entry.name.toLowerCase().includes(searchLower) ||
                    entry.description.toLowerCase().includes(searchLower) ||
                    entry.tags.some((tag) => tag.toLowerCase().includes(searchLower))
            );
        }

        if (filter?.installed !== undefined) {
            filtered = filtered.filter((entry) => entry.isInstalled === filter.installed);
        }

        if (filter?.official !== undefined) {
            filtered = filtered.filter((entry) => entry.isOfficial === filter.official);
        }

        return filtered.sort((a, b) => {
            // Sort by: installed first, then official, then name
            if (a.isInstalled !== b.isInstalled) {
                return a.isInstalled ? -1 : 1;
            }
            if (a.isOfficial !== b.isOfficial) {
                return a.isOfficial ? -1 : 1;
            }
            return a.name.localeCompare(b.name);
        });
    }

    /**
     * Update an existing registry entry's state
     */
    async updateEntry(id: string, updates: Partial<ServerRegistryEntry>): Promise<boolean> {
        await this.initialize();
        const entry = this.registryEntries.find((e) => e.id === id);
        if (!entry) return false;

        // Use Object.assign to merge partial updates
        Object.assign(entry, updates);

        return true;
    }

    /**
     * Mark a server as installed/uninstalled
     */
    async setInstalled(id: string, installed: boolean): Promise<boolean> {
        return this.updateEntry(id, { isInstalled: installed });
    }

    /**
     * Sync registry installed status with a list of connected server IDs
     */
    async syncInstalledStatus(connectedServerIds: string[]): Promise<void> {
        await this.initialize();

        const normalizedIds = new Set(connectedServerIds.map(normalizeId));

        for (const entry of this.registryEntries) {
            const aliases = [entry.id, entry.name, ...(entry.matchIds || [])]
                .filter(Boolean)
                .map((x) => normalizeId(String(x)));

            const isInstalled = aliases.some((alias) => normalizedIds.has(alias));

            if (entry.isInstalled !== isInstalled) {
                entry.isInstalled = isInstalled;
            }
        }
    }

    /**
     * Get a single server configuration by ID
     */
    async getServerConfig(id: string): Promise<ServerRegistryEntry | null> {
        await this.initialize();
        return this.registryEntries.find((entry) => entry.id === id) || null;
    }

    /**
     * Get all available categories
     */
    async getCategories(): Promise<string[]> {
        await this.initialize();
        const categories = new Set(this.registryEntries.map((entry) => entry.category));
        return Array.from(categories).sort();
    }

    /**
     * Get all available tags
     */
    async getTags(): Promise<string[]> {
        await this.initialize();
        const tags = new Set(this.registryEntries.flatMap((entry) => entry.tags));
        return Array.from(tags).sort();
    }
}

/**
 * Get the singleton registry instance
 */
export function getServerRegistry(): ServerRegistryService {
    return ServerRegistryService.getInstance();
}

/**
 * Export singleton instance for convenience
 */
export const serverRegistry = ServerRegistryService.getInstance();

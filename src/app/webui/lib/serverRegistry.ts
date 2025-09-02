import type { ServerRegistryEntry, ServerRegistryFilter } from '@/types';
import builtinRegistryData from './server-registry-data.json';

/**
 * MCP Server Registry Service
 * Manages a registry of available MCP servers that can be quickly added to agents
 *
 * The built-in registry data is loaded from an external JSON file (server-registry-data.json)
 * to make it easy to add new servers without rebuilding the codebase.
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
     * Initialize the registry with default entries and load from external sources
     */
    async initialize(): Promise<void> {
        if (this.isInitialized) return;

        // Load built-in registry entries from external JSON file
        this.registryEntries = this.getBuiltinEntries();

        // Load custom entries from localStorage
        await this.loadCustomEntries();

        // TODO: Load from external registry sources (GitHub, npm, etc.)
        // await this.loadExternalRegistries();

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
     * Add a custom server to the registry
     */
    async addCustomEntry(
        entry: Omit<ServerRegistryEntry, 'id' | 'isOfficial'>
    ): Promise<ServerRegistryEntry> {
        const newEntry: ServerRegistryEntry = {
            ...entry,
            id: `custom-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            isOfficial: false,
        };

        this.registryEntries.push(newEntry);
        await this.saveCustomEntries();

        return newEntry;
    }

    /**
     * Update an existing registry entry
     */
    async updateEntry(id: string, updates: Partial<ServerRegistryEntry>): Promise<boolean> {
        const index = this.registryEntries.findIndex((entry) => entry.id === id);
        if (index === -1) return false;

        this.registryEntries[index] = {
            ...this.registryEntries[index],
            ...updates,
        };

        await this.saveCustomEntries();
        return true;
    }

    /**
     * Mark a server as installed/uninstalled
     */
    async setInstalled(id: string, installed: boolean): Promise<boolean> {
        return this.updateEntry(id, { isInstalled: installed });
    }

    /**
     * Sync registry installed status with current server states
     * This handles both disconnected and deleted servers
     */
    async syncWithServerStatus(): Promise<void> {
        try {
            // Fetch current server states
            const response = await fetch('/api/mcp/servers');
            if (!response.ok) return; // Graceful failure

            const data = await response.json();
            const servers = data.servers || [];

            // Create sets for connected and all server IDs
            const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-');
            const connectedIds = new Set<string>();
            const allServerIds = new Set<string>();

            servers.forEach((server: any) => {
                const normalizedId = normalize(server.id);
                allServerIds.add(normalizedId);
                if (server.status === 'connected') {
                    connectedIds.add(normalizedId);
                }
            });

            // Update registry entries based on server status
            let hasChanges = false;
            for (const entry of this.registryEntries) {
                const aliases = [entry.id, entry.name, ...(entry.matchIds || [])]
                    .filter(Boolean)
                    .map((x) => normalize(String(x)));

                const hasMatchingServer = aliases.some((alias) => allServerIds.has(alias));
                // Note: We could also track connection status separately in the future
                // const isConnected = aliases.some(alias => connectedIds.has(alias));

                // Update installed status:
                // - If no matching server exists, mark as uninstalled
                // - If server exists but is not connected, still consider as installed (just disconnected)
                // - If server is connected, mark as installed
                const shouldBeInstalled = hasMatchingServer;

                if (entry.isInstalled !== shouldBeInstalled) {
                    entry.isInstalled = shouldBeInstalled;
                    hasChanges = true;
                }
            }

            // Save changes if any were made
            if (hasChanges) {
                await this.saveCustomEntries();
            }
        } catch (error) {
            // Non-fatal error, log and continue
            console.warn('Failed to sync registry with server status:', error);
        }
    }

    /**
     * Get server configuration for connecting
     */
    async getServerConfig(id: string): Promise<ServerRegistryEntry | null> {
        await this.initialize();
        return this.registryEntries.find((entry) => entry.id === id) || null;
    }

    /**
     * Built-in registry entries for popular MCP servers
     * Loaded from external JSON file for easy maintenance
     */
    private getBuiltinEntries(): ServerRegistryEntry[] {
        return builtinRegistryData as ServerRegistryEntry[];
    }

    /**
     * Save custom entries to local storage
     */
    private async saveCustomEntries(): Promise<void> {
        const customEntries = this.registryEntries.filter((entry) => !entry.isOfficial);
        if (typeof window !== 'undefined') {
            localStorage.setItem('mcp-custom-servers', JSON.stringify(customEntries));
        }
    }

    /**
     * Load custom entries from local storage
     */
    private async loadCustomEntries(): Promise<void> {
        if (typeof window !== 'undefined') {
            const stored = localStorage.getItem('mcp-custom-servers');
            if (stored) {
                try {
                    const customEntries = JSON.parse(stored) as ServerRegistryEntry[];
                    // De-duplicate against existing built-ins by normalized aliases (id/name/matchIds)
                    const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-');
                    const existingAliases = new Set<string>();
                    for (const e of this.registryEntries) {
                        [e.id, e.name, ...((e.matchIds as string[] | undefined) || [])]
                            .filter(Boolean)
                            .map(normalize)
                            .forEach((a) => existingAliases.add(a));
                    }
                    const deduped = customEntries.filter((e) => {
                        const aliases = [
                            e.id,
                            e.name,
                            ...((e.matchIds as string[] | undefined) || []),
                        ]
                            .filter(Boolean)
                            .map(normalize);
                        return !aliases.some((a) => existingAliases.has(a));
                    });
                    this.registryEntries.push(...deduped);
                } catch (error) {
                    console.warn('Failed to load custom server entries:', error);
                }
            }
        }
    }
}

// Export singleton instance
export const serverRegistry = ServerRegistryService.getInstance();

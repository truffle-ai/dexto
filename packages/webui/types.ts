/**
 * Web UI-specific type definitions.
 * API response types are inferred from Hono client - do not duplicate them here.
 */

// MCP Server Registry types
export interface ServerRegistryEntry {
    id: string;
    name: string;
    description: string;
    category:
        | 'productivity'
        | 'development'
        | 'research'
        | 'creative'
        | 'data'
        | 'communication'
        | 'custom';
    icon?: string;
    author?: string;
    homepage?: string;
    config: {
        type: 'stdio' | 'sse' | 'http';
        command?: string;
        args?: string[];
        url?: string;
        baseUrl?: string;
        env?: Record<string, string>;
        headers?: Record<string, string>;
        timeout?: number;
    };
    tags: string[];
    isOfficial: boolean;
    isInstalled: boolean;
    requirements?: {
        platform?: 'win32' | 'darwin' | 'linux' | 'all';
        node?: string;
        python?: string;
        dependencies?: string[];
    };
    // Optional identifiers used to detect if this server is already connected
    matchIds?: string[];
}

export interface ServerRegistryFilter {
    category?: string;
    tags?: string[];
    search?: string;
    installed?: boolean;
    official?: boolean;
}

export interface ServerRegistryState {
    entries: ServerRegistryEntry[];
    isLoading: boolean;
    error?: string;
    lastUpdated?: Date;
}

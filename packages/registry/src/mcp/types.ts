/**
 * MCP Server Registry Types
 *
 * Defines types for the MCP server registry, which provides
 * preset server configurations for easy installation.
 */

/**
 * Server category for organization and filtering
 */
export type ServerCategory =
    | 'productivity'
    | 'development'
    | 'research'
    | 'creative'
    | 'data'
    | 'communication'
    | 'custom';

/**
 * Server configuration for different transport types
 */
export interface ServerConfig {
    type: 'stdio' | 'sse' | 'http';
    command?: string;
    args?: string[];
    url?: string;
    baseUrl?: string;
    env?: Record<string, string>;
    headers?: Record<string, string>;
    timeout?: number;
}

/**
 * Platform and dependency requirements for a server
 */
export interface ServerRequirements {
    platform?: 'win32' | 'darwin' | 'linux' | 'all';
    node?: string;
    python?: string;
    dependencies?: string[];
}

/**
 * A single entry in the MCP server registry
 */
export interface ServerRegistryEntry {
    /** Unique identifier for the server */
    id: string;
    /** Display name */
    name: string;
    /** Description of what the server does */
    description: string;
    /** Category for organization */
    category: ServerCategory;
    /** Emoji icon for display */
    icon?: string;
    /** Author or maintainer */
    author?: string;
    /** Homepage or documentation URL */
    homepage?: string;
    /** Server connection configuration */
    config: ServerConfig;
    /** Tags for search and filtering */
    tags: string[];
    /** Whether this is an official/verified server */
    isOfficial: boolean;
    /** Whether this server is currently installed (runtime state) */
    isInstalled: boolean;
    /** System requirements */
    requirements?: ServerRequirements;
    /** Alternative IDs used to match against connected servers */
    matchIds?: string[];
}

/**
 * Filter options for querying the registry
 */
export interface ServerRegistryFilter {
    category?: string;
    tags?: string[];
    search?: string;
    installed?: boolean;
    official?: boolean;
}

/**
 * State container for registry UI
 */
export interface ServerRegistryState {
    entries: ServerRegistryEntry[];
    isLoading: boolean;
    error?: string;
    lastUpdated?: Date;
}

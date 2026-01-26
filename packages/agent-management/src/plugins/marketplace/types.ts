/**
 * Plugin Marketplace Types
 *
 * Types for managing plugin marketplaces - repositories of plugins
 * that can be browsed and installed.
 */

/**
 * Type of marketplace source
 */
export type MarketplaceSourceType = 'github' | 'git' | 'local';

/**
 * Marketplace source specification
 */
export interface MarketplaceSource {
    /** Type of source */
    type: MarketplaceSourceType;
    /** Value: owner/repo for GitHub, URL for git, path for local */
    value: string;
}

/**
 * Entry in the known marketplaces registry
 */
export interface MarketplaceEntry {
    /** Unique name of the marketplace */
    name: string;
    /** Source specification */
    source: MarketplaceSource;
    /** Local path where marketplace is installed */
    installLocation: string;
    /** ISO timestamp of last update */
    lastUpdated?: string | undefined;
}

/**
 * Structure of known_marketplaces.json
 */
export interface KnownMarketplacesFile {
    /** File format version */
    version: number;
    /** Registered marketplaces by name */
    marketplaces: Record<string, MarketplaceEntry>;
}

/**
 * Plugin metadata from a marketplace
 */
export interface MarketplacePlugin {
    /** Plugin name */
    name: string;
    /** Plugin description */
    description?: string | undefined;
    /** Plugin version */
    version?: string | undefined;
    /** Plugin category */
    category?: string | undefined;
    /** Path within the marketplace */
    sourcePath: string;
    /** Marketplace this plugin belongs to */
    marketplace: string;
}

/**
 * Result of adding a marketplace
 */
export interface MarketplaceAddResult {
    /** Whether the operation succeeded */
    success: boolean;
    /** Name of the marketplace */
    name: string;
    /** Number of plugins found */
    pluginCount: number;
    /** Non-fatal warnings */
    warnings: string[];
}

/**
 * Result of removing a marketplace
 */
export interface MarketplaceRemoveResult {
    /** Whether the operation succeeded */
    success: boolean;
    /** Name of the marketplace removed */
    name: string;
}

/**
 * Result of updating a marketplace
 */
export interface MarketplaceUpdateResult {
    /** Whether the operation succeeded */
    success: boolean;
    /** Name of the marketplace */
    name: string;
    /** Previous git commit SHA (if applicable) */
    previousSha?: string | undefined;
    /** New git commit SHA (if applicable) */
    newSha?: string | undefined;
    /** Whether there were changes */
    hasChanges: boolean;
    /** Non-fatal warnings */
    warnings: string[];
}

/**
 * Result of installing a plugin from marketplace
 */
export interface MarketplaceInstallResult {
    /** Whether the operation succeeded */
    success: boolean;
    /** Name of the plugin installed */
    pluginName: string;
    /** Name of the marketplace it came from */
    marketplace: string;
    /** Local installation path */
    installPath: string;
    /** Git commit SHA at time of install */
    gitCommitSha?: string | undefined;
    /** Non-fatal warnings */
    warnings: string[];
}

/**
 * Options for adding a marketplace
 */
export interface MarketplaceAddOptions {
    /** Custom name for the marketplace (defaults to derived from source) */
    name?: string | undefined;
}

/**
 * Options for installing from marketplace
 */
export interface MarketplaceInstallOptions {
    /** Installation scope */
    scope?: 'user' | 'project' | 'local' | undefined;
    /** Project path for project-scoped installation */
    projectPath?: string | undefined;
    /** Force reinstall if already exists */
    force?: boolean | undefined;
}

/**
 * Marketplace manifest format (marketplace.json in repo root)
 * Compatible with Claude Code marketplace format
 */
export interface MarketplaceManifest {
    /** Marketplace name */
    name: string;
    /** Marketplace version */
    version?: string;
    /** Owner information */
    owner?: {
        name: string;
        email?: string;
    };
    /** List of plugins in the marketplace */
    plugins?: Array<{
        name: string;
        description?: string;
        source: string;
        category?: string;
        version?: string;
    }>;
}

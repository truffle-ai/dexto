/**
 * Plugin Marketplace Registry
 *
 * Manages the known_marketplaces.json file that tracks registered marketplaces.
 */

import * as path from 'path';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { homedir } from 'os';
import { KnownMarketplacesFileSchema } from './schemas.js';
import { MarketplaceError } from './errors.js';
import type { KnownMarketplacesFile, MarketplaceEntry, MarketplaceSource } from './types.js';

/**
 * Default marketplace configuration
 * Claude Code's official plugin marketplace is included by default
 */
export const DEFAULT_MARKETPLACES: Array<{
    name: string;
    source: MarketplaceSource;
}> = [
    {
        name: 'claude-plugins-official',
        source: {
            type: 'github',
            value: 'anthropics/claude-plugins-official',
        },
    },
];

/**
 * Get the path to known_marketplaces.json
 */
export function getMarketplacesRegistryPath(): string {
    return path.join(homedir(), '.dexto', 'plugins', 'known_marketplaces.json');
}

/**
 * Get the directory where marketplaces are cloned
 */
export function getMarketplacesDir(): string {
    return path.join(homedir(), '.dexto', 'plugins', 'marketplaces');
}

/**
 * Get the marketplace cache directory (for versioned plugin copies)
 */
export function getMarketplaceCacheDir(): string {
    return path.join(homedir(), '.dexto', 'plugins', 'cache');
}

/**
 * Load the known marketplaces registry
 */
export function loadKnownMarketplaces(): KnownMarketplacesFile {
    const filePath = getMarketplacesRegistryPath();

    if (!existsSync(filePath)) {
        return { version: 1, marketplaces: {} };
    }

    try {
        const content = readFileSync(filePath, 'utf-8');
        const parsed = JSON.parse(content);
        const result = KnownMarketplacesFileSchema.safeParse(parsed);

        if (!result.success) {
            // Invalid file - return fresh structure
            return { version: 1, marketplaces: {} };
        }

        return result.data as KnownMarketplacesFile;
    } catch {
        // File read/parse error - return fresh structure
        return { version: 1, marketplaces: {} };
    }
}

/**
 * Save the known marketplaces registry
 */
export function saveKnownMarketplaces(data: KnownMarketplacesFile): void {
    const filePath = getMarketplacesRegistryPath();
    const dirPath = path.dirname(filePath);

    // Ensure directory exists
    if (!existsSync(dirPath)) {
        mkdirSync(dirPath, { recursive: true });
    }

    try {
        writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
    } catch (error) {
        throw MarketplaceError.registryWriteFailed(
            filePath,
            error instanceof Error ? error.message : String(error)
        );
    }
}

/**
 * Get a specific marketplace entry by name
 */
export function getMarketplaceEntry(name: string): MarketplaceEntry | null {
    const registry = loadKnownMarketplaces();
    return registry.marketplaces[name] || null;
}

/**
 * Check if a marketplace exists by name
 */
export function marketplaceExists(name: string): boolean {
    return getMarketplaceEntry(name) !== null;
}

/**
 * Get all registered marketplaces
 */
export function getAllMarketplaces(): MarketplaceEntry[] {
    const registry = loadKnownMarketplaces();
    return Object.values(registry.marketplaces);
}

/**
 * Add a marketplace entry to the registry
 */
export function addMarketplaceEntry(entry: MarketplaceEntry): void {
    const registry = loadKnownMarketplaces();
    registry.marketplaces[entry.name] = entry;
    saveKnownMarketplaces(registry);
}

/**
 * Remove a marketplace entry from the registry
 */
export function removeMarketplaceEntry(name: string): boolean {
    const registry = loadKnownMarketplaces();

    if (!registry.marketplaces[name]) {
        return false;
    }

    delete registry.marketplaces[name];
    saveKnownMarketplaces(registry);
    return true;
}

/**
 * Update a marketplace entry's lastUpdated timestamp
 */
export function updateMarketplaceTimestamp(name: string): void {
    const registry = loadKnownMarketplaces();

    if (registry.marketplaces[name]) {
        registry.marketplaces[name].lastUpdated = new Date().toISOString();
        saveKnownMarketplaces(registry);
    }
}

/**
 * Get default marketplaces that are not yet installed
 * Returns entries with a special flag indicating they need to be added
 */
export function getUninstalledDefaults(): Array<{
    name: string;
    source: MarketplaceSource;
    isDefault: true;
}> {
    const registry = loadKnownMarketplaces();
    const uninstalled: Array<{
        name: string;
        source: MarketplaceSource;
        isDefault: true;
    }> = [];

    for (const defaultMarket of DEFAULT_MARKETPLACES) {
        if (!registry.marketplaces[defaultMarket.name]) {
            uninstalled.push({
                ...defaultMarket,
                isDefault: true,
            });
        }
    }

    return uninstalled;
}

/**
 * Check if a marketplace is a default marketplace
 */
export function isDefaultMarketplace(name: string): boolean {
    return DEFAULT_MARKETPLACES.some((m) => m.name === name);
}

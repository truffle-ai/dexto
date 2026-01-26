/**
 * Plugin Installation from Marketplace
 *
 * Handles installing plugins from registered marketplaces.
 */

import * as path from 'path';
import { existsSync, mkdirSync } from 'fs';
import { execSync } from 'child_process';
import { copyDirectory } from '../../utils/path.js';
import { getMarketplaceCacheDir, getMarketplaceEntry } from './registry.js';
import { findPluginInMarketplaces, scanMarketplacePlugins } from './operations.js';
import { MarketplaceError } from './errors.js';
import { installPluginFromPath } from '../install-plugin.js';
import type {
    MarketplaceInstallOptions,
    MarketplaceInstallResult,
    MarketplacePlugin,
} from './types.js';
import type { PluginInstallScope } from '../types.js';

/**
 * Parse a plugin spec (name or name@marketplace)
 */
export function parsePluginSpec(spec: string): { pluginName: string; marketplace?: string } {
    const atIndex = spec.lastIndexOf('@');

    // If @ is at position 0 or not found, no marketplace specified
    if (atIndex <= 0) {
        return { pluginName: spec };
    }

    return {
        pluginName: spec.substring(0, atIndex),
        marketplace: spec.substring(atIndex + 1),
    };
}

/**
 * Get the current git commit SHA in a directory
 */
function getGitSha(dir: string): string | undefined {
    try {
        const result = execSync('git rev-parse HEAD', {
            cwd: dir,
            encoding: 'utf-8',
            stdio: ['pipe', 'pipe', 'pipe'],
        });
        return result.trim();
    } catch {
        return undefined;
    }
}

/**
 * Get a short SHA (first 8 characters)
 */
function getShortSha(sha: string | undefined): string {
    if (!sha) return 'unknown';
    return sha.substring(0, 8);
}

/**
 * Install a plugin from a marketplace
 *
 * @param pluginSpec Plugin spec in format "name" or "name@marketplace"
 * @param options Installation options
 */
export async function installPluginFromMarketplace(
    pluginSpec: string,
    options: MarketplaceInstallOptions = {}
): Promise<MarketplaceInstallResult> {
    const { scope = 'user', projectPath, force = false } = options;
    const warnings: string[] = [];

    // Parse plugin spec
    const { pluginName, marketplace: specifiedMarketplace } = parsePluginSpec(pluginSpec);

    // Find the plugin
    let plugin: MarketplacePlugin | null = null;

    if (specifiedMarketplace) {
        // Verify marketplace exists
        const marketplaceEntry = getMarketplaceEntry(specifiedMarketplace);
        if (!marketplaceEntry) {
            throw MarketplaceError.installMarketplaceNotFound(specifiedMarketplace);
        }

        // Search in specific marketplace
        const plugins = scanMarketplacePlugins(
            marketplaceEntry.installLocation,
            marketplaceEntry.name
        );
        plugin = plugins.find((p) => p.name.toLowerCase() === pluginName.toLowerCase()) || null;

        if (!plugin) {
            throw MarketplaceError.installPluginNotFound(pluginName, specifiedMarketplace);
        }
    } else {
        // Search all marketplaces
        plugin = findPluginInMarketplaces(pluginName);

        if (!plugin) {
            throw MarketplaceError.installPluginNotFound(pluginName);
        }

        warnings.push(`Found plugin in marketplace: ${plugin.marketplace}`);
    }

    // Get git SHA from marketplace for version tracking
    const marketplaceEntry = getMarketplaceEntry(plugin.marketplace);
    let gitCommitSha: string | undefined;

    if (marketplaceEntry) {
        gitCommitSha = getGitSha(marketplaceEntry.installLocation);
    }

    // Determine cache path
    const cacheDir = getMarketplaceCacheDir();
    const shortSha = getShortSha(gitCommitSha);
    const cachePath = path.join(cacheDir, plugin.marketplace, plugin.name, shortSha);

    // Copy to cache if not already there
    if (!existsSync(cachePath)) {
        try {
            mkdirSync(cachePath, { recursive: true });
            await copyDirectory(plugin.sourcePath, cachePath);
        } catch (error) {
            throw MarketplaceError.installCopyFailed(
                pluginName,
                error instanceof Error ? error.message : String(error)
            );
        }
    }

    // Use existing install mechanism with cache path
    const installOptions = {
        scope: scope as PluginInstallScope,
        force,
        ...(projectPath !== undefined && { projectPath }),
    };
    const installResult = await installPluginFromPath(cachePath, installOptions);

    return {
        success: installResult.success,
        pluginName: installResult.pluginName,
        marketplace: plugin.marketplace,
        installPath: installResult.installPath,
        ...(gitCommitSha !== undefined && { gitCommitSha }),
        warnings: [...warnings, ...installResult.warnings],
    };
}

/**
 * Search for plugins by name pattern across all marketplaces
 */
export function searchMarketplacePlugins(
    query: string,
    marketplaceName?: string
): MarketplacePlugin[] {
    const lowerQuery = query.toLowerCase();

    let plugins: MarketplacePlugin[];

    if (marketplaceName) {
        const entry = getMarketplaceEntry(marketplaceName);
        if (!entry || !existsSync(entry.installLocation)) {
            return [];
        }
        plugins = scanMarketplacePlugins(entry.installLocation, entry.name);
    } else {
        // Import dynamically to avoid circular dependency
        const { listAllMarketplacePlugins } = require('./operations.js');
        plugins = listAllMarketplacePlugins();
    }

    // Filter by query (matches name or description)
    return plugins.filter((p) => {
        const nameMatch = p.name.toLowerCase().includes(lowerQuery);
        const descMatch = p.description?.toLowerCase().includes(lowerQuery);
        return nameMatch || descMatch;
    });
}

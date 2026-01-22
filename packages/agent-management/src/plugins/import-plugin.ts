/**
 * Plugin Import from Claude Code
 *
 * Imports Claude Code plugins into Dexto's registry without copying files.
 * This allows Dexto to use plugins installed via Claude Code.
 */

import * as path from 'path';
import { existsSync, readFileSync, readdirSync } from 'fs';
import { InstalledPluginsFileSchema } from './schemas.js';
import { loadDextoInstalledPlugins, saveDextoInstalledPlugins } from './install-plugin.js';
import { tryLoadManifest } from './validate-plugin.js';
import { PluginError } from './errors.js';
import type { ClaudeCodePlugin, PluginImportResult, InstalledPluginEntry } from './types.js';

/**
 * Gets the path to Claude Code's plugins directory
 */
export function getClaudeCodePluginsDir(): string | null {
    const homeDir = process.env.HOME || process.env.USERPROFILE || '';
    if (!homeDir) {
        return null;
    }
    return path.join(homeDir, '.claude', 'plugins');
}

/**
 * Gets the path to Claude Code's installed_plugins.json
 */
export function getClaudeCodeInstalledPluginsJsonPath(): string | null {
    const pluginsDir = getClaudeCodePluginsDir();
    if (!pluginsDir) {
        return null;
    }
    return path.join(pluginsDir, 'installed_plugins.json');
}

/**
 * Lists Claude Code plugins available for import.
 * Returns plugins from Claude Code that are not already imported into Dexto.
 */
export function listClaudeCodePlugins(): ClaudeCodePlugin[] {
    const plugins: ClaudeCodePlugin[] = [];
    const homeDir = process.env.HOME || process.env.USERPROFILE || '';

    if (!homeDir) {
        return plugins;
    }

    // Get already imported plugin paths from Dexto's registry
    const dextoInstalled = loadDextoInstalledPlugins();
    const importedPaths = new Set<string>();

    for (const installations of Object.values(dextoInstalled.plugins)) {
        for (const entry of installations) {
            if (entry.isImported) {
                importedPaths.add(entry.installPath.toLowerCase());
            }
        }
    }

    // Read from Claude Code's installed_plugins.json
    const installedPluginsPath = getClaudeCodeInstalledPluginsJsonPath();
    if (installedPluginsPath && existsSync(installedPluginsPath)) {
        try {
            const content = readFileSync(installedPluginsPath, 'utf-8');
            const parsed = JSON.parse(content);
            const result = InstalledPluginsFileSchema.safeParse(parsed);

            if (result.success) {
                for (const installations of Object.values(result.data.plugins)) {
                    for (const entry of installations) {
                        if (!existsSync(entry.installPath)) continue;

                        const manifest = tryLoadManifest(entry.installPath);
                        if (manifest) {
                            const isImported = importedPaths.has(entry.installPath.toLowerCase());
                            plugins.push({
                                name: manifest.name,
                                description: manifest.description,
                                version: manifest.version,
                                path: entry.installPath,
                                isImported,
                            });
                        }
                    }
                }
            }
        } catch {
            // File read/parse error - continue to directory scan
        }
    }

    // Also scan Claude Code's plugins directory for plugins not in installed_plugins.json
    const claudePluginsDir = path.join(homeDir, '.claude', 'plugins');
    if (existsSync(claudePluginsDir)) {
        const seenPaths = new Set(plugins.map((p) => p.path.toLowerCase()));

        try {
            const entries = readdirSync(claudePluginsDir, { withFileTypes: true });

            for (const entry of entries) {
                if (!entry.isDirectory()) continue;
                if (entry.name === 'cache' || entry.name === 'marketplaces') continue;

                const pluginPath = path.join(claudePluginsDir, entry.name);

                // Skip if already found via installed_plugins.json
                if (seenPaths.has(pluginPath.toLowerCase())) continue;

                const manifest = tryLoadManifest(pluginPath);
                if (manifest) {
                    const isImported = importedPaths.has(pluginPath.toLowerCase());
                    plugins.push({
                        name: manifest.name,
                        description: manifest.description,
                        version: manifest.version,
                        path: pluginPath,
                        isImported,
                    });
                }
            }
        } catch {
            // Directory read error - silently skip
        }
    }

    return plugins;
}

/**
 * Imports a Claude Code plugin into Dexto's registry.
 * This registers the plugin path without copying files.
 *
 * @param pluginName Name of the plugin to import (or path)
 * @returns Import result
 */
export async function importClaudeCodePlugin(pluginName: string): Promise<PluginImportResult> {
    // Find the plugin in Claude Code's plugins
    const claudePlugins = listClaudeCodePlugins();

    // Try to find by name first
    let plugin = claudePlugins.find((p) => p.name.toLowerCase() === pluginName.toLowerCase());

    // If not found by name, try by path
    if (!plugin && (pluginName.startsWith('/') || pluginName.startsWith('.'))) {
        const absolutePath = path.isAbsolute(pluginName) ? pluginName : path.resolve(pluginName);
        plugin = claudePlugins.find((p) => p.path.toLowerCase() === absolutePath.toLowerCase());
    }

    if (!plugin) {
        throw PluginError.uninstallNotFound(pluginName);
    }

    if (plugin.isImported) {
        // Already imported - could return success or throw
        return {
            success: true,
            pluginName: plugin.name,
            pluginPath: plugin.path,
        };
    }

    // Load manifest to get full details
    const manifest = tryLoadManifest(plugin.path);
    if (!manifest) {
        throw PluginError.manifestNotFound(plugin.path);
    }

    // Add to Dexto's installed_plugins.json
    const installed = loadDextoInstalledPlugins();
    const now = new Date().toISOString();

    const entry: InstalledPluginEntry = {
        scope: 'user', // Imported plugins are treated as user-scope
        installPath: plugin.path,
        version: manifest.version,
        installedAt: now,
        lastUpdated: now,
        isImported: true,
    };

    // Use plugin name as the key
    const pluginKey = manifest.name;
    if (!installed.plugins[pluginKey]) {
        installed.plugins[pluginKey] = [];
    }

    // Remove any existing imported entry for this path
    const existingEntries = installed.plugins[pluginKey];
    installed.plugins[pluginKey] = existingEntries.filter(
        (e) => !e.isImported || e.installPath.toLowerCase() !== plugin.path.toLowerCase()
    );

    installed.plugins[pluginKey].push(entry);

    saveDextoInstalledPlugins(installed);

    return {
        success: true,
        pluginName: manifest.name,
        pluginPath: plugin.path,
    };
}

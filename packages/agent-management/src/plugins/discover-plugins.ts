/**
 * Plugin Discovery
 *
 * Discovers plugins from Dexto locations following the plugin format.
 * Plugins must have a .claude-plugin/plugin.json manifest file.
 *
 * Discovery Methods (Priority Order):
 * 1. Read ~/.dexto/plugins/installed_plugins.json for Dexto installed plugins
 * 2. Scan directories for plugins with .claude-plugin/plugin.json manifests
 *
 * Search Locations for Directory Scanning:
 * 1. <cwd>/.dexto/plugins/*     (project)
 * 2. ~/.dexto/plugins/*         (user)
 *
 * First found wins on name collision (by plugin name).
 */

import * as path from 'path';
import { existsSync, readdirSync, readFileSync } from 'fs';
import { getDextoGlobalPath } from '../utils/path.js';
import { InstalledPluginsFileSchema } from './schemas.js';
import { tryLoadManifest } from './validate-plugin.js';
import type {
    DiscoveredPlugin,
    PluginManifest,
    DextoPluginManifest,
    PluginFormat,
} from './types.js';

/**
 * Discovers plugins from Dexto locations.
 *
 * @param projectPath Optional project path for filtering project-scoped plugins
 * @param bundledPluginPaths Optional array of absolute paths to bundled plugins from image definition
 * @returns Array of discovered plugins, deduplicated by name (first found wins)
 */
export function discoverClaudeCodePlugins(
    projectPath?: string,
    bundledPluginPaths?: string[]
): DiscoveredPlugin[] {
    const plugins: DiscoveredPlugin[] = [];
    const seenNames = new Set<string>();
    const cwd = projectPath || process.cwd();

    /**
     * Adds a plugin if not already seen (deduplication by name)
     */
    const addPlugin = (plugin: DiscoveredPlugin): boolean => {
        const normalizedName = plugin.manifest.name.toLowerCase();
        if (seenNames.has(normalizedName)) {
            return false;
        }
        seenNames.add(normalizedName);
        plugins.push(plugin);
        return true;
    };

    // === Method 1: Read Dexto's installed_plugins.json (highest priority) ===
    const dextoInstalledPluginsPath = getDextoGlobalPath('plugins', 'installed_plugins.json');
    const dextoInstalledPlugins = readInstalledPluginsFile(dextoInstalledPluginsPath, cwd);
    for (const plugin of dextoInstalledPlugins) {
        addPlugin(plugin);
    }

    /**
     * Scans a plugins directory and adds valid plugins to the list
     */
    const scanPluginsDir = (dir: string, source: 'project' | 'user'): void => {
        if (!existsSync(dir)) return;

        try {
            const entries = readdirSync(dir, { withFileTypes: true });

            for (const entry of entries) {
                if (!entry.isDirectory()) continue;

                // Skip 'cache' and 'marketplaces' directories - these are handled via installed_plugins.json
                if (entry.name === 'cache' || entry.name === 'marketplaces') continue;

                const pluginPath = path.join(dir, entry.name);
                let loadResult: {
                    manifest: PluginManifest | DextoPluginManifest;
                    format: PluginFormat;
                } | null;
                try {
                    loadResult = tryLoadManifest(pluginPath, true);
                } catch {
                    // Skip invalid plugin without aborting the directory scan
                    continue;
                }

                if (loadResult) {
                    addPlugin({
                        path: pluginPath,
                        manifest: loadResult.manifest,
                        source,
                        format: loadResult.format,
                    });
                }
            }
        } catch {
            // Directory read error - silently skip
        }
    };

    // === Method 2: Scan directories ===

    // Project plugins: <cwd>/.dexto/plugins/
    scanPluginsDir(path.join(cwd, '.dexto', 'plugins'), 'project');

    // User plugins: ~/.dexto/plugins/
    scanPluginsDir(getDextoGlobalPath('plugins'), 'user');

    // === Method 3: Bundled plugins from image definition ===
    // These have lowest priority so users can override bundled plugins
    if (bundledPluginPaths && bundledPluginPaths.length > 0) {
        for (const pluginPath of bundledPluginPaths) {
            if (!existsSync(pluginPath)) {
                continue;
            }

            let loadResult: {
                manifest: PluginManifest | DextoPluginManifest;
                format: PluginFormat;
            } | null;
            try {
                loadResult = tryLoadManifest(pluginPath, true);
            } catch {
                // Skip invalid bundled plugin
                continue;
            }

            if (loadResult) {
                addPlugin({
                    path: pluginPath,
                    manifest: loadResult.manifest,
                    source: 'user', // Treat as user-level since they come from image
                    format: loadResult.format,
                });
            }
        }
    }

    return plugins;
}

/**
 * Reads and parses installed_plugins.json
 *
 * Plugins are stored at paths like:
 *   ~/.dexto/plugins/cache/<marketplace>/<plugin-name>/<version>/
 *
 * @param filePath Path to installed_plugins.json
 * @param currentProjectPath Current project path for filtering project-scoped plugins
 * @returns Array of discovered plugins from the installed plugins file
 */
function readInstalledPluginsFile(
    filePath: string,
    currentProjectPath: string
): DiscoveredPlugin[] {
    const plugins: DiscoveredPlugin[] = [];

    if (!existsSync(filePath)) {
        return plugins;
    }

    try {
        const content = readFileSync(filePath, 'utf-8');
        const parsed = JSON.parse(content);
        const result = InstalledPluginsFileSchema.safeParse(parsed);

        if (!result.success) {
            // Invalid format - skip silently
            return plugins;
        }

        const installedPlugins = result.data;

        // Iterate over all plugin entries
        for (const installations of Object.values(installedPlugins.plugins)) {
            // Each plugin can have multiple installations (different scopes/projects)
            for (const installation of installations) {
                const { scope, installPath, projectPath } = installation;

                // Skip if installPath doesn't exist
                if (!existsSync(installPath)) {
                    continue;
                }

                // For project-scoped and local-scoped plugins, only include if projectPath matches current project
                if ((scope === 'project' || scope === 'local') && projectPath) {
                    // Normalize paths for comparison
                    // Use case-insensitive comparison for Windows/macOS compatibility
                    const normalizedProjectPath = path.resolve(projectPath).toLowerCase();
                    const normalizedCurrentPath = path.resolve(currentProjectPath).toLowerCase();
                    if (normalizedProjectPath !== normalizedCurrentPath) {
                        continue;
                    }
                }

                // Try to load the manifest from the installPath
                // Wrap in try/catch so one invalid plugin doesn't abort the entire scan
                let loadResult: {
                    manifest: PluginManifest | DextoPluginManifest;
                    format: PluginFormat;
                } | null;
                try {
                    loadResult = tryLoadManifest(installPath, true);
                } catch {
                    // Skip invalid plugin without aborting the scan
                    continue;
                }

                if (loadResult) {
                    // Map scope to source type
                    const source: 'project' | 'user' =
                        scope === 'project' || scope === 'local' ? 'project' : 'user';

                    plugins.push({
                        path: installPath,
                        manifest: loadResult.manifest,
                        source,
                        format: loadResult.format,
                    });
                }
            }
        }
    } catch {
        // File read/parse error - silently skip
    }

    return plugins;
}

/**
 * Gets the search locations for plugins in priority order.
 * Useful for debugging and testing.
 *
 * @returns Array of plugin search paths
 */
export function getPluginSearchPaths(): string[] {
    const cwd = process.cwd();

    return [
        // Dexto's installed_plugins.json (highest priority)
        getDextoGlobalPath('plugins', 'installed_plugins.json'),
        // Directory scan locations
        path.join(cwd, '.dexto', 'plugins'),
        getDextoGlobalPath('plugins'),
    ];
}

/**
 * Gets the path to Dexto's installed_plugins.json file.
 *
 * @returns Absolute path to installed_plugins.json
 */
export function getInstalledPluginsPath(): string {
    return getDextoGlobalPath('plugins', 'installed_plugins.json');
}

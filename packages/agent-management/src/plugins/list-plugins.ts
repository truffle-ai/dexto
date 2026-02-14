/**
 * Plugin Listing
 *
 * Lists all installed plugins managed by Dexto:
 * 1. Dexto's installed_plugins.json (~/.dexto/plugins/installed_plugins.json)
 * 2. Directory scanning of Dexto plugin directories (project and user)
 *
 * Deduplicates by plugin name (first found wins).
 */

import * as path from 'path';
import { existsSync, readFileSync, readdirSync } from 'fs';
import { getDextoGlobalPath } from '../utils/path.js';
import { InstalledPluginsFileSchema } from './schemas.js';
import { tryLoadManifest } from './validate-plugin.js';
import type { ListedPlugin } from './types.js';

/**
 * Path to Dexto's installed_plugins.json
 */
export function getDextoInstalledPluginsPath(): string {
    return getDextoGlobalPath('plugins', 'installed_plugins.json');
}

/**
 * Lists all installed plugins managed by Dexto.
 *
 * Discovery sources:
 * 1. ~/.dexto/plugins/installed_plugins.json (tracked installations)
 * 2. Directory scanning of .dexto/plugins (project and user)
 *
 * @param projectPath Optional project path for filtering project-scoped plugins
 * @returns Array of listed plugins, deduplicated by name (first found wins)
 */
export function listInstalledPlugins(projectPath?: string): ListedPlugin[] {
    const plugins: ListedPlugin[] = [];
    const seenNames = new Set<string>();
    const cwd = projectPath || process.cwd();

    /**
     * Adds a plugin if not already seen (deduplication by name)
     */
    const addPlugin = (plugin: ListedPlugin): boolean => {
        const normalizedName = plugin.name.toLowerCase();
        if (seenNames.has(normalizedName)) {
            return false;
        }
        seenNames.add(normalizedName);
        plugins.push(plugin);
        return true;
    };

    // === Source 1: Dexto's installed_plugins.json ===
    const { plugins: dextoPlugins } = readDextoInstalledPlugins(cwd);
    for (const plugin of dextoPlugins) {
        addPlugin(plugin);
    }

    // === Source 2: Directory scanning of Dexto plugin directories ===
    const scanPluginsDir = (dir: string): void => {
        if (!existsSync(dir)) return;

        try {
            const entries = readdirSync(dir, { withFileTypes: true });

            for (const entry of entries) {
                if (!entry.isDirectory()) continue;

                // Skip 'cache' and 'marketplaces' directories
                if (entry.name === 'cache' || entry.name === 'marketplaces') continue;

                const pluginPath = path.join(dir, entry.name);
                const manifest = tryLoadManifest(pluginPath);

                if (manifest) {
                    addPlugin({
                        name: manifest.name,
                        description: manifest.description,
                        version: manifest.version,
                        path: pluginPath,
                        source: 'dexto',
                    });
                }
            }
        } catch {
            // Directory read error - silently skip
        }
    };

    // Scan project plugins (.dexto/plugins)
    scanPluginsDir(path.join(cwd, '.dexto', 'plugins'));

    // Scan user plugins (~/.dexto/plugins)
    scanPluginsDir(getDextoGlobalPath('plugins'));

    return plugins;
}

/**
 * Reads Dexto's installed_plugins.json and returns ListedPlugin array.
 */
function readDextoInstalledPlugins(currentProjectPath: string): {
    plugins: ListedPlugin[];
} {
    const plugins: ListedPlugin[] = [];
    const filePath = getDextoInstalledPluginsPath();

    if (!existsSync(filePath)) {
        return { plugins };
    }

    try {
        const content = readFileSync(filePath, 'utf-8');
        const parsed = JSON.parse(content);
        const result = InstalledPluginsFileSchema.safeParse(parsed);

        if (!result.success) {
            return { plugins };
        }

        const installedPlugins = result.data.plugins;
        for (const pluginId of Object.keys(installedPlugins)) {
            const installations = installedPlugins[pluginId] ?? [];
            for (const installation of installations) {
                const { scope, installPath, version, installedAt, projectPath } = installation;

                // Skip if installPath doesn't exist
                if (!existsSync(installPath)) {
                    continue;
                }

                // Load manifest to get name
                const manifest = tryLoadManifest(installPath);
                if (manifest) {
                    // For project-scoped and local-scoped plugins, only include if projectPath matches
                    if ((scope === 'project' || scope === 'local') && projectPath) {
                        const normalizedProjectPath = path.resolve(projectPath).toLowerCase();
                        const normalizedCurrentPath = path
                            .resolve(currentProjectPath)
                            .toLowerCase();
                        if (normalizedProjectPath !== normalizedCurrentPath) {
                            continue;
                        }
                    }

                    plugins.push({
                        name: manifest.name,
                        description: manifest.description,
                        version: version || manifest.version,
                        path: installPath,
                        source: 'dexto',
                        scope,
                        installedAt,
                    });
                }
            }
        }
    } catch {
        // File read/parse error - silently skip
    }

    return { plugins };
}

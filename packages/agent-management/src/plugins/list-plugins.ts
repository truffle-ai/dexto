/**
 * Plugin Listing
 *
 * Lists all installed plugins from multiple sources:
 * 1. Dexto's installed_plugins.json (~/.dexto/plugins/installed_plugins.json)
 * 2. Claude Code's installed_plugins.json (~/.claude/plugins/installed_plugins.json)
 * 3. Directory scanning (legacy and local plugins)
 *
 * Deduplicates by plugin name (first found wins).
 */

import * as path from 'path';
import { existsSync, readFileSync, readdirSync } from 'fs';
import { getDextoGlobalPath } from '../utils/path.js';
import { PluginManifestSchema, InstalledPluginsFileSchema } from './schemas.js';
import type { ListedPlugin, PluginInstallScope, PluginManifest } from './types.js';

/**
 * Path to Dexto's installed_plugins.json
 */
export function getDextoInstalledPluginsPath(): string {
    return getDextoGlobalPath('plugins', 'installed_plugins.json');
}

/**
 * Path to Claude Code's installed_plugins.json
 */
export function getClaudeCodeInstalledPluginsPath(): string | null {
    const homeDir = process.env.HOME || process.env.USERPROFILE || '';
    if (!homeDir) {
        return null;
    }
    return path.join(homeDir, '.claude', 'plugins', 'installed_plugins.json');
}

/**
 * Lists all installed plugins from all sources.
 *
 * Discovery priority:
 * 1. ~/.dexto/plugins/installed_plugins.json (Dexto's own)
 * 2. ~/.claude/plugins/installed_plugins.json (Claude Code)
 * 3. Directory scanning (project and user plugins)
 *
 * @param projectPath Optional project path for filtering project-scoped plugins
 * @returns Array of listed plugins, deduplicated by name (first found wins)
 */
export function listInstalledPlugins(projectPath?: string): ListedPlugin[] {
    const plugins: ListedPlugin[] = [];
    const seenNames = new Set<string>();
    const homeDir = process.env.HOME || process.env.USERPROFILE || '';
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
    const dextoPlugins = readDextoInstalledPlugins(cwd);
    for (const plugin of dextoPlugins) {
        addPlugin(plugin);
    }

    // === Source 2: Claude Code's installed_plugins.json ===
    if (homeDir) {
        const claudeCodePlugins = readClaudeCodeInstalledPlugins(homeDir, cwd);
        for (const plugin of claudeCodePlugins) {
            addPlugin(plugin);
        }
    }

    // === Source 3: Directory scanning ===
    const scanPluginsDir = (dir: string, source: 'dexto' | 'claude-code' | 'directory'): void => {
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
                        source,
                    });
                }
            }
        } catch {
            // Directory read error - silently skip
        }
    };

    // Scan project plugins
    scanPluginsDir(path.join(cwd, '.dexto', 'plugins'), 'dexto');
    scanPluginsDir(path.join(cwd, '.claude', 'plugins'), 'claude-code');

    // Scan user plugins
    scanPluginsDir(getDextoGlobalPath('plugins'), 'dexto');
    if (homeDir) {
        scanPluginsDir(path.join(homeDir, '.claude', 'plugins'), 'claude-code');
    }

    return plugins;
}

/**
 * Reads Dexto's installed_plugins.json and returns ListedPlugin array.
 */
function readDextoInstalledPlugins(currentProjectPath: string): ListedPlugin[] {
    const plugins: ListedPlugin[] = [];
    const filePath = getDextoInstalledPluginsPath();

    if (!existsSync(filePath)) {
        return plugins;
    }

    try {
        const content = readFileSync(filePath, 'utf-8');
        const parsed = JSON.parse(content);
        const result = InstalledPluginsFileSchema.safeParse(parsed);

        if (!result.success) {
            return plugins;
        }

        for (const [_pluginId, installations] of Object.entries(result.data.plugins)) {
            for (const installation of installations) {
                const { scope, installPath, version, installedAt, projectPath } = installation;

                // Skip if installPath doesn't exist
                if (!existsSync(installPath)) {
                    continue;
                }

                // For project-scoped and local-scoped plugins, only include if projectPath matches
                if ((scope === 'project' || scope === 'local') && projectPath) {
                    const normalizedProjectPath = path.resolve(projectPath).toLowerCase();
                    const normalizedCurrentPath = path.resolve(currentProjectPath).toLowerCase();
                    if (normalizedProjectPath !== normalizedCurrentPath) {
                        continue;
                    }
                }

                // Load manifest to get name and description
                const manifest = tryLoadManifest(installPath);
                if (manifest) {
                    plugins.push({
                        name: manifest.name,
                        description: manifest.description,
                        version: version || manifest.version,
                        path: installPath,
                        source: 'dexto',
                        scope: scope as PluginInstallScope,
                        installedAt,
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
 * Reads Claude Code's installed_plugins.json and returns ListedPlugin array.
 */
function readClaudeCodeInstalledPlugins(
    homeDir: string,
    currentProjectPath: string
): ListedPlugin[] {
    const plugins: ListedPlugin[] = [];
    const filePath = path.join(homeDir, '.claude', 'plugins', 'installed_plugins.json');

    if (!existsSync(filePath)) {
        return plugins;
    }

    try {
        const content = readFileSync(filePath, 'utf-8');
        const parsed = JSON.parse(content);
        const result = InstalledPluginsFileSchema.safeParse(parsed);

        if (!result.success) {
            return plugins;
        }

        for (const installations of Object.values(result.data.plugins)) {
            for (const installation of installations) {
                const { scope, installPath, version, projectPath } = installation;

                // Skip if installPath doesn't exist
                if (!existsSync(installPath)) {
                    continue;
                }

                // For project-scoped and local-scoped plugins, only include if projectPath matches
                if ((scope === 'project' || scope === 'local') && projectPath) {
                    const normalizedProjectPath = path.resolve(projectPath).toLowerCase();
                    const normalizedCurrentPath = path.resolve(currentProjectPath).toLowerCase();
                    if (normalizedProjectPath !== normalizedCurrentPath) {
                        continue;
                    }
                }

                // Load manifest to get name and description
                const manifest = tryLoadManifest(installPath);
                if (manifest) {
                    plugins.push({
                        name: manifest.name,
                        description: manifest.description,
                        version: version || manifest.version,
                        path: installPath,
                        source: 'claude-code',
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
 * Attempts to load and validate a plugin manifest from a directory.
 */
function tryLoadManifest(pluginPath: string): PluginManifest | null {
    const manifestPath = path.join(pluginPath, '.claude-plugin', 'plugin.json');

    if (!existsSync(manifestPath)) {
        return null;
    }

    try {
        const content = readFileSync(manifestPath, 'utf-8');
        const parsed = JSON.parse(content);
        const result = PluginManifestSchema.safeParse(parsed);

        if (!result.success) {
            return null;
        }

        return result.data;
    } catch {
        return null;
    }
}

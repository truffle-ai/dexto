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
import { InstalledPluginsFileSchema } from './schemas.js';
import { tryLoadManifest } from './validate-plugin.js';
import type { ListedPlugin, PluginInstallScope } from './types.js';

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
    const registeredNames = new Set<string>(); // Track all names from installed_plugins.json (even if filtered by scope)
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
    const { plugins: dextoPlugins, allNames: dextoAllNames } = readDextoInstalledPlugins(cwd);
    for (const name of dextoAllNames) {
        registeredNames.add(name.toLowerCase());
    }
    for (const plugin of dextoPlugins) {
        addPlugin(plugin);
    }

    // === Source 2: Claude Code's installed_plugins.json ===
    if (homeDir) {
        const { plugins: claudeCodePlugins, allNames: claudeAllNames } =
            readClaudeCodeInstalledPlugins(homeDir, cwd);
        for (const name of claudeAllNames) {
            registeredNames.add(name.toLowerCase());
        }
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

    /**
     * Scans Claude Code's cache directory structure: cache/<namespace>/<plugin>/<version>/
     * Only adds plugins that aren't already tracked in installed_plugins.json
     */
    const scanClaudeCodeCache = (rootDir: string, skipNames: Set<string>): void => {
        const cacheDir = path.join(rootDir, 'cache');
        if (!existsSync(cacheDir)) return;

        try {
            // Iterate namespaces (e.g., 'claude-code-plugins')
            for (const namespaceEntry of readdirSync(cacheDir, { withFileTypes: true })) {
                if (!namespaceEntry.isDirectory()) continue;

                const namespacePath = path.join(cacheDir, namespaceEntry.name);

                // Iterate plugins within namespace
                for (const pluginEntry of readdirSync(namespacePath, { withFileTypes: true })) {
                    if (!pluginEntry.isDirectory()) continue;

                    const pluginPath = path.join(namespacePath, pluginEntry.name);

                    // Iterate versions within plugin
                    for (const versionEntry of readdirSync(pluginPath, { withFileTypes: true })) {
                        if (!versionEntry.isDirectory()) continue;

                        const versionPath = path.join(pluginPath, versionEntry.name);
                        const manifest = tryLoadManifest(versionPath);

                        if (manifest) {
                            // Skip if already tracked in installed_plugins.json (even if filtered by scope)
                            if (skipNames.has(manifest.name.toLowerCase())) {
                                continue;
                            }

                            addPlugin({
                                name: manifest.name,
                                description: manifest.description,
                                version: manifest.version,
                                path: versionPath,
                                source: 'claude-code',
                            });
                        }
                    }
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
        // Also scan Claude Code's cache directory structure (skip plugins already in installed_plugins.json)
        scanClaudeCodeCache(path.join(homeDir, '.claude', 'plugins'), registeredNames);
    }

    return plugins;
}

/**
 * Reads Dexto's installed_plugins.json and returns ListedPlugin array plus all plugin names (even filtered ones).
 */
function readDextoInstalledPlugins(currentProjectPath: string): {
    plugins: ListedPlugin[];
    allNames: string[];
} {
    const plugins: ListedPlugin[] = [];
    const allNames: string[] = [];
    const filePath = getDextoInstalledPluginsPath();

    if (!existsSync(filePath)) {
        return { plugins, allNames };
    }

    try {
        const content = readFileSync(filePath, 'utf-8');
        const parsed = JSON.parse(content);
        const result = InstalledPluginsFileSchema.safeParse(parsed);

        if (!result.success) {
            return { plugins, allNames };
        }

        for (const [_pluginId, installations] of Object.entries(result.data.plugins)) {
            for (const installation of installations) {
                const { scope, installPath, version, installedAt, projectPath } = installation;

                // Skip if installPath doesn't exist
                if (!existsSync(installPath)) {
                    continue;
                }

                // Load manifest to get name
                const manifest = tryLoadManifest(installPath);
                if (manifest) {
                    // Track all names (even if filtered by scope)
                    allNames.push(manifest.name);

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
                        scope: scope as PluginInstallScope,
                        installedAt,
                    });
                }
            }
        }
    } catch {
        // File read/parse error - silently skip
    }

    return { plugins, allNames };
}

/**
 * Reads Claude Code's installed_plugins.json and returns ListedPlugin array plus all plugin names (even filtered ones).
 */
function readClaudeCodeInstalledPlugins(
    homeDir: string,
    currentProjectPath: string
): { plugins: ListedPlugin[]; allNames: string[] } {
    const plugins: ListedPlugin[] = [];
    const allNames: string[] = [];
    const filePath = path.join(homeDir, '.claude', 'plugins', 'installed_plugins.json');

    if (!existsSync(filePath)) {
        return { plugins, allNames };
    }

    try {
        const content = readFileSync(filePath, 'utf-8');
        const parsed = JSON.parse(content);
        const result = InstalledPluginsFileSchema.safeParse(parsed);

        if (!result.success) {
            return { plugins, allNames };
        }

        for (const installations of Object.values(result.data.plugins)) {
            for (const installation of installations) {
                const { scope, installPath, version, projectPath } = installation;

                // Skip if installPath doesn't exist
                if (!existsSync(installPath)) {
                    continue;
                }

                // Load manifest to get name
                const manifest = tryLoadManifest(installPath);
                if (manifest) {
                    // Track all names (even if filtered by scope)
                    allNames.push(manifest.name);

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
                        source: 'claude-code',
                    });
                }
            }
        }
    } catch {
        // File read/parse error - silently skip
    }

    return { plugins, allNames };
}

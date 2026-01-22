/**
 * Claude Code Plugin Discovery
 *
 * Discovers plugins from standard locations following the Claude Code plugin format.
 * Plugins must have a .claude-plugin/plugin.json manifest file.
 *
 * Discovery Methods (Priority Order):
 * 1. Read ~/.claude/plugins/installed_plugins.json for Claude Code installed plugins
 * 2. Scan directories for plugins with .claude-plugin/plugin.json manifests
 *
 * Search Locations for Directory Scanning:
 * 1. <cwd>/.dexto/plugins/*     (project)
 * 2. <cwd>/.claude/plugins/*    (project, Claude Code compatibility)
 * 3. ~/.dexto/plugins/*         (user)
 * 4. ~/.claude/plugins/*        (user, Claude Code compatibility - legacy)
 *
 * First found wins on name collision (by plugin name).
 */

import * as path from 'path';
import { existsSync, readdirSync, readFileSync } from 'fs';
import { getDextoGlobalPath } from '../utils/path.js';
import { PluginManifestSchema, InstalledPluginsFileSchema } from './schemas.js';
import { PluginError } from './errors.js';
import type { DiscoveredPlugin, PluginManifest } from './types.js';

/**
 * Discovers Claude Code plugins from standard locations.
 *
 * @param projectPath Optional project path for filtering project-scoped plugins
 * @returns Array of discovered plugins, deduplicated by name (first found wins)
 */
export function discoverClaudeCodePlugins(projectPath?: string): DiscoveredPlugin[] {
    const plugins: DiscoveredPlugin[] = [];
    const seenNames = new Set<string>();
    const homeDir = process.env.HOME || process.env.USERPROFILE || '';
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

    // === Method 1: Read installed_plugins.json (Claude Code installed plugins) ===
    if (homeDir) {
        const installedPluginsPath = path.join(
            homeDir,
            '.claude',
            'plugins',
            'installed_plugins.json'
        );
        const installedPlugins = readInstalledPluginsFile(installedPluginsPath, cwd);
        for (const plugin of installedPlugins) {
            addPlugin(plugin);
        }
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
                let manifest: PluginManifest | null;
                try {
                    manifest = tryLoadManifest(pluginPath);
                } catch {
                    // Skip invalid plugin without aborting the directory scan
                    continue;
                }

                if (manifest) {
                    addPlugin({
                        path: pluginPath,
                        manifest,
                        source,
                    });
                }
            }
        } catch {
            // Directory read error - silently skip
        }
    };

    // === Method 2: Scan directories (legacy and local plugins) ===

    // === Project plugins ===
    // 1. Dexto project plugins: <cwd>/.dexto/plugins/
    scanPluginsDir(path.join(cwd, '.dexto', 'plugins'), 'project');

    // 2. Claude Code project plugins: <cwd>/.claude/plugins/
    scanPluginsDir(path.join(cwd, '.claude', 'plugins'), 'project');

    // === User plugins ===
    // 3. Dexto user plugins: ~/.dexto/plugins/
    scanPluginsDir(getDextoGlobalPath('plugins'), 'user');

    // 4. Claude Code user plugins: ~/.claude/plugins/ (legacy direct placement)
    if (homeDir) {
        scanPluginsDir(path.join(homeDir, '.claude', 'plugins'), 'user');
    }

    return plugins;
}

/**
 * Reads and parses ~/.claude/plugins/installed_plugins.json
 *
 * This is Claude Code's primary method for tracking installed plugins.
 * Plugins are stored at paths like:
 *   ~/.claude/plugins/cache/<marketplace>/<plugin-name>/<version>/
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
                    const normalizedProjectPath = path.resolve(projectPath);
                    const normalizedCurrentPath = path.resolve(currentProjectPath);
                    if (normalizedProjectPath !== normalizedCurrentPath) {
                        continue;
                    }
                }

                // Try to load the manifest from the installPath
                const manifest = tryLoadManifest(installPath);
                if (manifest) {
                    // Map Claude Code scope to our source type
                    const source: 'project' | 'user' =
                        scope === 'project' || scope === 'local' ? 'project' : 'user';

                    plugins.push({
                        path: installPath,
                        manifest,
                        source,
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
 *
 * @param pluginPath Absolute path to the plugin directory
 * @returns Validated manifest or null if not a valid plugin
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
            // Invalid manifest - log error and skip
            const issues = result.error.issues.map((i) => i.message).join(', ');
            throw PluginError.manifestInvalid(pluginPath, issues);
        }

        return result.data;
    } catch (error) {
        if (error instanceof SyntaxError) {
            // JSON parse error - skip silently (plugin may be incomplete)
            return null;
        }
        // Re-throw other errors (validation errors)
        throw error;
    }
}

/**
 * Gets the search locations for plugins in priority order.
 * Useful for debugging and testing.
 *
 * @returns Array of plugin search paths
 */
export function getPluginSearchPaths(): string[] {
    const homeDir = process.env.HOME || process.env.USERPROFILE || '';
    const cwd = process.cwd();

    return [
        // installed_plugins.json location
        homeDir ? path.join(homeDir, '.claude', 'plugins', 'installed_plugins.json') : '',
        // Directory scan locations
        path.join(cwd, '.dexto', 'plugins'),
        path.join(cwd, '.claude', 'plugins'),
        getDextoGlobalPath('plugins'),
        homeDir ? path.join(homeDir, '.claude', 'plugins') : '',
    ].filter(Boolean);
}

/**
 * Gets the path to Claude Code's installed_plugins.json file.
 *
 * @returns Absolute path to installed_plugins.json or null if HOME is not set
 */
export function getInstalledPluginsPath(): string | null {
    const homeDir = process.env.HOME || process.env.USERPROFILE || '';
    if (!homeDir) {
        return null;
    }
    return path.join(homeDir, '.claude', 'plugins', 'installed_plugins.json');
}

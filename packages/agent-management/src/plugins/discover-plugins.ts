/**
 * Claude Code Plugin Discovery
 *
 * Discovers plugins from standard locations following the Claude Code plugin format.
 * Plugins must have a .claude-plugin/plugin.json manifest file.
 *
 * Search Locations (Priority Order):
 * 1. <cwd>/.dexto/plugins/*     (project)
 * 2. <cwd>/.claude/plugins/*    (project, Claude Code compatibility)
 * 3. ~/.dexto/plugins/*         (user)
 * 4. ~/.claude/plugins/*        (user, Claude Code compatibility)
 *
 * First found wins on name collision (by plugin name).
 */

import * as path from 'path';
import { existsSync, readdirSync, readFileSync } from 'fs';
import { getDextoGlobalPath } from '../utils/path.js';
import { PluginManifestSchema } from './schemas.js';
import { PluginError } from './errors.js';
import type { DiscoveredPlugin, PluginManifest } from './types.js';

/**
 * Discovers Claude Code plugins from standard locations.
 *
 * @returns Array of discovered plugins, deduplicated by name (first found wins)
 */
export function discoverClaudeCodePlugins(): DiscoveredPlugin[] {
    const plugins: DiscoveredPlugin[] = [];
    const seenNames = new Set<string>();
    const homeDir = process.env.HOME || process.env.USERPROFILE || '';
    const cwd = process.cwd();

    /**
     * Scans a plugins directory and adds valid plugins to the list
     */
    const scanPluginsDir = (dir: string, source: 'project' | 'user'): void => {
        if (!existsSync(dir)) return;

        try {
            const entries = readdirSync(dir, { withFileTypes: true });

            for (const entry of entries) {
                if (!entry.isDirectory()) continue;

                const pluginPath = path.join(dir, entry.name);
                const manifest = tryLoadManifest(pluginPath);

                if (manifest) {
                    // Deduplicate by plugin name (first found wins)
                    const normalizedName = manifest.name.toLowerCase();
                    if (!seenNames.has(normalizedName)) {
                        seenNames.add(normalizedName);
                        plugins.push({
                            path: pluginPath,
                            manifest,
                            source,
                        });
                    }
                }
            }
        } catch {
            // Directory read error - silently skip
        }
    };

    // Scan in priority order (first found wins for same plugin name)

    // === Project plugins ===
    // 1. Dexto project plugins: <cwd>/.dexto/plugins/
    scanPluginsDir(path.join(cwd, '.dexto', 'plugins'), 'project');

    // 2. Claude Code project plugins: <cwd>/.claude/plugins/
    scanPluginsDir(path.join(cwd, '.claude', 'plugins'), 'project');

    // === User plugins ===
    // 3. Dexto user plugins: ~/.dexto/plugins/
    scanPluginsDir(getDextoGlobalPath('plugins'), 'user');

    // 4. Claude Code user plugins: ~/.claude/plugins/
    if (homeDir) {
        scanPluginsDir(path.join(homeDir, '.claude', 'plugins'), 'user');
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
        path.join(cwd, '.dexto', 'plugins'),
        path.join(cwd, '.claude', 'plugins'),
        getDextoGlobalPath('plugins'),
        homeDir ? path.join(homeDir, '.claude', 'plugins') : '',
    ].filter(Boolean);
}

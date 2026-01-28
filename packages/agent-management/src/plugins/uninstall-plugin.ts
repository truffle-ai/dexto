/**
 * Plugin Uninstallation
 *
 * Uninstalls plugins from Dexto's plugin directory.
 * Removes plugin files and updates installed_plugins.json.
 */

import * as path from 'path';
import { existsSync, readFileSync, rmSync } from 'fs';
import { loadDextoInstalledPlugins, saveDextoInstalledPlugins } from './install-plugin.js';
import { PluginError } from './errors.js';
import type { PluginUninstallResult, InstalledPluginEntry } from './types.js';

/**
 * Options for plugin uninstallation
 */
export interface UninstallPluginOptions {
    /** Project path for filtering project-scoped plugins */
    projectPath?: string;
}

/**
 * Finds a plugin installation entry by name.
 *
 * @param pluginName Plugin name to find
 * @param projectPath Optional project path for project-scoped filtering
 * @returns Installation entry if found, null otherwise
 */
function findPluginInstallation(
    pluginName: string,
    projectPath?: string
): { entry: InstalledPluginEntry; pluginId: string } | null {
    const installed = loadDextoInstalledPlugins();
    const normalizedName = pluginName.toLowerCase();
    const currentProjectPath = projectPath || process.cwd();

    // First check if pluginName is a direct key
    if (installed.plugins[pluginName]) {
        const installations = installed.plugins[pluginName];
        for (const entry of installations) {
            // For project-scoped, match project
            if ((entry.scope === 'project' || entry.scope === 'local') && entry.projectPath) {
                const normalizedInstallProject = path.resolve(entry.projectPath).toLowerCase();
                const normalizedCurrentProject = path.resolve(currentProjectPath).toLowerCase();
                if (normalizedInstallProject === normalizedCurrentProject) {
                    return { entry, pluginId: pluginName };
                }
                continue;
            }
            // User-scoped - return first match
            return { entry, pluginId: pluginName };
        }
    }

    // Search by manifest name
    for (const [pluginId, installations] of Object.entries(installed.plugins)) {
        for (const entry of installations) {
            // Load manifest to check name
            const manifestPath = path.join(entry.installPath, '.claude-plugin', 'plugin.json');
            if (!existsSync(manifestPath)) continue;

            try {
                const content = readFileSync(manifestPath, 'utf-8');
                const manifest = JSON.parse(content);
                if (manifest.name?.toLowerCase() !== normalizedName) continue;

                // For project-scoped, match project
                if ((entry.scope === 'project' || entry.scope === 'local') && entry.projectPath) {
                    const normalizedInstallProject = path.resolve(entry.projectPath).toLowerCase();
                    const normalizedCurrentProject = path.resolve(currentProjectPath).toLowerCase();
                    if (normalizedInstallProject === normalizedCurrentProject) {
                        return { entry, pluginId };
                    }
                    continue;
                }
                // User-scoped - return first match
                return { entry, pluginId };
            } catch {
                continue;
            }
        }
    }

    return null;
}

/**
 * Uninstalls a plugin by name.
 * Accepts both "name" and "name@version" formats.
 *
 * @param pluginName Plugin name to uninstall (with optional @version suffix)
 * @param options Uninstallation options
 * @returns Uninstallation result with success status
 */
export async function uninstallPlugin(
    pluginName: string,
    options?: UninstallPluginOptions
): Promise<PluginUninstallResult> {
    const { projectPath } = options || {};

    // Strip @version suffix if present (user may copy from list output)
    // Only strip when the suffix is actually a version (semver pattern), not a namespace
    const atIndex = pluginName.lastIndexOf('@');
    const SEMVER_SUFFIX = /^(?:v)?\d+\.\d+\.\d+(?:-[\w.-]+)?$/;
    const nameWithoutVersion =
        atIndex > 0 && SEMVER_SUFFIX.test(pluginName.slice(atIndex + 1))
            ? pluginName.slice(0, atIndex)
            : pluginName;

    // Find the plugin installation
    const found = findPluginInstallation(nameWithoutVersion, projectPath);
    if (!found) {
        throw PluginError.uninstallNotFound(nameWithoutVersion);
    }

    const { entry, pluginId } = found;

    // Delete plugin files (unless it's a local plugin)
    // Local plugins are just references - we don't own the files
    let removedPath: string | undefined;
    const shouldDeleteFiles = !entry.isLocal;

    if (shouldDeleteFiles) {
        try {
            rmSync(entry.installPath, { recursive: true, force: true });
            removedPath = entry.installPath;
        } catch (error) {
            throw PluginError.uninstallDeleteFailed(
                entry.installPath,
                error instanceof Error ? error.message : String(error)
            );
        }
    } else {
        // For local plugins, just remove from manifest (don't delete files)
        removedPath = entry.installPath;
    }

    // Update installed_plugins.json
    const installed = loadDextoInstalledPlugins();
    const currentProjectPath = projectPath || process.cwd();

    if (installed.plugins[pluginId]) {
        // Remove the specific entry that matches scope and project
        installed.plugins[pluginId] = installed.plugins[pluginId].filter((e) => {
            // Different install path = different entry
            if (e.installPath !== entry.installPath) return true;

            // Same install path, same scope = match
            if (e.scope === entry.scope) {
                // For project/local scope, also check project path
                if ((e.scope === 'project' || e.scope === 'local') && e.projectPath) {
                    const normalizedEntryProject = path.resolve(e.projectPath).toLowerCase();
                    const normalizedCurrentProject = path.resolve(currentProjectPath).toLowerCase();
                    return normalizedEntryProject !== normalizedCurrentProject;
                }
                return false; // Remove user-scoped entry
            }
            return true;
        });

        // Remove plugin key if no more installations
        if (installed.plugins[pluginId].length === 0) {
            delete installed.plugins[pluginId];
        }
    }

    saveDextoInstalledPlugins(installed);

    return {
        success: true,
        removedPath,
    };
}

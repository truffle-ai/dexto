/**
 * Plugin Installation
 *
 * Installs plugins from local directories to Dexto's plugin directory.
 * Manages Dexto's own installed_plugins.json for tracking installations.
 */

import * as path from 'path';
import { existsSync, readFileSync, writeFileSync, mkdirSync, rmSync } from 'fs';
import { getDextoGlobalPath, copyDirectory } from '../utils/path.js';
import { validatePluginDirectory } from './validate-plugin.js';
import { PluginError } from './errors.js';
import { InstalledPluginsFileSchema } from './schemas.js';
import type {
    PluginInstallScope,
    PluginInstallResult,
    InstalledPluginsFile,
    InstalledPluginEntry,
} from './types.js';

/**
 * Options for plugin installation
 */
export interface InstallPluginOptions {
    /** Installation scope: 'user', 'project', or 'local' */
    scope: PluginInstallScope;
    /** Project path for project-scoped plugins */
    projectPath?: string;
    /** Force overwrite if plugin already exists */
    force?: boolean;
}

/**
 * Path to Dexto's installed_plugins.json
 */
export function getDextoInstalledPluginsPath(): string {
    return getDextoGlobalPath('plugins', 'installed_plugins.json');
}

/**
 * Loads Dexto's installed_plugins.json
 */
export function loadDextoInstalledPlugins(): InstalledPluginsFile {
    const filePath = getDextoInstalledPluginsPath();

    if (!existsSync(filePath)) {
        return { version: 1, plugins: {} };
    }

    try {
        const content = readFileSync(filePath, 'utf-8');
        const parsed = JSON.parse(content);
        const result = InstalledPluginsFileSchema.safeParse(parsed);

        if (!result.success) {
            // Invalid file - return fresh structure
            return { version: 1, plugins: {} };
        }

        return result.data as InstalledPluginsFile;
    } catch {
        // File read/parse error - return fresh structure
        return { version: 1, plugins: {} };
    }
}

/**
 * Saves Dexto's installed_plugins.json
 */
export function saveDextoInstalledPlugins(data: InstalledPluginsFile): void {
    const filePath = getDextoInstalledPluginsPath();
    const dirPath = path.dirname(filePath);

    // Ensure directory exists
    if (!existsSync(dirPath)) {
        mkdirSync(dirPath, { recursive: true });
    }

    try {
        writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
    } catch (error) {
        throw PluginError.installManifestWriteFailed(
            filePath,
            error instanceof Error ? error.message : String(error)
        );
    }
}

/**
 * Checks if a plugin is already installed.
 *
 * @param pluginName Plugin name to check
 * @param projectPath Optional project path for project-scoped check
 * @returns Installation entry if found, null otherwise
 */
export function isPluginInstalled(
    pluginName: string,
    projectPath?: string
): InstalledPluginEntry | null {
    const installed = loadDextoInstalledPlugins();
    const normalizedName = pluginName.toLowerCase();

    // Check all plugin entries
    for (const [_id, installations] of Object.entries(installed.plugins)) {
        for (const installation of installations) {
            // Load manifest to check name
            const manifestPath = path.join(
                installation.installPath,
                '.claude-plugin',
                'plugin.json'
            );
            if (!existsSync(manifestPath)) continue;

            try {
                const content = readFileSync(manifestPath, 'utf-8');
                const manifest = JSON.parse(content);
                if (manifest.name?.toLowerCase() === normalizedName) {
                    // For project-scoped plugins, only match if project matches
                    if (
                        (installation.scope === 'project' || installation.scope === 'local') &&
                        installation.projectPath
                    ) {
                        if (projectPath) {
                            const normalizedInstallProject = path
                                .resolve(installation.projectPath)
                                .toLowerCase();
                            const normalizedCurrentProject = path
                                .resolve(projectPath)
                                .toLowerCase();
                            if (normalizedInstallProject === normalizedCurrentProject) {
                                return installation;
                            }
                        }
                        // Project-scoped plugin but no projectPath provided - skip
                        continue;
                    }
                    return installation;
                }
            } catch {
                continue;
            }
        }
    }

    return null;
}

/**
 * Installs a plugin from a local directory.
 *
 * @param sourcePath Absolute or relative path to the plugin source directory
 * @param options Installation options
 * @returns Installation result with success status and warnings
 */
export async function installPluginFromPath(
    sourcePath: string,
    options: InstallPluginOptions
): Promise<PluginInstallResult> {
    const { scope, projectPath, force = false } = options;
    const warnings: string[] = [];

    // Resolve source path
    const absoluteSourcePath = path.isAbsolute(sourcePath) ? sourcePath : path.resolve(sourcePath);

    // Validate source plugin
    const validation = validatePluginDirectory(absoluteSourcePath);
    if (!validation.valid) {
        throw PluginError.installSourceNotFound(absoluteSourcePath);
    }

    if (!validation.manifest) {
        throw PluginError.installSourceNotFound(absoluteSourcePath);
    }

    // Add validation warnings
    warnings.push(...validation.warnings);

    const pluginName = validation.manifest.name;
    const currentProjectPath = projectPath || process.cwd();

    // Check if already installed
    const existingInstall = isPluginInstalled(pluginName, currentProjectPath);
    if (existingInstall && !force) {
        throw PluginError.installAlreadyExists(pluginName, existingInstall.installPath);
    }

    // Determine install path based on scope
    let installPath: string;
    let isLocal = false;

    switch (scope) {
        case 'user':
            installPath = path.join(getDextoGlobalPath('plugins'), pluginName);
            break;
        case 'project':
            installPath = path.join(currentProjectPath, '.dexto', 'plugins', pluginName);
            break;
        case 'local':
            // Local scope - register in place, don't copy
            installPath = absoluteSourcePath;
            isLocal = true;
            break;
        default:
            throw PluginError.invalidScope(scope);
    }

    // Copy plugin files (unless local scope)
    if (!isLocal) {
        // Remove existing if force is set
        if (existingInstall && force) {
            try {
                rmSync(existingInstall.installPath, { recursive: true, force: true });
            } catch (error) {
                throw PluginError.installCopyFailed(
                    absoluteSourcePath,
                    installPath,
                    `Failed to remove existing: ${error instanceof Error ? error.message : String(error)}`
                );
            }
        }

        // Create parent directory
        const parentDir = path.dirname(installPath);
        if (!existsSync(parentDir)) {
            mkdirSync(parentDir, { recursive: true });
        }

        // Copy plugin directory
        try {
            await copyDirectory(absoluteSourcePath, installPath);
        } catch (error) {
            throw PluginError.installCopyFailed(
                absoluteSourcePath,
                installPath,
                error instanceof Error ? error.message : String(error)
            );
        }
    }

    // Update installed_plugins.json
    const installed = loadDextoInstalledPlugins();
    const now = new Date().toISOString();

    const entry: InstalledPluginEntry = {
        scope,
        installPath,
        version: validation.manifest.version,
        installedAt: now,
        lastUpdated: now,
        ...(scope !== 'user' && { projectPath: currentProjectPath }),
        ...(isLocal && { isLocal: true }),
    };

    // Use plugin name as the key
    if (!installed.plugins[pluginName]) {
        installed.plugins[pluginName] = [];
    }

    // Remove existing entry for this scope/project combination
    installed.plugins[pluginName] = installed.plugins[pluginName].filter((e) => {
        if (e.scope !== scope) return true;
        if (scope === 'user') return false; // Remove existing user scope
        // For project/local scope, only remove if same project
        if (e.projectPath && currentProjectPath) {
            return (
                path.resolve(e.projectPath).toLowerCase() !==
                path.resolve(currentProjectPath).toLowerCase()
            );
        }
        return true;
    });

    installed.plugins[pluginName].push(entry);

    saveDextoInstalledPlugins(installed);

    return {
        success: true,
        pluginName,
        installPath,
        warnings,
    };
}

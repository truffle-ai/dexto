/**
 * Plugin Loader
 *
 * Discovers and loads bundled plugins from community sources.
 * Supports two formats:
 * - .claude-plugin: Claude Code compatible format
 * - .dexto-plugin: Dexto-native format with extended features (customToolProviders)
 */

// Types
export type {
    PluginManifest,
    DextoPluginManifest,
    PluginFormat,
    DiscoveredPlugin,
    PluginCommand,
    PluginMCPConfig,
    LoadedPlugin,
    PluginInstallScope,
    InstalledPluginEntry,
    InstalledPluginsFile,
    ListedPlugin,
    PluginValidationResult,
    PluginInstallResult,
    PluginUninstallResult,
    PluginImportResult,
    ClaudeCodePlugin,
} from './types.js';

// Schemas
export {
    PluginManifestSchema,
    DextoPluginManifestSchema,
    PluginMCPConfigSchema,
    InstalledPluginEntrySchema,
    InstalledPluginsFileSchema,
} from './schemas.js';
export type {
    ValidatedPluginManifest,
    ValidatedDextoPluginManifest,
    ValidatedPluginMCPConfig,
    ValidatedInstalledPluginsFile,
    ValidatedInstalledPluginEntry,
} from './schemas.js';

// Error handling
export { PluginErrorCode } from './error-codes.js';
export { PluginError } from './errors.js';

// Discovery
export {
    discoverClaudeCodePlugins,
    getPluginSearchPaths,
    getInstalledPluginsPath,
} from './discover-plugins.js';

// Standalone skill discovery
export { discoverStandaloneSkills, getSkillSearchPaths } from './discover-skills.js';
export type { DiscoveredSkill } from './discover-skills.js';

// Loading
export { loadClaudeCodePlugin } from './load-plugin.js';

// Validation
export { validatePluginDirectory, tryLoadManifest } from './validate-plugin.js';

// Listing
export {
    listInstalledPlugins,
    getDextoInstalledPluginsPath,
    getClaudeCodeInstalledPluginsPath,
} from './list-plugins.js';

// Installation
export {
    installPluginFromPath,
    loadDextoInstalledPlugins,
    saveDextoInstalledPlugins,
    isPluginInstalled,
    type InstallPluginOptions,
} from './install-plugin.js';

// Uninstallation
export { uninstallPlugin, type UninstallPluginOptions } from './uninstall-plugin.js';

// Import from Claude Code
export {
    listClaudeCodePlugins,
    importClaudeCodePlugin,
    getClaudeCodePluginsDir,
    getClaudeCodeInstalledPluginsJsonPath,
} from './import-plugin.js';

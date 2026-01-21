/**
 * Claude Code Plugin Loader
 *
 * Discovers and loads bundled plugins from community sources.
 * Supports compatible features and emits warnings for unsupported features.
 */

// Types
export type {
    PluginManifest,
    DiscoveredPlugin,
    PluginCommand,
    PluginMCPConfig,
    LoadedPlugin,
} from './types.js';

// Schemas
export {
    PluginManifestSchema,
    PluginMCPConfigSchema,
    InstalledPluginEntrySchema,
    InstalledPluginsFileSchema,
} from './schemas.js';
export type {
    ValidatedPluginManifest,
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

// Loading
export { loadClaudeCodePlugin } from './load-plugin.js';

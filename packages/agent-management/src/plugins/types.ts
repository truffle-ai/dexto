/**
 * Claude Code Plugin Loader Types
 *
 * Supports loading bundled plugins from community sources (e.g., Vercel skills repo)
 * with compatible features. Emits warnings for unsupported features (hooks, LSP).
 *
 * Plugin Format:
 * ```
 * my-plugin/
 * ├── .claude-plugin/
 * │   └── plugin.json          # {name, description, version, author?}
 * ├── commands/*.md            # Commands (→ prompts, user-invocable by default)
 * ├── skills/* /SKILL.md       # Skills (→ prompts, user-invocable by default)
 * ├── hooks/hooks.json         # UNSUPPORTED - shell injection
 * ├── .mcp.json                # MCP servers to merge into config
 * └── .lsp.json                # UNSUPPORTED - language servers
 * ```
 */

/**
 * Author can be a string or an object with name/email
 */
export type PluginAuthor = string | { name: string; email?: string | undefined };

/**
 * Plugin manifest from .claude-plugin/plugin.json
 */
export interface PluginManifest {
    name: string;
    description?: string | undefined;
    version?: string | undefined;
    author?: PluginAuthor | undefined;
}

/**
 * Dexto-native plugin manifest from .dexto-plugin/plugin.json
 * Extends PluginManifest with Dexto-specific features
 */
export interface DextoPluginManifest extends PluginManifest {
    /** Custom tool factory types bundled with this plugin (e.g., ["plan-tools"]) */
    customToolFactories?: string[] | undefined;
}

/**
 * Plugin format type
 */
export type PluginFormat = 'claude-code' | 'dexto';

/**
 * A discovered plugin directory with its manifest
 */
export interface DiscoveredPlugin {
    /** Absolute path to plugin directory */
    path: string;
    /** Parsed and validated plugin manifest */
    manifest: PluginManifest | DextoPluginManifest;
    /** Source location type */
    source: 'project' | 'user';
    /** Plugin format (claude-code or dexto) */
    format: PluginFormat;
}

/**
 * A command or skill discovered within a plugin
 */
export interface PluginCommand {
    /** Absolute path to .md file */
    file: string;
    /** Plugin name for prefixing (namespace) */
    namespace: string;
    /** true = from skills/ directory, false = from commands/ directory.
     *  Note: This is metadata only; both are user-invocable by default. */
    isSkill: boolean;
}

/**
 * MCP configuration from .mcp.json
 */
export interface PluginMCPConfig {
    mcpServers?: Record<string, unknown> | undefined;
}

/**
 * A fully loaded plugin with all discovered content
 */
export interface LoadedPlugin {
    /** Plugin manifest metadata */
    manifest: PluginManifest | DextoPluginManifest;
    /** Plugin format (claude-code or dexto) */
    format: PluginFormat;
    /** Discovered commands and skills */
    commands: PluginCommand[];
    /** MCP servers to merge into agent config */
    mcpConfig?: PluginMCPConfig | undefined;
    /** Custom tool factory types to register (Dexto-native plugins only) */
    customToolFactories: string[];
    /** Warnings for unsupported features found */
    warnings: string[];
}

/**
 * Installation scope for plugins
 * - user: Installed to ~/.dexto/plugins/<name>/
 * - project: Installed to <cwd>/.dexto/plugins/<name>/
 * - local: Registered in-place (no copy)
 */
export type PluginInstallScope = 'user' | 'project' | 'local';

/**
 * Entry in installed_plugins.json for Dexto's plugin tracking
 */
export interface InstalledPluginEntry {
    /** Installation scope */
    scope: PluginInstallScope;
    /** Absolute path to the installed plugin */
    installPath: string;
    /** Plugin version from manifest */
    version?: string | undefined;
    /** ISO timestamp of installation */
    installedAt: string;
    /** ISO timestamp of last update */
    lastUpdated?: string | undefined;
    /** Project path for project-scoped plugins */
    projectPath?: string | undefined;
    /** Whether this is a local plugin (registered in-place) */
    isLocal?: boolean | undefined;
    /** Whether this plugin is imported from Claude Code (not copied, just referenced) */
    isImported?: boolean | undefined;
}

/**
 * Structure of installed_plugins.json
 */
export interface InstalledPluginsFile {
    /** Schema version for future compatibility */
    version: number;
    /** Map of plugin names to installation entries */
    plugins: Record<string, InstalledPluginEntry[]>;
}

/**
 * Plugin with source tracking for listing
 */
export interface ListedPlugin {
    /** Plugin name from manifest */
    name: string;
    /** Plugin description */
    description?: string | undefined;
    /** Plugin version */
    version?: string | undefined;
    /** Absolute path to plugin directory */
    path: string;
    /** Source of plugin discovery (always 'dexto' now) */
    source: 'dexto';
    /** Installation scope if installed via Dexto */
    scope?: PluginInstallScope | undefined;
    /** ISO timestamp of installation */
    installedAt?: string | undefined;
}

/**
 * Result of plugin validation
 */
export interface PluginValidationResult {
    /** Whether the plugin is valid */
    valid: boolean;
    /** Validated manifest if valid */
    manifest?: PluginManifest | undefined;
    /** Validation errors */
    errors: string[];
    /** Validation warnings */
    warnings: string[];
}

/**
 * Result of plugin installation
 */
export interface PluginInstallResult {
    /** Whether installation succeeded */
    success: boolean;
    /** Plugin name from manifest */
    pluginName: string;
    /** Path where plugin was installed */
    installPath: string;
    /** Installation warnings */
    warnings: string[];
}

/**
 * Result of plugin uninstallation
 */
export interface PluginUninstallResult {
    /** Whether uninstallation succeeded */
    success: boolean;
    /** Path that was removed */
    removedPath?: string | undefined;
}

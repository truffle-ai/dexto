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
 * ├── commands/*.md            # User-invoked commands (→ prompts)
 * ├── skills/* /SKILL.md       # Model-invoked skills (→ prompts with userInvocable: false)
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
 * A discovered plugin directory with its manifest
 */
export interface DiscoveredPlugin {
    /** Absolute path to plugin directory */
    path: string;
    /** Parsed and validated plugin manifest */
    manifest: PluginManifest;
    /** Source location type */
    source: 'project' | 'user';
}

/**
 * A command or skill discovered within a plugin
 */
export interface PluginCommand {
    /** Absolute path to .md file */
    file: string;
    /** Plugin name for prefixing (namespace) */
    namespace: string;
    /** true = skills/, false = commands/ */
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
    manifest: PluginManifest;
    /** Discovered commands and skills */
    commands: PluginCommand[];
    /** MCP servers to merge into agent config */
    mcpConfig?: PluginMCPConfig | undefined;
    /** Warnings for unsupported features found */
    warnings: string[];
}

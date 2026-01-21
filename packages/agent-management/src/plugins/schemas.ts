/**
 * Zod schemas for Claude Code plugin validation
 */

import { z } from 'zod';

/**
 * Schema for author field - can be a string or an object with name/email
 */
const AuthorSchema = z.union([
    z.string(),
    z.object({
        name: z.string(),
        email: z.string().optional(),
    }),
]);

/**
 * Schema for plugin.json manifest
 * Uses passthrough to allow unknown fields from Claude Code plugins
 */
export const PluginManifestSchema = z
    .object({
        name: z.string().min(1).describe('Unique plugin name (used for namespacing commands)'),
        description: z.string().optional().describe('Human-readable plugin description'),
        version: z.string().optional().describe('Semantic version (e.g., 1.0.0)'),
        author: AuthorSchema.optional().describe('Plugin author - string or {name, email} object'),
    })
    .passthrough()
    .describe('Claude Code plugin manifest from .claude-plugin/plugin.json');

/**
 * Schema for .mcp.json configuration
 * Uses passthrough to allow unknown MCP server configurations
 */
export const PluginMCPConfigSchema = z
    .object({
        mcpServers: z.record(z.unknown()).optional().describe('MCP servers to register'),
    })
    .passthrough()
    .describe('MCP configuration from .mcp.json');

/**
 * Type for validated plugin manifest
 */
export type ValidatedPluginManifest = z.output<typeof PluginManifestSchema>;

/**
 * Type for validated MCP config
 */
export type ValidatedPluginMCPConfig = z.output<typeof PluginMCPConfigSchema>;

/**
 * Schema for individual plugin installation entry in installed_plugins.json
 */
export const InstalledPluginEntrySchema = z
    .object({
        scope: z.enum(['project', 'user', 'local', 'managed']).describe('Installation scope'),
        installPath: z.string().describe('Absolute path to the installed plugin'),
        version: z.string().optional().describe('Plugin version'),
        installedAt: z.string().optional().describe('ISO timestamp of installation'),
        lastUpdated: z.string().optional().describe('ISO timestamp of last update'),
        gitCommitSha: z
            .string()
            .optional()
            .describe('Git commit SHA if installed from marketplace'),
        projectPath: z.string().optional().describe('Project path for project-scoped plugins'),
        isLocal: z.boolean().optional().describe('Whether this is a local plugin'),
    })
    .passthrough()
    .describe('Plugin installation entry');

/**
 * Schema for ~/.claude/plugins/installed_plugins.json
 */
export const InstalledPluginsFileSchema = z
    .object({
        version: z.number().optional().describe('Schema version'),
        plugins: z
            .record(z.array(InstalledPluginEntrySchema))
            .describe('Map of plugin identifiers to installation entries'),
    })
    .passthrough()
    .describe('Claude Code installed plugins manifest');

/**
 * Type for validated installed plugins file
 */
export type ValidatedInstalledPluginsFile = z.output<typeof InstalledPluginsFileSchema>;

/**
 * Type for validated installed plugin entry
 */
export type ValidatedInstalledPluginEntry = z.output<typeof InstalledPluginEntrySchema>;

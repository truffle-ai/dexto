/**
 * Zod schemas for Claude Code plugin validation
 */

import { z } from 'zod';

/**
 * Schema for plugin.json manifest
 * Validated strictly to catch typos in plugin configuration
 */
export const PluginManifestSchema = z
    .object({
        name: z.string().min(1).describe('Unique plugin name (used for namespacing commands)'),
        description: z.string().optional().describe('Human-readable plugin description'),
        version: z.string().optional().describe('Semantic version (e.g., 1.0.0)'),
        author: z.string().optional().describe('Plugin author name or organization'),
    })
    .strict()
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

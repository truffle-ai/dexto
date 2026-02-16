/**
 * Plugin Loader
 *
 * Loads plugin contents including commands, skills, MCP configuration,
 * Detects and warns about unsupported features (hooks, LSP).
 *
 * Supports Claude Code compatible plugins:
 * - .claude-plugin
 */

import * as path from 'path';
import { existsSync, readdirSync, readFileSync } from 'fs';
import { PluginMCPConfigSchema } from './schemas.js';
import type { DiscoveredPlugin, LoadedPlugin, PluginCommand, PluginMCPConfig } from './types.js';

/**
 * Loads a discovered plugin's contents.
 *
 * @param plugin The discovered plugin to load
 * @returns Loaded plugin with commands, MCP config, custom tool factories, and warnings
 */
export function loadClaudeCodePlugin(plugin: DiscoveredPlugin): LoadedPlugin {
    const warnings: string[] = [];
    const commands: PluginCommand[] = [];
    const pluginName = plugin.manifest.name;
    const pluginPath = plugin.path;

    // 1. Scan commands/*.md
    const commandsDir = path.join(pluginPath, 'commands');
    if (existsSync(commandsDir)) {
        const commandFiles = scanMarkdownFiles(commandsDir);
        for (const file of commandFiles) {
            const content = readFileSafe(file);
            if (!content) {
                warnings.push(
                    `[${pluginName}] Command '${path.basename(file)}' could not be read and will be skipped`
                );
                continue;
            }

            commands.push({
                file,
                namespace: pluginName,
                isSkill: false,
            });
        }
    }

    // 2. Scan skills/*/SKILL.md
    const skillsDir = path.join(pluginPath, 'skills');
    if (existsSync(skillsDir)) {
        try {
            const entries = readdirSync(skillsDir, { withFileTypes: true });
            for (const entry of entries) {
                if (!entry.isDirectory()) continue;

                const skillFile = path.join(skillsDir, entry.name, 'SKILL.md');
                if (existsSync(skillFile)) {
                    const content = readFileSafe(skillFile);
                    if (!content) {
                        warnings.push(
                            `[${pluginName}] Skill '${entry.name}' could not be read and will be skipped`
                        );
                        continue;
                    }

                    commands.push({
                        file: skillFile,
                        namespace: pluginName,
                        isSkill: true,
                    });
                }
            }
        } catch {
            // Skills directory read error - silently skip
        }
    }

    // 3. Load .mcp.json if exists
    const mcpConfig = loadMcpConfig(pluginPath, pluginName, warnings);

    // 4. Check for unsupported features
    checkUnsupportedFeatures(pluginPath, pluginName, warnings);

    return {
        manifest: plugin.manifest,
        commands,
        mcpConfig,
        warnings,
    };
}

/**
 * Scans a directory for .md files (non-recursive).
 */
function scanMarkdownFiles(dir: string): string[] {
    const files: string[] = [];

    try {
        const entries = readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
            if (entry.isFile() && entry.name.endsWith('.md') && entry.name !== 'README.md') {
                files.push(path.join(dir, entry.name));
            }
        }
    } catch {
        // Directory read error - return empty
    }

    return files;
}

/**
 * Safely reads a file's content, returning null on error.
 */
function readFileSafe(filePath: string): string | null {
    try {
        return readFileSync(filePath, 'utf-8');
    } catch {
        return null;
    }
}

/**
 * Loads MCP configuration from .mcp.json if it exists.
 *
 * Claude Code's .mcp.json format puts servers directly at the root level:
 * { "serverName": { "type": "http", "url": "..." } }
 *
 * We normalize this to: { mcpServers: { "serverName": { ... } } }
 */
function loadMcpConfig(
    pluginPath: string,
    pluginName: string,
    warnings: string[]
): PluginMCPConfig | undefined {
    const mcpPath = path.join(pluginPath, '.mcp.json');

    if (!existsSync(mcpPath)) {
        return undefined;
    }

    try {
        const content = readFileSync(mcpPath, 'utf-8');
        const parsed = JSON.parse(content);

        // Claude Code format: servers directly at root level
        // Check if this looks like the Claude Code format (no mcpServers key, has server-like objects)
        if (!parsed.mcpServers && typeof parsed === 'object' && parsed !== null) {
            // Check if any root key looks like a server config (has 'type' or 'command' or 'url')
            const hasServerConfig = Object.values(parsed).some(
                (val) =>
                    typeof val === 'object' &&
                    val !== null &&
                    ('type' in val || 'command' in val || 'url' in val)
            );

            if (hasServerConfig) {
                // Normalize Claude Code format to Dexto format
                // Claude Code doesn't require 'type' field - it infers from 'command' vs 'url'
                const normalized: Record<string, unknown> = {};

                for (const [serverName, serverConfig] of Object.entries(parsed)) {
                    if (
                        typeof serverConfig === 'object' &&
                        serverConfig !== null &&
                        !Array.isArray(serverConfig)
                    ) {
                        const config = serverConfig as Record<string, unknown>;

                        // If type is already present, use as-is
                        if ('type' in config) {
                            normalized[serverName] = config;
                        }
                        // If command is present, infer type: 'stdio'
                        else if ('command' in config) {
                            normalized[serverName] = {
                                type: 'stdio',
                                ...config,
                            };
                        }
                        // If url is present, infer type based on URL or default to 'http'
                        else if ('url' in config) {
                            const url = String(config.url || '');
                            // If URL contains /sse or ends with /sse, assume SSE
                            const inferredType = url.includes('/sse') ? 'sse' : 'http';
                            normalized[serverName] = {
                                type: inferredType,
                                ...config,
                            };
                        } else {
                            // Unknown format - keep as-is and let validation catch it
                            normalized[serverName] = config;
                        }
                    }
                }

                return { mcpServers: normalized };
            }
        }

        // Try standard schema validation
        const result = PluginMCPConfigSchema.safeParse(parsed);

        if (!result.success) {
            const issues = result.error.issues.map((i) => i.message).join(', ');
            warnings.push(`[${pluginName}] Invalid .mcp.json: ${issues}`);
            return undefined;
        }

        return result.data;
    } catch (error) {
        if (error instanceof SyntaxError) {
            warnings.push(`[${pluginName}] Failed to parse .mcp.json: invalid JSON`);
        } else {
            warnings.push(`[${pluginName}] Failed to load .mcp.json: ${String(error)}`);
        }
        return undefined;
    }
}

/**
 * Checks for unsupported Claude Code features and adds warnings.
 */
function checkUnsupportedFeatures(
    pluginPath: string,
    pluginName: string,
    warnings: string[]
): void {
    // Check for hooks/hooks.json (security risk - would allow arbitrary command execution)
    const hooksPath = path.join(pluginPath, 'hooks', 'hooks.json');
    if (existsSync(hooksPath)) {
        warnings.push(
            `[${pluginName}] hooks/hooks.json detected but not supported (security risk)`
        );
    }

    // Check for .lsp.json (language server protocol)
    const lspPath = path.join(pluginPath, '.lsp.json');
    if (existsSync(lspPath)) {
        warnings.push(`[${pluginName}] .lsp.json detected but not supported (LSP integration)`);
    }
}

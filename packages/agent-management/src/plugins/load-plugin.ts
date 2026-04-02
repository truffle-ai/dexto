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
import type { DiscoveredPlugin, LoadedPlugin, PluginCommand } from './types.js';
import { loadMcpConfigFromDirectory } from './mcp-config.js';

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
    const mcpResult = loadMcpConfigFromDirectory(pluginPath, pluginName);
    warnings.push(...mcpResult.warnings);

    // 4. Check for unsupported features
    checkUnsupportedFeatures(pluginPath, pluginName, warnings);

    return {
        manifest: plugin.manifest,
        commands,
        mcpConfig: mcpResult.mcpConfig,
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

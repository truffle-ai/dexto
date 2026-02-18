/**
 * Plugin Validation
 *
 * Validates plugin directory structure and manifest.
 * Checks for required files, valid JSON, and schema compliance.
 *
 * Supports Claude Code compatible plugins:
 * - .claude-plugin/plugin.json
 */

import * as path from 'path';
import { existsSync, readFileSync, readdirSync } from 'fs';
import { PluginManifestSchema } from './schemas.js';
import type { PluginValidationResult, PluginManifest } from './types.js';

/**
 * Validates a plugin directory structure and manifest.
 *
 * Checks:
 * 1. Directory exists
 * 2. .claude-plugin/plugin.json exists
 * 3. plugin.json is valid JSON
 * 4. plugin.json matches schema (name is required)
 * 5. At least one command or skill exists (warning if none)
 *
 * @param pluginPath Absolute or relative path to plugin directory
 * @returns Validation result with manifest (if valid), errors, and warnings
 */
export function validatePluginDirectory(pluginPath: string): PluginValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];
    let manifest: PluginManifest | undefined;

    // Resolve to absolute path
    const absolutePath = path.isAbsolute(pluginPath) ? pluginPath : path.resolve(pluginPath);

    // Check directory exists
    if (!existsSync(absolutePath)) {
        errors.push(`Directory does not exist: ${absolutePath}`);
        return { valid: false, errors, warnings };
    }

    // Check for plugin manifest
    const manifestPath = path.join(absolutePath, '.claude-plugin', 'plugin.json');

    // Check plugin.json exists
    if (!existsSync(manifestPath)) {
        errors.push('Missing .claude-plugin/plugin.json');
        return { valid: false, errors, warnings };
    }

    // Parse and validate manifest
    try {
        const content = readFileSync(manifestPath, 'utf-8');
        let parsed: unknown;

        try {
            parsed = JSON.parse(content);
        } catch (parseError) {
            errors.push(
                `Invalid JSON in plugin.json: ${parseError instanceof Error ? parseError.message : String(parseError)}`
            );
            return { valid: false, errors, warnings };
        }

        const result = PluginManifestSchema.safeParse(parsed);
        if (!result.success) {
            const issues = result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
            errors.push(`Schema validation failed: ${issues.join('; ')}`);
            return { valid: false, errors, warnings };
        }

        manifest = result.data;
    } catch (error) {
        errors.push(
            `Failed to read plugin.json: ${error instanceof Error ? error.message : String(error)}`
        );
        return { valid: false, errors, warnings };
    }

    // Check for commands or skills (warning if none)
    const hasCommands = checkDirectoryHasFiles(path.join(absolutePath, 'commands'), '.md');
    const hasSkills = checkDirectoryHasSkills(path.join(absolutePath, 'skills'));

    if (!hasCommands && !hasSkills) {
        warnings.push('Plugin has no commands or skills');
    }

    // Check for unsupported features (warnings only)
    if (existsSync(path.join(absolutePath, 'hooks'))) {
        warnings.push('hooks/ directory found - hooks are not supported (security risk)');
    }

    if (existsSync(path.join(absolutePath, '.lsp.json'))) {
        warnings.push('.lsp.json found - LSP configuration is not supported');
    }

    // Check for MCP config
    const mcpPath = path.join(absolutePath, '.mcp.json');
    if (existsSync(mcpPath)) {
        try {
            const mcpContent = readFileSync(mcpPath, 'utf-8');
            JSON.parse(mcpContent);
        } catch {
            warnings.push('.mcp.json exists but contains invalid JSON');
        }
    }

    return {
        valid: errors.length === 0,
        manifest,
        errors,
        warnings,
    };
}

/**
 * Checks if a directory has files with a specific extension.
 */
function checkDirectoryHasFiles(dirPath: string, extension: string): boolean {
    if (!existsSync(dirPath)) {
        return false;
    }

    try {
        const entries = readdirSync(dirPath, { withFileTypes: true });
        return entries.some((entry) => entry.isFile() && entry.name.endsWith(extension));
    } catch {
        return false;
    }
}

/**
 * Checks if a skills directory has valid SKILL.md files.
 * Skills are subdirectories containing SKILL.md.
 */
function checkDirectoryHasSkills(skillsDir: string): boolean {
    if (!existsSync(skillsDir)) {
        return false;
    }

    try {
        const entries = readdirSync(skillsDir, { withFileTypes: true });
        return entries.some((entry) => {
            if (!entry.isDirectory()) return false;
            const skillMdPath = path.join(skillsDir, entry.name, 'SKILL.md');
            return existsSync(skillMdPath);
        });
    } catch {
        return false;
    }
}

/**
 * Attempts to load and validate a plugin manifest from a directory.
 * Returns null if the manifest doesn't exist, is invalid JSON, or fails schema validation.
 *
 * This is a shared utility used by discover-plugins, list-plugins, and import-plugin.
 *
 * @param pluginPath Absolute path to the plugin directory
 * @returns Validated manifest or null if not a valid plugin
 */
export function tryLoadManifest(pluginPath: string): PluginManifest | null {
    const manifestPath = path.join(pluginPath, '.claude-plugin', 'plugin.json');
    if (!existsSync(manifestPath)) {
        return null;
    }

    try {
        const content = readFileSync(manifestPath, 'utf-8');
        const parsed = JSON.parse(content);

        const result = PluginManifestSchema.safeParse(parsed);

        if (!result.success) {
            return null;
        }
        return result.data;
    } catch {
        return null;
    }
}

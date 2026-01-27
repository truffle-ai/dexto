/**
 * Plugin Validation
 *
 * Validates plugin directory structure and manifest.
 * Checks for required files, valid JSON, and schema compliance.
 *
 * Supports two plugin formats:
 * - .claude-plugin/plugin.json: Claude Code compatible format
 * - .dexto-plugin/plugin.json: Dexto-native format with extended features (preferred)
 */

import * as path from 'path';
import { existsSync, readFileSync, readdirSync } from 'fs';
import { PluginManifestSchema, DextoPluginManifestSchema } from './schemas.js';
import type {
    PluginValidationResult,
    PluginManifest,
    DextoPluginManifest,
    PluginFormat,
} from './types.js';

/**
 * Extended validation result with plugin format
 */
export interface ExtendedPluginValidationResult extends PluginValidationResult {
    /** Plugin format detected */
    format?: PluginFormat;
}

/**
 * Validates a plugin directory structure and manifest.
 *
 * Checks:
 * 1. Directory exists
 * 2. .dexto-plugin/plugin.json OR .claude-plugin/plugin.json exists (Dexto format preferred)
 * 3. plugin.json is valid JSON
 * 4. plugin.json matches schema (name is required)
 * 5. At least one command or skill exists (warning if none)
 *
 * @param pluginPath Absolute or relative path to plugin directory
 * @returns Validation result with manifest (if valid), errors, and warnings
 */
export function validatePluginDirectory(pluginPath: string): ExtendedPluginValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];
    let manifest: PluginManifest | DextoPluginManifest | undefined;
    let format: PluginFormat | undefined;

    // Resolve to absolute path
    const absolutePath = path.isAbsolute(pluginPath) ? pluginPath : path.resolve(pluginPath);

    // Check directory exists
    if (!existsSync(absolutePath)) {
        errors.push(`Directory does not exist: ${absolutePath}`);
        return { valid: false, errors, warnings };
    }

    // Check for plugin manifest (prefer .dexto-plugin over .claude-plugin)
    const dextoPluginDir = path.join(absolutePath, '.dexto-plugin');
    const claudePluginDir = path.join(absolutePath, '.claude-plugin');

    let manifestPath: string;
    if (existsSync(dextoPluginDir)) {
        manifestPath = path.join(dextoPluginDir, 'plugin.json');
        format = 'dexto';
    } else if (existsSync(claudePluginDir)) {
        manifestPath = path.join(claudePluginDir, 'plugin.json');
        format = 'claude-code';
    } else {
        errors.push('Missing .dexto-plugin or .claude-plugin directory');
        return { valid: false, errors, warnings };
    }

    // Check plugin.json exists
    if (!existsSync(manifestPath)) {
        errors.push(
            `Missing ${format === 'dexto' ? '.dexto-plugin' : '.claude-plugin'}/plugin.json`
        );
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

        // Validate against appropriate schema
        const schema = format === 'dexto' ? DextoPluginManifestSchema : PluginManifestSchema;
        const result = schema.safeParse(parsed);
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
        format,
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
 * Result of manifest loading with format information
 */
export interface LoadedManifestResult {
    manifest: PluginManifest | DextoPluginManifest;
    format: PluginFormat;
}

/**
 * Attempts to load and validate a plugin manifest from a directory.
 * Returns null if the manifest doesn't exist, is invalid JSON, or fails schema validation.
 *
 * Checks for .dexto-plugin first (preferred), then falls back to .claude-plugin.
 *
 * This is a shared utility used by discover-plugins, list-plugins, and import-plugin.
 *
 * @param pluginPath Absolute path to the plugin directory
 * @returns Validated manifest with format or null if not a valid plugin
 */
export function tryLoadManifest(pluginPath: string): PluginManifest | null;
export function tryLoadManifest(
    pluginPath: string,
    returnFormat: true
): LoadedManifestResult | null;
export function tryLoadManifest(
    pluginPath: string,
    returnFormat?: boolean
): PluginManifest | LoadedManifestResult | null {
    // Check for .dexto-plugin first (preferred), then .claude-plugin
    const dextoManifestPath = path.join(pluginPath, '.dexto-plugin', 'plugin.json');
    const claudeManifestPath = path.join(pluginPath, '.claude-plugin', 'plugin.json');

    let manifestPath: string;
    let format: PluginFormat;

    if (existsSync(dextoManifestPath)) {
        manifestPath = dextoManifestPath;
        format = 'dexto';
    } else if (existsSync(claudeManifestPath)) {
        manifestPath = claudeManifestPath;
        format = 'claude-code';
    } else {
        return null;
    }

    try {
        const content = readFileSync(manifestPath, 'utf-8');
        const parsed = JSON.parse(content);

        // Use appropriate schema based on format
        const schema = format === 'dexto' ? DextoPluginManifestSchema : PluginManifestSchema;
        const result = schema.safeParse(parsed);

        if (!result.success) {
            return null;
        }

        if (returnFormat) {
            return { manifest: result.data, format };
        }
        return result.data;
    } catch {
        return null;
    }
}

import { promises as fs } from 'fs';
import path from 'path';
import { parse as parseYaml } from 'yaml';
import type { AgentConfig } from '@dexto/agent-config';
import type { IDextoLogger } from '@dexto/core';
import { ConfigError } from './errors.js';
import { getDextoPath } from '../utils/path.js';

/**
 * Template variables context for expansion
 */
interface TemplateContext {
    /** Agent directory (where the config file is located) */
    agentDir: string;
    /** Project .dexto directory (context-aware via getDextoPath) */
    projectDir: string;
}

/**
 * Expand template variables in agent configuration
 *
 * Supported variables:
 * - ${{dexto.agent_dir}} - Agent's directory path (where config is located)
 * - ${{dexto.project_dir}} - Context-aware .dexto directory:
 *   - dexto-source + dev mode: <repo>/.dexto
 *   - dexto-project: <project>/.dexto
 *   - global-cli: ~/.dexto
 */
function expandTemplateVars(config: unknown, context: TemplateContext): unknown {
    // Deep clone to avoid mutations
    const result = JSON.parse(JSON.stringify(config));

    // Walk the config recursively
    function walk(obj: unknown): unknown {
        if (typeof obj === 'string') {
            return expandString(obj, context);
        }
        if (Array.isArray(obj)) {
            return obj.map(walk);
        }
        if (obj !== null && typeof obj === 'object') {
            const result: Record<string, unknown> = {};
            for (const [key, value] of Object.entries(obj)) {
                result[key] = walk(value);
            }
            return result;
        }
        return obj;
    }

    return walk(result);
}

/**
 * Expand template variables in a string value
 */
function expandString(str: string, context: TemplateContext): string {
    let result = str;
    let hasAgentDirExpansion = false;
    let hasProjectDirExpansion = false;

    // Replace ${{dexto.agent_dir}} with absolute path
    if (/\${{\s*dexto\.agent_dir\s*}}/.test(result)) {
        result = result.replace(/\${{\s*dexto\.agent_dir\s*}}/g, context.agentDir);
        hasAgentDirExpansion = true;
    }

    // Replace ${{dexto.project_dir}} with absolute path
    if (/\${{\s*dexto\.project_dir\s*}}/.test(result)) {
        result = result.replace(/\${{\s*dexto\.project_dir\s*}}/g, context.projectDir);
        hasProjectDirExpansion = true;
    }

    // Security: Validate no path traversal for expanded paths
    if (hasAgentDirExpansion) {
        validateExpandedPath(str, result, context.agentDir, 'agent_dir');
    }
    if (hasProjectDirExpansion) {
        validateExpandedPath(str, result, context.projectDir, 'project_dir');
    }

    return result;
}

/**
 * Validate that template expansion doesn't allow path traversal
 */
function validateExpandedPath(
    original: string,
    expanded: string,
    rootDir: string,
    varName: string
): void {
    const resolved = path.resolve(expanded);
    const root = path.resolve(rootDir);
    const relative = path.relative(root, resolved);
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
        throw new Error(
            `Security: Template expansion attempted to escape ${varName} directory.\n` +
                `Original: ${original}\n` +
                `Expanded: ${expanded}\n` +
                `Root: ${root}`
        );
    }
}

/**
 * Asynchronously loads and processes an agent configuration file.
 * This function handles file reading, YAML parsing, and template variable expansion.
 * Environment variable expansion is handled by the Zod schema during validation.
 *
 * Note: Path resolution should be done before calling this function using resolveConfigPath().
 *
 * @param configPath - Path to the configuration file (absolute or relative)
 * @param logger - logger instance for logging
 * @returns A Promise that resolves to the parsed `AgentConfig` object with template variables expanded
 * @throws {ConfigError} with FILE_NOT_FOUND if the configuration file does not exist
 * @throws {ConfigError} with FILE_READ_ERROR if file read fails (e.g., permissions issues)
 * @throws {ConfigError} with PARSE_ERROR if the content is not valid YAML or template expansion fails
 */
export async function loadAgentConfig(
    configPath: string,
    logger?: IDextoLogger
): Promise<AgentConfig> {
    const absolutePath = path.resolve(configPath);

    // --- Step 1: Verify the configuration file exists and is accessible ---
    try {
        // Attempt to access the file. If it doesn't exist or permissions are insufficient,
        // `fs.access` will throw an error, which we catch.
        await fs.access(absolutePath);
    } catch (_error) {
        // Throw a specific error indicating that the configuration file was not found.
        throw ConfigError.fileNotFound(absolutePath);
    }

    let fileContent: string;
    // --- Step 2: Read the content of the configuration file ---
    try {
        // Read the file content as a UTF-8 encoded string.
        fileContent = await fs.readFile(absolutePath, 'utf-8');
    } catch (error) {
        // If an error occurs during file reading (e.g., I/O error, corrupted file),
        // throw a `ConfigFileReadError` with the absolute path and the underlying cause.
        throw ConfigError.fileReadError(
            absolutePath,
            error instanceof Error ? error.message : String(error)
        );
    }

    // --- Step 3: Parse the file content as YAML ---
    let config: unknown;
    try {
        // Attempt to parse the string content into a JavaScript object using a YAML parser.
        config = parseYaml(fileContent);
    } catch (error) {
        // If the content is not valid YAML, `parseYaml` will throw an error.
        // Catch it and throw a `ConfigParseError` with details.
        throw ConfigError.parseError(
            absolutePath,
            error instanceof Error ? error.message : String(error)
        );
    }

    // --- Step 4: Expand template variables ---
    try {
        const agentDir = path.dirname(absolutePath);
        // Use context-aware path resolution for project_dir
        // getDextoPath('') returns the .dexto directory for the current context
        const projectDir = getDextoPath('');
        const context: TemplateContext = { agentDir, projectDir };
        config = expandTemplateVars(config, context);
        logger?.debug(
            `Expanded template variables for agent in: ${agentDir}, project: ${projectDir}`
        );
    } catch (error) {
        throw ConfigError.parseError(
            absolutePath,
            `Template expansion failed: ${error instanceof Error ? error.message : String(error)}`
        );
    }

    // Return expanded config - environment variable expansion handled by Zod schema
    return config as AgentConfig;
}

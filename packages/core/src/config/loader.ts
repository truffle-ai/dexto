import { promises as fs } from 'fs';
import path from 'path';
import { parse as parseYaml } from 'yaml';
import { AgentConfig } from '@core/agent/schemas.js';
import { logger } from '../logger/index.js';
import { ConfigError } from './errors.js';

/**
 * Expand template variables in agent configuration
 * Replaces ${{dexto.agent_dir}} with the agent's directory path
 */
function expandTemplateVars(config: unknown, agentDir: string): unknown {
    // Deep clone to avoid mutations
    const result = JSON.parse(JSON.stringify(config));

    // Walk the config recursively
    function walk(obj: unknown): unknown {
        if (typeof obj === 'string') {
            return expandString(obj, agentDir);
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
function expandString(str: string, agentDir: string): string {
    // Replace ${{dexto.agent_dir}} with absolute path
    const result = str.replace(/\${{\s*dexto\.agent_dir\s*}}/g, agentDir);

    // Security: Validate no path traversal for any expanded path
    if (result !== str) {
        validateExpandedPath(str, result, agentDir);
    }

    return result;
}

/**
 * Validate that template expansion doesn't allow path traversal
 */
function validateExpandedPath(original: string, expanded: string, agentDir: string): void {
    const resolved = path.resolve(expanded);
    const agentRoot = path.resolve(agentDir);
    const relative = path.relative(agentRoot, resolved);
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
        throw new Error(
            `Security: Template expansion attempted to escape agent directory.\n` +
                `Original: ${original}\n` +
                `Expanded: ${expanded}\n` +
                `Agent root: ${agentRoot}`
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
 * @returns A Promise that resolves to the parsed `AgentConfig` object with template variables expanded
 * @throws {ConfigError} with FILE_NOT_FOUND if the configuration file does not exist
 * @throws {ConfigError} with FILE_READ_ERROR if file read fails (e.g., permissions issues)
 * @throws {ConfigError} with PARSE_ERROR if the content is not valid YAML or template expansion fails
 */
export async function loadAgentConfig(configPath: string): Promise<AgentConfig> {
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
        config = expandTemplateVars(config, agentDir);
        logger.debug(`Expanded template variables for agent in: ${agentDir}`);
    } catch (error) {
        throw ConfigError.parseError(
            absolutePath,
            `Template expansion failed: ${error instanceof Error ? error.message : String(error)}`
        );
    }

    // Return expanded config - environment variable expansion handled by Zod schema
    return config as AgentConfig;
}

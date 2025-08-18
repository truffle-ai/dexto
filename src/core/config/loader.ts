import { promises as fs } from 'fs';
import path from 'path';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { AgentConfig } from '@core/agent/schemas.js';
import { logger } from '../logger/index.js';
import { resolveConfigPath } from '../utils/path.js';
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

    // Security: Validate no path traversal for expanded paths
    if (result !== str && result.includes('..')) {
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

    if (!resolved.startsWith(agentRoot)) {
        throw new Error(
            `Security: Template expansion attempted to escape agent directory.\n` +
                `Original: ${original}\n` +
                `Expanded: ${expanded}\n` +
                `Agent root: ${agentRoot}`
        );
    }
}

/**
 * Load the complete agent configuration
 * @param configPath Path to the configuration file
 * @returns Complete agent configuration
 */

/**
 * Asynchronously loads and processes an agent configuration file.
 * This function orchestrates the steps of resolving the file path, checking its existence,
 * reading its content, and parsing it as YAML. Environment variable expansion is handled
 * by the Zod schema during validation.
 * Each step is wrapped in a try-catch block to gracefully handle errors and throw specific,
 * custom error types for better error identification and handling by the caller.
 *
 * @param configPath - An optional string representing the path to the configuration file.
 * If not provided, a default path will be resolved internally.
 * @returns A Promise that resolves to the raw parsed `AgentConfig` object.
 * @throws {DextoRuntimeError} with ConfigErrorCode.FILE_NOT_FOUND if the configuration file does not exist.
 * @throws {DextoRuntimeError} with ConfigErrorCode.FILE_READ_ERROR if file read fails (e.g., permissions issues).
 * @throws {DextoRuntimeError} with ConfigErrorCode.PARSE_ERROR if the content is not valid YAML.
 */
export async function loadAgentConfig(configPath?: string): Promise<AgentConfig> {
    // Resolve the absolute path of the configuration file.
    // This utility function should handle cases where `configPath` is undefined,
    // determining a default or conventional location for the config.
    const absolutePath = resolveConfigPath(configPath);

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

/**
 * Asynchronously writes the given agent configuration object to a YAML file.
 * This function handles the serialization of the config object to YAML format
 * and then writes it to the specified file path, logging the action.
 * It uses custom error classes for robust error handling.
 *
 * @param configPath - Optional. The path where the configuration file should be written.
 * If undefined, `resolveConfigPath` will determine the default path.
 * @param config - The `AgentConfig` object to be written to the file.
 * @returns A Promise that resolves when the file has been successfully written.
 * @throws {ConfigFileWriteError} If an error occurs during the YAML stringification or file writing process.
 */
export async function writeConfigFile(
    configPath: string | undefined,
    config: AgentConfig
): Promise<void> {
    // Resolve the absolute path where the configuration file will be written.
    const absolutePath = resolveConfigPath(configPath);

    try {
        // Convert the AgentConfig object into a YAML string.
        const yamlContent = stringifyYaml(config);

        // Write the YAML content to the specified file.
        // The 'utf-8' encoding ensures proper character handling.
        await fs.writeFile(absolutePath, yamlContent, 'utf-8');

        // Log a debug message indicating successful file write.
        logger.debug(`Wrote dexto config to: ${absolutePath}`);
    } catch (error: unknown) {
        // Catch any errors that occur during YAML stringification or file writing.
        // Throw a specific `ConfigFileWriteError` for better error categorization.
        throw ConfigError.fileWriteError(
            absolutePath,
            error instanceof Error ? error.message : String(error)
        );
    }
}

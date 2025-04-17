import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { parse as parseYaml } from 'yaml';
import { AgentConfig } from './types.js';
import { logger } from '../utils/logger.js';
import { resolvePackagePath, DEFAULT_CONFIG_PATH } from '../utils/path.js';
/**
 * Load the complete agent configuration
 * @param configPath Path to the configuration file
 * @returns Complete agent configuration
 */

// Expand $VAR and ${VAR} in all string values recursively
function expandEnvVars(config: any): any {
    if (typeof config === 'string') {
        const expanded = config.replace(
            /\$([A-Z_][A-Z0-9_]*)|\${([A-Z_][A-Z0-9_]*)}/gi,
            (_, v1, v2) => {
                return process.env[v1 || v2] || '';
            }
        );
        return expanded;
    } else if (Array.isArray(config)) {
        return config.map(expandEnvVars);
    } else if (typeof config === 'object' && config !== null) {
        const result: any = {};
        for (const key in config) {
            result[key] = expandEnvVars(config[key]);
        }
        return result;
    }
    return config;
}

export async function loadConfigFile(
    configPath: string
): Promise<AgentConfig> {
    try {
        // Determine where to load from: absolute, default, or user-relative
        const resolveFromPackageRoot = configPath === DEFAULT_CONFIG_PATH;
        const absolutePath = resolvePackagePath(configPath, resolveFromPackageRoot);

        logger.debug(`Attempting to load config from: ${absolutePath}`);

        // Read and parse the config file
        const fileContent = await fs.readFile(absolutePath, 'utf-8');

        try {
            // Parse YAML content
            const config = parseYaml(fileContent);
            // Expand env vars everywhere
            const expandedConfig = expandEnvVars(config);
            return expandedConfig;
        } catch (parseError) {
            throw new Error(`Failed to parse YAML: ${parseError.message}`);
        }
    } catch (error: any) {
        // Include path & cause for better diagnostics
        throw new Error(
            `Failed to load config file at ${error.path || configPath}: ${error.message}`,
            { cause: error }
        );
    }
}

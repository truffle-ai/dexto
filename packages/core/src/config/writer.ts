// packages/core/src/config/writer.ts

import { promises as fs } from 'fs';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import * as path from 'path';
import { LLM_PROVIDERS, type LLMProvider } from '@core/llm/types.js';
import { type GlobalPreferences } from '@core/preferences/schemas.js';
import { logger } from '@core/logger/index.js';
import { type AgentConfig } from '@core/agent/schemas.js';
import { ConfigError } from './errors.js';
import { getOpenRouterIdForModel } from '@core/llm/registry.js';

export interface LLMOverrides {
    provider?: LLMProvider;
    model?: string;
    apiKey?: string;
}

const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';
const OPENROUTER_DEFAULT_MODEL = 'openai/gpt-4o-mini';

function coerceLLMProvider(value: unknown): LLMProvider | undefined {
    if (typeof value !== 'string') {
        return undefined;
    }
    return (LLM_PROVIDERS as readonly string[]).includes(value as LLMProvider)
        ? (value as LLMProvider)
        : undefined;
}

/**
 * Asynchronously writes the given agent configuration object to a YAML file.
 * This function handles the serialization of the config object to YAML format
 * and writes it to the specified file path.
 *
 * @param configPath - Path where the configuration file should be written (absolute or relative)
 * @param config - The `AgentConfig` object to be written to the file
 * @returns A Promise that resolves when the file has been successfully written
 * @throws {ConfigError} with FILE_WRITE_ERROR if an error occurs during YAML stringification or file writing
 */
export async function writeConfigFile(configPath: string, config: AgentConfig): Promise<void> {
    const absolutePath = path.resolve(configPath);

    try {
        // Convert the AgentConfig object into a YAML string.
        const yamlContent = stringifyYaml(config, { indent: 2 });

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

/**
 * Write global LLM preferences to an agent config file
 * @param configPath Absolute path to agent configuration file
 * @param preferences Global preferences to write
 * @param overrides Optional CLI overrides
 * @throws DextoRuntimeError for write failures
 */
export async function writeLLMPreferences(
    configPath: string,
    preferences: GlobalPreferences,
    overrides?: LLMOverrides
): Promise<void> {
    logger.debug(`Writing LLM preferences to: ${configPath}`, {
        provider: overrides?.provider ?? preferences.llm.provider,
        model: overrides?.model ?? preferences.llm.model,
        hasApiKeyOverride: Boolean(overrides?.apiKey),
        hasPreferenceApiKey: Boolean(preferences.llm.apiKey),
    });

    // Load raw config with proper error mapping
    logger.debug(`Reading config file: ${configPath}`);
    let fileContent: string;
    try {
        fileContent = await fs.readFile(configPath, 'utf-8');
        logger.debug(`Successfully read config file (${fileContent.length} chars)`);
    } catch (error) {
        logger.error(`Failed to read config file: ${configPath}`, { error });
        throw ConfigError.fileReadError(
            configPath,
            error instanceof Error ? error.message : String(error)
        );
    }
    // TODO: Use proper typing - raw YAML parsing should be decoupled from schema validation
    let config: AgentConfig;
    try {
        config = parseYaml(fileContent) as AgentConfig;
        logger.debug(`Successfully parsed YAML config`, {
            hasLlmSection: Boolean(config.llm),
            existingProvider: config.llm?.provider,
            existingModel: config.llm?.model,
        });
    } catch (error) {
        logger.error(`Failed to parse YAML config: ${configPath}`, { error });
        throw ConfigError.parseError(
            configPath,
            error instanceof Error ? error.message : String(error)
        );
    }

    // Determine final values (precedence: CLI > preferences > agent defaults)
    const provider = overrides?.provider ?? preferences.llm.provider;
    const explicitModel = overrides?.model ?? preferences.llm.model;
    const apiKey = overrides?.apiKey ?? preferences.llm.apiKey;
    const baseURLPreference = preferences.llm.baseURL;

    let finalModel = explicitModel ?? undefined;
    let finalBaseURL = baseURLPreference;

    if (provider === 'openrouter') {
        finalBaseURL = baseURLPreference ?? OPENROUTER_BASE_URL;

        if (!finalModel || finalModel.trim().length === 0) {
            const agentProvider = coerceLLMProvider(config.llm?.provider);
            const agentModel = config.llm?.model;

            if (config.llm?.provider === 'openrouter' && agentModel) {
                finalModel = agentModel;
            } else if (agentProvider && agentModel) {
                finalModel = getOpenRouterIdForModel(agentProvider, agentModel) ?? undefined;
            }

            if (!finalModel && typeof agentModel === 'string' && agentModel.includes('/')) {
                finalModel = agentModel;
            }

            if (!finalModel) {
                finalModel = OPENROUTER_DEFAULT_MODEL;
            }
        }
    } else if (!finalModel || finalModel.trim().length === 0) {
        finalModel = config.llm?.model;
    }

    if (!finalModel) {
        throw ConfigError.parseError(
            configPath,
            `Cannot determine model for provider '${provider}'.`
        );
    }

    logger.debug(`Applying LLM preferences`, {
        finalProvider: provider,
        finalModel,
        hasApiKey: Boolean(apiKey),
        hasBaseURL: Boolean(finalBaseURL),
        source: overrides ? 'CLI overrides + preferences' : 'preferences only',
    });

    // Note: provider+model validation already handled in preference schema

    // Write only core LLM fields, preserve agent-specific settings
    config.llm = {
        ...config.llm, // Preserve temperature, router, maxTokens, etc.
        provider, // Write user preference
        model: finalModel, // Write user preference
        apiKey, // Write user preference
        ...(finalBaseURL && { baseURL: finalBaseURL }), // Write baseURL if present (required for openai-compatible)
    };

    // Write back to file using the shared writeConfigFile function
    // Type assertion is safe: we read a valid config and only modified the LLM section
    await writeConfigFile(configPath, config);

    logger.info(
        `✓ Applied preferences to: ${path.basename(configPath)} (${provider}/${finalModel})`
    );
}

/**
 * Write preferences to an installed agent (file or directory)
 * @param installedPath Path to installed agent file or directory
 * @param preferences Global preferences to write
 * @param overrides Optional CLI overrides
 */
export async function writePreferencesToAgent(
    installedPath: string,
    preferences: GlobalPreferences,
    overrides?: LLMOverrides
): Promise<void> {
    let stat;
    try {
        stat = await fs.stat(installedPath);
    } catch (error) {
        throw ConfigError.fileReadError(
            installedPath,
            error instanceof Error ? error.message : String(error)
        );
    }

    if (stat.isFile()) {
        // Single file agent - write directly
        if (installedPath.endsWith('.yml') || installedPath.endsWith('.yaml')) {
            await writeLLMPreferences(installedPath, preferences, overrides);
            logger.info(`✓ Applied preferences to: ${path.basename(installedPath)}`, null, 'green');
        } else {
            logger.warn(`Skipping non-YAML file: ${installedPath}`, null, 'yellow');
        }
    } else if (stat.isDirectory()) {
        // Directory-based agent - write to all .yml files
        await writePreferencesToDirectory(installedPath, preferences, overrides);
    } else {
        throw ConfigError.fileReadError(installedPath, 'Path is neither a file nor directory');
    }
}

/**
 * Write preferences to all agent configs in a directory
 * @param installedDir Directory containing agent configs
 * @param preferences Global preferences to write
 * @param overrides Optional CLI overrides
 */
async function writePreferencesToDirectory(
    installedDir: string,
    preferences: GlobalPreferences,
    overrides?: LLMOverrides
): Promise<void> {
    // Find all .yml files in the directory (recursively if needed)
    const configFiles = await findAgentConfigFiles(installedDir);

    if (configFiles.length === 0) {
        logger.warn(`No YAML config files found in: ${installedDir}`);
        return;
    }

    // Apply preferences to each config file
    let successCount = 0;
    const oldProvider = preferences.llm.provider;
    const oldModel = preferences.llm.model;
    const newProvider = overrides?.provider ?? preferences.llm.provider;
    const newModel = overrides?.model ?? preferences.llm.model;

    for (const configPath of configFiles) {
        try {
            await writeLLMPreferences(configPath, preferences, overrides);
            logger.debug(`Applied preferences to: ${path.relative(installedDir, configPath)}`);
            successCount++;
        } catch (error) {
            logger.warn(
                `Failed to write preferences to ${configPath}: ${error instanceof Error ? error.message : String(error)}`
            );
            // Continue with other files
        }
    }

    const describeModel = (model?: string) => model ?? 'inherit';

    logger.info(
        `✓ Applied preferences to ${successCount}/${configFiles.length} config files (${oldProvider}→${newProvider}, ${describeModel(oldModel)}→${describeModel(newModel)})`
    );
}

/**
 * Find all agent configuration files in a directory

 */
async function findAgentConfigFiles(dir: string): Promise<string[]> {
    const configFiles: string[] = [];

    async function walkDir(currentDir: string): Promise<void> {
        const entries = await fs.readdir(currentDir, { withFileTypes: true });

        for (const entry of entries) {
            const fullPath = path.join(currentDir, entry.name);

            if (entry.isDirectory()) {
                // Skip docs and data directories
                if (!['docs', 'data'].includes(entry.name)) {
                    await walkDir(fullPath);
                }
            } else if (entry.name.endsWith('.yml') || entry.name.endsWith('.yaml')) {
                configFiles.push(fullPath);
            }
        }
    }

    await walkDir(dir);
    return configFiles;
}

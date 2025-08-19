// src/core/preferences/injection.ts

import { promises as fs } from 'fs';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import path from 'path';
import { type LLMProvider, isValidProviderModel } from '@core/llm/registry.js';
import { type GlobalPreferences } from './schemas.js';
import { PreferenceErrorCode } from './error-codes.js';
import { logger } from '@core/logger/index.js';
import { DextoRuntimeError, ErrorScope, ErrorType } from '@core/errors/index.js';

export interface LLMOverrides {
    provider?: LLMProvider;
    model?: string;
    apiKey?: string;
}

/**
 * Inject global LLM preferences into an agent config file
 * @param configPath Absolute path to agent configuration file
 * @param preferences Global preferences to inject
 * @param overrides Optional CLI overrides
 * @throws DextoRuntimeError for injection failures
 */
export async function injectLLMPreferences(
    configPath: string,
    preferences: GlobalPreferences,
    overrides?: LLMOverrides
): Promise<void> {
    // Load raw config
    const fileContent = await fs.readFile(configPath, 'utf-8');
    const config = parseYaml(fileContent);

    // Determine final values (precedence: CLI > preferences > agent defaults)
    const provider = overrides?.provider ?? preferences.llm.provider;
    const model = overrides?.model ?? preferences.llm.model;
    const apiKey = overrides?.apiKey ?? preferences.llm.apiKey;

    // Validate provider+model compatibility
    if (!isValidProviderModel(provider, model)) {
        throw new DextoRuntimeError(
            PreferenceErrorCode.MODEL_INCOMPATIBLE,
            ErrorScope.PREFERENCE,
            ErrorType.USER,
            `Model '${model}' is not supported by provider '${provider}'`,
            { provider, model, configPath }
        );
    }

    // Inject only core LLM fields, preserve agent-specific settings
    if (!config.llm) {
        config.llm = {};
    }

    config.llm = {
        ...config.llm, // Preserve temperature, router, maxTokens, etc.
        provider, // Inject user preference
        model, // Inject user preference
        apiKey, // Inject user preference
    };

    // Write back to file
    const yamlContent = stringifyYaml(config, { indent: 2 });
    await fs.writeFile(configPath, yamlContent, 'utf-8');

    logger.info(`✓ Applied preferences to: ${path.basename(configPath)} (${provider}/${model})`);
}

/**
 * Apply preferences to an installed agent (file or directory)
 * @param installedPath Path to installed agent file or directory
 * @param preferences Global preferences to inject
 * @param overrides Optional CLI overrides
 */
export async function injectPreferencesToAgent(
    installedPath: string,
    preferences: GlobalPreferences,
    overrides?: LLMOverrides
): Promise<void> {
    const stat = await fs.stat(installedPath);

    if (stat.isFile()) {
        // Single file agent - inject directly
        if (installedPath.endsWith('.yml') || installedPath.endsWith('.yaml')) {
            await injectLLMPreferences(installedPath, preferences, overrides);
            logger.info(`✓ Applied preferences to: ${path.basename(installedPath)}`);
        } else {
            logger.warn(`Skipping non-YAML file: ${installedPath}`);
        }
    } else if (stat.isDirectory()) {
        // Directory-based agent - inject to all .yml files
        await injectPreferencesToDirectory(installedPath, preferences, overrides);
    } else {
        throw new Error(`Invalid agent path: ${installedPath} (not file or directory)`);
    }
}

/**
 * Apply preferences to all agent configs in a directory
 * @param installedDir Directory containing agent configs
 * @param preferences Global preferences to inject
 * @param overrides Optional CLI overrides
 */
async function injectPreferencesToDirectory(
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
            await injectLLMPreferences(configPath, preferences, overrides);
            logger.debug(`Applied preferences to: ${path.relative(installedDir, configPath)}`);
            successCount++;
        } catch (error) {
            logger.warn(
                `Failed to inject preferences to ${configPath}: ${error instanceof Error ? error.message : String(error)}`
            );
            // Continue with other files
        }
    }

    logger.info(
        `✓ Applied preferences to ${successCount}/${configFiles.length} config files (${oldProvider}→${newProvider}, ${oldModel}→${newModel})`
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

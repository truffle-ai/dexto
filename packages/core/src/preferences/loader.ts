// packages/core/src/preferences/loader.ts

import { existsSync } from 'fs';
import { promises as fs } from 'fs';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { getDextoGlobalPath } from '@core/utils/path.js';
import { logger } from '@core/logger/index.js';
import { DextoValidationError, DextoRuntimeError } from '@core/errors/index.js';
import type { LLMProvider } from '@core/llm/types.js';
import { GlobalPreferencesSchema, type GlobalPreferences } from './schemas.js';
import { PREFERENCES_FILE } from './constants.js';
import { PreferenceError } from './errors.js';

/**
 * Load global preferences from ~/.dexto/preferences.yml
 * @returns Global preferences object
 * @throws DextoRuntimeError if file not found or corrupted
 * @throws DextoValidationError if preferences are invalid
 */
export async function loadGlobalPreferences(): Promise<GlobalPreferences> {
    const preferencesPath = getDextoGlobalPath(PREFERENCES_FILE);

    // Check if preferences file exists
    if (!existsSync(preferencesPath)) {
        throw PreferenceError.fileNotFound(preferencesPath);
    }

    try {
        // Read and parse YAML
        const fileContent = await fs.readFile(preferencesPath, 'utf-8');
        const rawPreferences = parseYaml(fileContent);

        // Validate with schema
        const validation = GlobalPreferencesSchema.safeParse(rawPreferences);
        if (!validation.success) {
            throw PreferenceError.validationFailed(validation.error);
        }

        logger.debug(`Loaded global preferences from: ${preferencesPath}`);
        return validation.data;
    } catch (error) {
        if (error instanceof DextoValidationError || error instanceof DextoRuntimeError) {
            throw error; // Re-throw our own errors
        }

        throw PreferenceError.fileReadError(
            preferencesPath,
            error instanceof Error ? error.message : String(error)
        );
    }
}

/**
 * Save global preferences to ~/.dexto/preferences.yml
 * @param preferences Validated preferences object
 * @throws DextoRuntimeError if write fails
 */
export async function saveGlobalPreferences(preferences: GlobalPreferences): Promise<void> {
    const preferencesPath = getDextoGlobalPath(PREFERENCES_FILE);

    // Validate preferences against schema before saving
    const validation = GlobalPreferencesSchema.safeParse(preferences);
    if (!validation.success) {
        throw PreferenceError.validationFailed(validation.error);
    }

    try {
        logger.info(`Saving global preferences to: ${preferencesPath}`);
        // Ensure ~/.dexto directory exists
        const dextoDir = getDextoGlobalPath('');
        await fs.mkdir(dextoDir, { recursive: true });

        // Convert to YAML with nice formatting
        const yamlContent = stringifyYaml(preferences, {
            indent: 2,
            lineWidth: 100,
            minContentWidth: 20,
        });

        // Write to file
        await fs.writeFile(preferencesPath, yamlContent, 'utf-8');

        logger.info(
            `✓ Saved global preferences ${JSON.stringify(preferences)} to: ${preferencesPath}`
        );
    } catch (error) {
        throw PreferenceError.fileWriteError(
            preferencesPath,
            error instanceof Error ? error.message : String(error)
        );
    }
}

/**
 * Check if global preferences exist (for first-time detection)
 * @returns true if preferences.yml exists
 */
export function globalPreferencesExist(): boolean {
    const preferencesPath = getDextoGlobalPath(PREFERENCES_FILE);
    return existsSync(preferencesPath);
}

/**
 * Get global preferences file path
 * @returns Absolute path to preferences.yml
 */
export function getGlobalPreferencesPath(): string {
    return getDextoGlobalPath(PREFERENCES_FILE);
}

/**
 * Create initial preferences from setup data
 * @param provider Selected LLM provider
 * @param model Selected model
 * @param apiKeyVar Environment variable name for API key
 * @param defaultAgent Optional default agent name
 * @param baseURL Optional base URL for API requests (required for openai-compatible)
 */
export function createInitialPreferences(
    provider: LLMProvider,
    model: string | undefined,
    apiKeyVar: string,
    defaultAgent: string = 'default-agent',
    baseURL?: string
): GlobalPreferences {
    // Allow model to be omitted for OpenRouter and Dexto (OpenRouter-compatible)
    if (
        provider !== 'openrouter' &&
        provider !== 'dexto' &&
        (!model || model.trim().length === 0)
    ) {
        throw new Error(
            `Provider '${provider}' requires a model when creating initial preferences`
        );
    }

    const resolvedBaseURL =
        baseURL ??
        (provider === 'openrouter'
            ? 'https://openrouter.ai/api/v1'
            : provider === 'dexto'
              ? 'https://api.dexto.ai/v1'
              : undefined);

    const llm: GlobalPreferences['llm'] = {
        provider,
        apiKey: `$${apiKeyVar}`,
        ...(model ? { model } : {}),
        ...(resolvedBaseURL && { baseURL: resolvedBaseURL }),
    };

    return {
        llm,
        defaults: {
            defaultAgent,
        },
        setup: {
            completed: true,
        },
    };
}

/**
 * Update specific preference sections
 * @param updates Partial preference updates
 * @returns Updated preferences object
 * @throws DextoRuntimeError if load/save fails
 * @throws DextoValidationError if merged preferences are invalid
 */
export async function updateGlobalPreferences(
    updates: Partial<GlobalPreferences>
): Promise<GlobalPreferences> {
    // Load existing preferences
    const existing = await loadGlobalPreferences();

    // Hybrid merge strategy: different sections have different coherence requirements
    const merged = {
        ...existing,
        ...updates,
        // LLM section requires complete replacement (high coherence - provider/model/apiKey must match)
        llm: updates.llm || existing.llm,
        // Defaults and setup sections allow partial updates (low coherence - independent fields)
        defaults: updates.defaults
            ? { ...existing.defaults, ...updates.defaults }
            : existing.defaults,
        setup: updates.setup ? { ...existing.setup, ...updates.setup } : existing.setup,
    };

    // Validate merged result
    const validation = GlobalPreferencesSchema.safeParse(merged);
    if (!validation.success) {
        throw PreferenceError.validationFailed(validation.error);
    }

    // Save updated preferences
    await saveGlobalPreferences(validation.data);

    return validation.data;
}

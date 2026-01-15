// packages/core/src/preferences/loader.ts

import { existsSync } from 'fs';
import { promises as fs } from 'fs';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { getDextoGlobalPath } from '../utils/path.js';
import { logger } from '@dexto/core';
import { DextoValidationError, DextoRuntimeError } from '@dexto/core';
import type { LLMProvider } from '@dexto/core';
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
        logger.debug(`Saving global preferences to: ${preferencesPath}`);
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

        logger.debug(
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
 * Options for creating initial preferences
 */
export interface CreatePreferencesOptions {
    provider: LLMProvider;
    model: string;
    /** API key env var (optional for providers like Ollama that don't need auth) */
    apiKeyVar?: string;
    defaultAgent?: string;
    defaultMode?: 'cli' | 'web' | 'server' | 'discord' | 'telegram' | 'mcp';
    baseURL?: string;
    /** Reasoning effort for OpenAI reasoning models (o1, o3, codex, gpt-5.x) */
    reasoningEffort?: 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';
    setupCompleted?: boolean;
    /** Whether API key setup was skipped and needs to be configured later */
    apiKeyPending?: boolean;
    /** Whether baseURL setup was skipped and needs to be configured later */
    baseURLPending?: boolean;
}

/**
 * Create initial preferences from setup data
 * @param options Configuration options for preferences
 */
export function createInitialPreferences(options: CreatePreferencesOptions): GlobalPreferences;

/**
 * Create initial preferences from setup data (legacy signature)
 * @deprecated Use options object instead
 */
export function createInitialPreferences(
    provider: LLMProvider,
    model: string,
    apiKeyVar: string,
    defaultAgent?: string
): GlobalPreferences;

export function createInitialPreferences(
    providerOrOptions: LLMProvider | CreatePreferencesOptions,
    model?: string,
    apiKeyVar?: string,
    defaultAgent: string = 'coding-agent'
): GlobalPreferences {
    // Handle options object
    if (typeof providerOrOptions === 'object') {
        const opts = providerOrOptions;
        const llmConfig: GlobalPreferences['llm'] = {
            provider: opts.provider,
            model: opts.model,
        };

        // Only add apiKey if provided (optional for local providers like Ollama)
        if (opts.apiKeyVar) {
            llmConfig.apiKey = `$${opts.apiKeyVar}`;
        }

        // Only add baseURL if provided
        if (opts.baseURL) {
            llmConfig.baseURL = opts.baseURL;
        }

        // Only add reasoningEffort if provided
        if (opts.reasoningEffort) {
            llmConfig.reasoningEffort = opts.reasoningEffort;
        }

        return {
            llm: llmConfig,
            defaults: {
                defaultAgent: opts.defaultAgent || 'coding-agent',
                defaultMode: opts.defaultMode || 'web',
            },
            setup: {
                completed: opts.setupCompleted ?? true,
                apiKeyPending: opts.apiKeyPending ?? false,
                baseURLPending: opts.baseURLPending ?? false,
            },
        };
    }

    // Legacy signature support
    return {
        llm: {
            provider: providerOrOptions,
            model: model!,
            apiKey: `$${apiKeyVar}`,
        },
        defaults: {
            defaultAgent,
            defaultMode: 'web',
        },
        setup: {
            completed: true,
            apiKeyPending: false,
            baseURLPending: false,
        },
    };
}

/**
 * Updates type that allows partial nested objects
 */
export type GlobalPreferencesUpdates = {
    llm?: GlobalPreferences['llm'];
    defaults?: Partial<GlobalPreferences['defaults']>;
    setup?: Partial<GlobalPreferences['setup']>;
};

/**
 * Update specific preference sections
 * @param updates Partial preference updates
 * @returns Updated preferences object
 * @throws DextoRuntimeError if load/save fails
 * @throws DextoValidationError if merged preferences are invalid
 */
export async function updateGlobalPreferences(
    updates: GlobalPreferencesUpdates
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

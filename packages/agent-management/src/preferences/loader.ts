// packages/core/src/preferences/loader.ts

import { existsSync } from 'fs';
import { promises as fs } from 'fs';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import path from 'path';
import { getDextoGlobalPath } from '../utils/path.js';
import { logger } from '@dexto/core';
import { DextoValidationError, DextoRuntimeError } from '@dexto/core';
import type { LLMProvider } from '@dexto/core';
import {
    AgentPreferencesSchema,
    GlobalPreferencesSchema,
    type AgentPreferences,
    type GlobalPreferences,
} from './schemas.js';
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
 * Header comment for preferences.yml file
 */
const PREFERENCES_FILE_HEADER = `# Dexto Global Preferences
# Documentation: https://dexto.dev/docs/configuration/preferences
#
# Sound Notifications:
#   Dexto plays sounds for CLI startup, approval requests, and task completion.
#   Configure which events play sounds:
#     sounds.enabled: true|false
#     sounds.onStartup: true|false
#     sounds.onApprovalRequired: true|false
#     sounds.onTaskComplete: true|false
#
#   Select sound files (paths are relative to ~/.dexto/sounds):
#     sounds.startupSoundFile: builtins/startup.wav
#     sounds.approvalSoundFile: builtins/coin.wav
#     sounds.completeSoundFile: builtins/success.wav
#
#   Tip: Use the /sounds overlay to preview and pick sounds.
#
#   To use custom sounds, copy files into ~/.dexto/sounds/ (subfolders ok) and set the *SoundFile
#   keys to a relative path. Supported audio formats vary by OS (Windows reliably supports .wav).

`;

/**
 * Header comment for agent preferences file
 */
const AGENT_PREFERENCES_FILE_HEADER = `# Dexto Agent Preferences
# Stored per-agent to customize runtime behavior without changing base config.
# Tool control:
#   tools.disabled: list of tool names to exclude from LLM context.

`;

/**
 * Resolve the agent preferences file path for an agent ID.
 */
export function getAgentPreferencesPath(agentId: string): string {
    if (!agentId || typeof agentId !== 'string') {
        throw PreferenceError.invalidAgentId(String(agentId));
    }

    const trimmedId = agentId.trim();
    if (!trimmedId) {
        throw PreferenceError.invalidAgentId(agentId);
    }

    const hasSeparators = trimmedId.includes('/') || trimmedId.includes('\\');
    if (hasSeparators || trimmedId !== path.basename(trimmedId)) {
        throw PreferenceError.invalidAgentId(agentId);
    }

    const allowedPattern = /^[a-zA-Z0-9_-]+$/;
    if (!allowedPattern.test(trimmedId)) {
        throw PreferenceError.invalidAgentId(agentId);
    }

    const filename = `${trimmedId}.preferences.yml`;
    return getDextoGlobalPath(path.join('agents', filename));
}

/**
 * Load agent preferences from ~/.dexto/agents/<agentId>.preferences.yml
 */
export async function loadAgentPreferences(agentId: string): Promise<AgentPreferences> {
    const preferencesPath = getAgentPreferencesPath(agentId);

    if (!existsSync(preferencesPath)) {
        throw PreferenceError.fileNotFound(preferencesPath);
    }

    try {
        const fileContent = await fs.readFile(preferencesPath, 'utf-8');
        const rawPreferences = parseYaml(fileContent);

        const validation = AgentPreferencesSchema.safeParse(rawPreferences);
        if (!validation.success) {
            throw PreferenceError.validationFailed(validation.error);
        }

        logger.debug(`Loaded agent preferences from: ${preferencesPath}`);
        return validation.data;
    } catch (error) {
        if (error instanceof DextoValidationError || error instanceof DextoRuntimeError) {
            throw error;
        }

        throw PreferenceError.fileReadError(
            preferencesPath,
            error instanceof Error ? error.message : String(error)
        );
    }
}

/**
 * Save agent preferences to ~/.dexto/agents/<agentId>.preferences.yml
 */
export async function saveAgentPreferences(
    agentId: string,
    preferences: AgentPreferences
): Promise<void> {
    const preferencesPath = getAgentPreferencesPath(agentId);

    const validation = AgentPreferencesSchema.safeParse(preferences);
    if (!validation.success) {
        throw PreferenceError.validationFailed(validation.error);
    }

    try {
        logger.debug(`Saving agent preferences to: ${preferencesPath}`);

        await fs.mkdir(path.dirname(preferencesPath), { recursive: true });

        const yamlContent = stringifyYaml(preferences, {
            indent: 2,
            lineWidth: 100,
            minContentWidth: 20,
        });

        await fs.writeFile(preferencesPath, AGENT_PREFERENCES_FILE_HEADER + yamlContent, 'utf-8');

        logger.debug(
            `✓ Saved agent preferences ${JSON.stringify(preferences)} to: ${preferencesPath}`
        );
    } catch (error) {
        throw PreferenceError.fileWriteError(
            preferencesPath,
            error instanceof Error ? error.message : String(error)
        );
    }
}

/**
 * Check if agent preferences exist (for first-time detection)
 */
export function agentPreferencesExist(agentId: string): boolean {
    const preferencesPath = getAgentPreferencesPath(agentId);
    return existsSync(preferencesPath);
}

/**
 * Update agent preferences with partial updates
 */
export async function updateAgentPreferences(
    agentId: string,
    updates: Partial<AgentPreferences>
): Promise<AgentPreferences> {
    const existing = await loadAgentPreferences(agentId);
    const merged = {
        ...existing,
        ...updates,
        tools: updates.tools ? { ...existing.tools, ...updates.tools } : existing.tools,
    };

    const validation = AgentPreferencesSchema.safeParse(merged);
    if (!validation.success) {
        throw PreferenceError.validationFailed(validation.error);
    }

    await saveAgentPreferences(agentId, validation.data);

    return validation.data;
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

        // Write to file with header comment
        await fs.writeFile(preferencesPath, PREFERENCES_FILE_HEADER + yamlContent, 'utf-8');

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
    /** Sound notification preferences */
    sounds?: {
        enabled?: boolean;
        onStartup?: boolean;
        startupSoundFile?: string;
        onApprovalRequired?: boolean;
        approvalSoundFile?: string;
        onTaskComplete?: boolean;
        completeSoundFile?: string;
    };
}

/**
 * Create initial preferences from setup data
 * @param options Configuration options for preferences
 */
export function createInitialPreferences(options: CreatePreferencesOptions): GlobalPreferences {
    const llmConfig: GlobalPreferences['llm'] = {
        provider: options.provider,
        model: options.model,
    };

    // Only add apiKey if provided (optional for local providers like Ollama)
    if (options.apiKeyVar) {
        llmConfig.apiKey = '$' + options.apiKeyVar;
    }

    // Only add baseURL if provided
    if (options.baseURL) {
        llmConfig.baseURL = options.baseURL;
    }

    // Only add reasoningEffort if provided
    if (options.reasoningEffort) {
        llmConfig.reasoningEffort = options.reasoningEffort;
    }

    return {
        llm: llmConfig,
        defaults: {
            defaultAgent: options.defaultAgent || 'coding-agent',
            defaultMode: options.defaultMode || 'web',
        },
        setup: {
            completed: options.setupCompleted ?? true,
            apiKeyPending: options.apiKeyPending ?? false,
            baseURLPending: options.baseURLPending ?? false,
        },
        sounds: {
            enabled: options.sounds?.enabled ?? true,
            onStartup: options.sounds?.onStartup ?? false,
            ...(options.sounds?.startupSoundFile
                ? { startupSoundFile: options.sounds.startupSoundFile }
                : {}),
            onApprovalRequired: options.sounds?.onApprovalRequired ?? true,
            ...(options.sounds?.approvalSoundFile
                ? { approvalSoundFile: options.sounds.approvalSoundFile }
                : {}),
            onTaskComplete: options.sounds?.onTaskComplete ?? true,
            ...(options.sounds?.completeSoundFile
                ? { completeSoundFile: options.sounds.completeSoundFile }
                : {}),
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
    sounds?: Partial<GlobalPreferences['sounds']>;
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
        // Defaults, setup, and sounds sections allow partial updates (low coherence - independent fields)
        defaults: updates.defaults
            ? { ...existing.defaults, ...updates.defaults }
            : existing.defaults,
        setup: updates.setup ? { ...existing.setup, ...updates.setup } : existing.setup,
        sounds: updates.sounds ? { ...existing.sounds, ...updates.sounds } : existing.sounds,
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

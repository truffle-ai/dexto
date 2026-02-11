/**
 * Effective LLM Configuration Resolution
 *
 * This module provides utilities to determine the effective LLM configuration
 * at runtime, considering the layered config approach.
 *
 * ## Configuration Layers (Priority Order)
 *
 * 1. **agent.local.yml** (highest priority) - Agent-specific user overrides
 *    - Path: `~/.dexto/agents/{agent-id}/{agent-id}.local.yml`
 *    - Use case: User wants a specific agent to use a different LLM
 *    - NOT YET IMPLEMENTED - see feature-plans/auto-update.md section 8.9-8.11
 *
 * 2. **preferences.yml** - User's global default LLM
 *    - Path: `~/.dexto/preferences.yml`
 *    - Use case: User's default choice from setup wizard or `/model` command
 *    - This is where most users' LLM config comes from
 *
 * 3. **agent.yml** (lowest priority) - Bundled agent defaults
 *    - Path: `~/.dexto/agents/{agent-id}/{agent-id}.yml`
 *    - Use case: Fallback for users who skip setup or power users with BYOK
 *    - This file is managed by Dexto and replaced on CLI updates
 *
 * ## Usage
 *
 * ```typescript
 * import { getEffectiveLLMConfig } from './config/effective-llm.js';
 *
 * const llm = await getEffectiveLLMConfig();
 * if (llm?.provider === 'dexto-nova') {
 *   // User is configured to use Dexto Nova credits
 * }
 *
 * console.log(`Using ${llm.model} via ${llm.provider} (from ${llm.source})`);
 * ```
 *
 * ## Related Documentation
 *
 * - feature-plans/auto-update.md - Layered config and .local.yml design
 * - feature-plans/holistic-dexto-auth-analysis/ - Explicit provider routing
 *
 * @module effective-llm
 */

import type { LLMProvider } from '@dexto/core';
import {
    loadGlobalPreferences,
    globalPreferencesExist,
    loadAgentConfig,
    resolveAgentPath,
} from '@dexto/agent-management';
import { logger } from '@dexto/core';

/**
 * Source of the effective LLM configuration
 */
export type LLMConfigSource =
    | 'local' // From agent.local.yml (not yet implemented)
    | 'preferences' // From preferences.yml (most common)
    | 'bundled'; // From bundled agent.yml (fallback)

/**
 * The resolved effective LLM configuration with source tracking
 */
export interface EffectiveLLMConfig {
    /** LLM provider (e.g., 'dexto-nova', 'anthropic', 'openai') */
    provider: LLMProvider;
    /** Model identifier (format depends on provider) */
    model: string;
    /** API key or environment variable reference (e.g., '$DEXTO_API_KEY') */
    apiKey?: string;
    /** Base URL for custom endpoints */
    baseURL?: string;
    /** Where this config came from */
    source: LLMConfigSource;
}

/**
 * Options for getEffectiveLLMConfig
 */
export interface GetEffectiveLLMConfigOptions {
    /**
     * Agent ID to resolve config for.
     * @default 'coding-agent'
     */
    agentId?: string;

    /**
     * Whether to include the bundled agent config as fallback.
     * Set to false if you only want user-configured LLM.
     * @default true
     */
    includeBundledFallback?: boolean;
}

/**
 * Get the effective LLM configuration considering all config layers.
 *
 * This function resolves which LLM config will actually be used at runtime
 * by checking each layer in priority order:
 *
 * 1. agent.local.yml (NOT YET IMPLEMENTED)
 * 2. preferences.yml
 * 3. bundled agent.yml (if includeBundledFallback is true)
 *
 * @param options - Configuration options
 * @returns The effective LLM config with source, or null if none found
 *
 * @example
 * ```typescript
 * // Get effective LLM for default agent
 * const llm = await getEffectiveLLMConfig();
 *
 * // Get effective LLM for a specific agent
 * const llm = await getEffectiveLLMConfig({ agentId: 'explore-agent' });
 *
 * // Only get user-configured LLM (no bundled fallback)
 * const llm = await getEffectiveLLMConfig({ includeBundledFallback: false });
 * ```
 */
export async function getEffectiveLLMConfig(
    options: GetEffectiveLLMConfigOptions = {}
): Promise<EffectiveLLMConfig | null> {
    const { agentId = 'coding-agent', includeBundledFallback = true } = options;

    // -------------------------------------------------------------------------
    // Layer 1: agent.local.yml (NOT YET IMPLEMENTED)
    // -------------------------------------------------------------------------
    // TODO: Implement .local.yml loading when the feature is built
    // See feature-plans/auto-update.md section 8.9-8.11 for the design
    //
    // The implementation would look something like:
    //
    // const localConfig = await loadLocalAgentConfig(agentId);
    // if (localConfig?.llm?.provider && localConfig?.llm?.model) {
    //     logger.debug(`Using LLM config from ${agentId}.local.yml`);
    //     return {
    //         provider: localConfig.llm.provider,
    //         model: localConfig.llm.model,
    //         apiKey: localConfig.llm.apiKey,
    //         baseURL: localConfig.llm.baseURL,
    //         source: 'local',
    //     };
    // }
    // -------------------------------------------------------------------------

    // -------------------------------------------------------------------------
    // Layer 2: preferences.yml (user's global default)
    // -------------------------------------------------------------------------
    if (globalPreferencesExist()) {
        try {
            const preferences = await loadGlobalPreferences();
            if (preferences?.llm?.provider && preferences?.llm?.model) {
                logger.debug('Using LLM config from preferences.yml');
                const result: EffectiveLLMConfig = {
                    provider: preferences.llm.provider,
                    model: preferences.llm.model,
                    source: 'preferences',
                };
                // Only set optional fields if they have values
                if (preferences.llm.apiKey) {
                    result.apiKey = preferences.llm.apiKey;
                }
                if (preferences.llm.baseURL) {
                    result.baseURL = preferences.llm.baseURL;
                }
                return result;
            }
        } catch (error) {
            logger.debug(
                `Could not load preferences: ${error instanceof Error ? error.message : String(error)}`
            );
        }
    }

    // -------------------------------------------------------------------------
    // Layer 3: Bundled agent.yml (fallback)
    // -------------------------------------------------------------------------
    if (includeBundledFallback) {
        try {
            const agentPath = await resolveAgentPath(agentId);
            if (agentPath) {
                const agentConfig = await loadAgentConfig(agentPath);
                if (agentConfig?.llm?.provider && agentConfig?.llm?.model) {
                    logger.debug(`Using LLM config from bundled ${agentId}.yml`);
                    const result: EffectiveLLMConfig = {
                        provider: agentConfig.llm.provider,
                        model: agentConfig.llm.model,
                        source: 'bundled',
                    };
                    // Only set optional fields if they have values
                    if (agentConfig.llm.apiKey) {
                        result.apiKey = agentConfig.llm.apiKey;
                    }
                    if (agentConfig.llm.baseURL) {
                        result.baseURL = agentConfig.llm.baseURL;
                    }
                    return result;
                }
            }
        } catch (error) {
            logger.debug(
                `Could not load agent config: ${error instanceof Error ? error.message : String(error)}`
            );
        }
    }

    return null;
}

/**
 * Check if the effective LLM config uses Dexto credits.
 *
 * Convenience function that checks if the user is configured to use
 * the Dexto provider (which requires authentication).
 *
 * @param options - Same options as getEffectiveLLMConfig
 * @returns true if using provider: dexto-nova, false otherwise
 *
 * @example
 * ```typescript
 * if (await isUsingDextoCredits()) {
 *   // Check authentication, show billing info, etc.
 * }
 * ```
 */
export async function isUsingDextoCredits(
    options: GetEffectiveLLMConfigOptions = {}
): Promise<boolean> {
    const config = await getEffectiveLLMConfig(options);
    return config?.provider === 'dexto-nova';
}

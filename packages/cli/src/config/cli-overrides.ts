/**
 * CLI-specific configuration types and utilities
 * This file handles CLI argument processing and config merging logic
 *
 * TODO: Future preference system enhancement
 * Currently, global preferences are only applied to the coding-agent at runtime.
 * Future improvements could include:
 * - Per-agent preference overrides (~/.dexto/agents/{id}/preferences.yml)
 * - Agent capability requirements (requires: { vision: true, toolUse: true })
 * - Merge strategy configuration (global > agent, agent > global, field-specific)
 * - User-controlled preference scopes via CLI flags (--prefer-global-llm)
 */

import type { AgentConfig, LLMConfig, LLMProvider } from '@dexto/core';
import { hasAllRegistryModelsSupport, transformModelNameForProvider } from '@dexto/core';
import type { GlobalPreferences } from '@dexto/agent-management';

/**
 * Result of resolving a locked model with user preferences
 */
export interface LockedModelResolution {
    /** The provider to use */
    provider: LLMProvider;
    /** The model ID to use (may be transformed for gateway providers) */
    model: string;
    /** Whether provider was switched from agent's original */
    providerSwitched: boolean;
    /** Whether the locked model could be used (false if incompatible) */
    lockedModelUsed: boolean;
}

/**
 * Resolves how to apply user preferences when an agent has a locked model.
 *
 * Logic:
 * 1. If user's provider can serve all registry models (dexto, openrouter) →
 *    Use user's provider + transform agent's model to gateway format
 * 2. If user's provider matches agent's provider →
 *    Keep agent's locked model, just use user's credentials
 * 3. If incompatible (different providers, user can't serve agent's model) →
 *    Return agent's original config (can't honor the lock)
 *
 * @param agentProvider The agent's configured provider
 * @param agentModel The agent's locked model
 * @param userProvider The user's preferred provider
 * @returns Resolution with provider/model to use and metadata
 */
export function resolveLockedModel(
    agentProvider: LLMProvider,
    agentModel: string,
    userProvider: LLMProvider
): LockedModelResolution {
    // Case 1: User's provider is a gateway that can serve all models
    if (hasAllRegistryModelsSupport(userProvider)) {
        const transformedModel = transformModelNameForProvider(
            agentModel,
            agentProvider,
            userProvider
        );
        return {
            provider: userProvider,
            model: transformedModel,
            providerSwitched: true,
            lockedModelUsed: true,
        };
    }

    // Case 2: Same provider family - use locked model with user's credentials
    if (userProvider === agentProvider) {
        return {
            provider: agentProvider,
            model: agentModel,
            providerSwitched: false,
            lockedModelUsed: true,
        };
    }

    // Case 3: Incompatible - can't use locked model with user's provider
    // Return agent's original config
    return {
        provider: agentProvider,
        model: agentModel,
        providerSwitched: false,
        lockedModelUsed: false, // Indicates we couldn't honor the lock with user's provider
    };
}

/**
 * CLI config override type for fields that can be overridden via CLI
 * Uses input type (LLMConfig) since these represent user-provided CLI arguments
 */
export interface CLIConfigOverrides
    extends Partial<Pick<LLMConfig, 'provider' | 'model' | 'apiKey'>> {
    autoApprove?: boolean;
    /** When false (via --no-elicitation), disables elicitation */
    elicitation?: boolean;
}

/**
 * Applies CLI overrides to an agent configuration
 * This merges CLI arguments into the base config without validation.
 * Validation should be performed separately after this merge step.
 *
 * @param baseConfig The configuration loaded from file
 * @param cliOverrides CLI arguments to override specific fields
 * @returns Merged configuration (unvalidated)
 */
export function applyCLIOverrides(
    baseConfig: AgentConfig,
    cliOverrides?: CLIConfigOverrides
): AgentConfig {
    if (!cliOverrides || Object.keys(cliOverrides).length === 0) {
        // No overrides, return base config as-is (no validation yet)
        return baseConfig;
    }

    // Create a deep copy of the base config for modification
    const mergedConfig = JSON.parse(JSON.stringify(baseConfig)) as AgentConfig;

    // Apply CLI overrides to LLM config (llm is required in AgentConfig)
    if (cliOverrides.provider) {
        mergedConfig.llm.provider = cliOverrides.provider;
    }
    if (cliOverrides.model) {
        mergedConfig.llm.model = cliOverrides.model;
    }
    if (cliOverrides.apiKey) {
        mergedConfig.llm.apiKey = cliOverrides.apiKey;
    }

    if (cliOverrides.autoApprove) {
        // Ensure toolConfirmation section exists before overriding
        if (!mergedConfig.toolConfirmation) {
            mergedConfig.toolConfirmation = { mode: 'auto-approve' };
        } else {
            mergedConfig.toolConfirmation.mode = 'auto-approve';
        }
    }

    if (cliOverrides.elicitation === false) {
        // Ensure elicitation section exists before overriding
        if (!mergedConfig.elicitation) {
            mergedConfig.elicitation = { enabled: false };
        } else {
            mergedConfig.elicitation.enabled = false;
        }
    }

    // Return merged config without validation - validation happens later
    return mergedConfig;
}

/**
 * Applies global user preferences to an agent configuration at runtime.
 * This is used to ensure user's LLM preferences are applied to all agents.
 *
 * Unlike writeLLMPreferences() which modifies files, this performs an in-memory merge.
 *
 * Respects the `modelLocked` flag in agent config:
 * - If NOT locked: user preferences fully override agent defaults
 * - If locked: keeps agent's model, but may switch provider if compatible
 *
 * @param baseConfig The configuration loaded from agent file
 * @param preferences Global user preferences
 * @returns Merged configuration with user preferences applied
 */
export function applyUserPreferences(
    baseConfig: AgentConfig,
    preferences: GlobalPreferences
): AgentConfig {
    // Create a deep copy to avoid mutating the original
    const mergedConfig = JSON.parse(JSON.stringify(baseConfig)) as AgentConfig;

    // No LLM preferences to apply
    if (!preferences.llm) {
        return mergedConfig;
    }

    const userProvider = preferences.llm.provider;
    const userModel = preferences.llm.model;
    const agentProvider = baseConfig.llm.provider;
    const agentModel = baseConfig.llm.model;
    const isModelLocked = baseConfig.llm.modelLocked === true;

    if (isModelLocked) {
        // Model is locked - use the resolution logic to determine provider/model
        const resolution = resolveLockedModel(agentProvider, agentModel, userProvider);

        mergedConfig.llm = {
            ...mergedConfig.llm,
            provider: resolution.provider,
            model: resolution.model,
        };

        // Use user's API key if provider was switched or same provider
        if (resolution.lockedModelUsed && preferences.llm.apiKey) {
            mergedConfig.llm.apiKey = preferences.llm.apiKey;
        }
        // If lockedModelUsed is false, keep agent's original apiKey (incompatible case)
    } else {
        // Model is NOT locked - apply user preferences fully (original behavior)
        mergedConfig.llm = {
            ...mergedConfig.llm,
            provider: userProvider,
            model: userModel,
        };

        // Only override apiKey if user has one configured
        if (preferences.llm.apiKey) {
            mergedConfig.llm.apiKey = preferences.llm.apiKey;
        }

        // Only override baseURL if user has one configured
        if (preferences.llm.baseURL) {
            mergedConfig.llm.baseURL = preferences.llm.baseURL;
        }
    }

    return mergedConfig;
}

/**
 * Result of agent compatibility check
 */
export interface AgentCompatibilityResult {
    compatible: boolean;
    warnings: string[];
    instructions: string[];
    agentProvider: LLMProvider;
    agentModel: string;
    userProvider: LLMProvider | undefined;
    userModel: string | undefined;
    userHasApiKey: boolean;
}

/**
 * Check if user's current setup is compatible with an agent's requirements.
 * Used when switching to non-default agents to warn users about potential issues.
 *
 * @param agentConfig The agent's configuration
 * @param preferences User's global preferences (if available)
 * @param resolvedApiKey Whether user has a valid API key for the agent's provider
 * @returns Compatibility result with warnings and instructions
 */
export function checkAgentCompatibility(
    agentConfig: AgentConfig,
    preferences: GlobalPreferences | null,
    resolvedApiKey: string | undefined
): AgentCompatibilityResult {
    const warnings: string[] = [];
    const instructions: string[] = [];

    const agentProvider = agentConfig.llm.provider;
    const agentModel = agentConfig.llm.model;
    const userProvider = preferences?.llm?.provider;
    const userModel = preferences?.llm?.model;
    const userHasApiKey = Boolean(resolvedApiKey);

    // Check if user has API key for this agent's provider
    if (!userHasApiKey) {
        warnings.push(
            `This agent uses ${agentProvider} but you don't have an API key configured for it.`
        );
        instructions.push(`Run: dexto setup --provider ${agentProvider}`);
    }

    // Check if agent uses a different provider than user's default
    // Only show this as a warning if API key is missing; otherwise just informational
    if (userProvider && agentProvider !== userProvider && !userHasApiKey) {
        const userDefault = userModel ? `${userProvider}/${userModel}` : userProvider;
        warnings.push(
            `This agent uses ${agentProvider}/${agentModel} (your default is ${userDefault}).`
        );
        instructions.push(
            `Make sure you have ${getEnvVarForProvider(agentProvider)} set in your environment.`
        );
    }

    return {
        compatible: warnings.length === 0,
        warnings,
        instructions,
        agentProvider,
        agentModel,
        userProvider,
        userModel,
        userHasApiKey,
    };
}

/**
 * Get the environment variable name for a provider's API key
 */
function getEnvVarForProvider(provider: LLMProvider): string {
    const envVarMap: Record<LLMProvider, string> = {
        openai: 'OPENAI_API_KEY',
        'openai-compatible': 'OPENAI_API_KEY',
        anthropic: 'ANTHROPIC_API_KEY',
        google: 'GOOGLE_GENERATIVE_AI_API_KEY',
        groq: 'GROQ_API_KEY',
        xai: 'XAI_API_KEY',
        cohere: 'COHERE_API_KEY',
        openrouter: 'OPENROUTER_API_KEY',
        litellm: 'LITELLM_API_KEY',
        glama: 'GLAMA_API_KEY',
        vertex: 'GOOGLE_APPLICATION_CREDENTIALS',
        bedrock: 'AWS_ACCESS_KEY_ID',
        // Local providers don't require API keys (empty string signals no key needed)
        local: '',
        ollama: '',
        // Dexto gateway uses DEXTO_API_KEY from `dexto login`
        dexto: 'DEXTO_API_KEY',
    };
    return envVarMap[provider];
}

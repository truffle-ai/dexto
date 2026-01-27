/**
 * CLI-specific configuration types and utilities
 * This file handles CLI argument processing and config merging logic
 *
 * Current behavior (Three-Layer LLM Resolution):
 * Global preferences from preferences.yml are applied to ALL agents at runtime.
 * See feature-plans/auto-update.md section 8.11 for the resolution order:
 *   1. agent.local.yml llm section     → Agent-specific override (NOT YET IMPLEMENTED)
 *   2. preferences.yml llm section     → User's global default (CURRENT)
 *   3. agent.yml llm section           → Bundled fallback
 *
 * Note: Sub-agents spawned via RuntimeService have separate LLM resolution logic
 * that tries to preserve the sub-agent's intended model when possible.
 * See packages/agent-management/src/tool-provider/llm-resolution.ts
 *
 * TODO: Future enhancements
 * - Per-agent local overrides (~/.dexto/agents/{id}/{id}.local.yml)
 * - Agent capability requirements (requires: { vision: true, toolUse: true })
 * - Merge strategy configuration for non-LLM fields
 */

import type { AgentConfig, LLMConfig, LLMProvider } from '@dexto/core';
import type { GlobalPreferences } from '@dexto/agent-management';

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
 * User preferences fully override agent defaults for provider, model, and apiKey.
 *
 * @param baseConfig The configuration loaded from agent file
 * @param preferences Global user preferences
 * @returns Merged configuration with user preferences applied
 */
export function applyUserPreferences(
    baseConfig: AgentConfig,
    preferences: Partial<GlobalPreferences>
): AgentConfig {
    // Create a deep copy to avoid mutating the original
    const mergedConfig = JSON.parse(JSON.stringify(baseConfig)) as AgentConfig;

    // No LLM preferences to apply
    if (!preferences.llm) {
        return mergedConfig;
    }

    // Apply user preferences - only override if defined (preferences is Partial)
    if (preferences.llm.provider) {
        mergedConfig.llm.provider = preferences.llm.provider;
    }
    if (preferences.llm.model) {
        mergedConfig.llm.model = preferences.llm.model;
    }
    if (preferences.llm.apiKey) {
        mergedConfig.llm.apiKey = preferences.llm.apiKey;
    }
    if (preferences.llm.baseURL) {
        mergedConfig.llm.baseURL = preferences.llm.baseURL;
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

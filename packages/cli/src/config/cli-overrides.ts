/**
 * CLI-specific configuration types and utilities
 * This file handles CLI argument processing and config merging logic
 */

import type { AgentConfig, LLMConfig } from '@dexto/core';

/**
 * CLI config override type for fields that can be overridden via CLI
 * Uses input type (LLMConfig) since these represent user-provided CLI arguments
 */
export interface CLIConfigOverrides
    extends Partial<Pick<LLMConfig, 'provider' | 'model' | 'router' | 'apiKey'>> {
    autoApprove?: boolean;
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
    const mergedConfig = JSON.parse(JSON.stringify(baseConfig));

    // Ensure llm section exists
    if (!mergedConfig.llm) {
        mergedConfig.llm = {};
    }

    // Apply CLI overrides to LLM config
    if (cliOverrides.provider) {
        mergedConfig.llm.provider = cliOverrides.provider;
    }
    if (cliOverrides.model) {
        mergedConfig.llm.model = cliOverrides.model;
    }
    if (cliOverrides.router) {
        mergedConfig.llm.router = cliOverrides.router;
    }
    if (cliOverrides.apiKey) {
        mergedConfig.llm.apiKey = cliOverrides.apiKey;
    }

    if (cliOverrides.autoApprove) {
        // Ensure toolConfirmation section exists before overriding
        if (!mergedConfig.toolConfirmation) {
            mergedConfig.toolConfirmation = {} as AgentConfig['toolConfirmation'];
        }

        mergedConfig.toolConfirmation.mode = 'auto-approve';
    }

    // Return merged config without validation - validation happens later
    return mergedConfig;
}

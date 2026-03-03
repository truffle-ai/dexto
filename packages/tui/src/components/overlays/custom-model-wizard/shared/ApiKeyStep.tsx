/**
 * ApiKeyStep Component
 * Renders API key status and help text for providers that support API keys.
 */

import React from 'react';
import { Box, Text } from 'ink';
import { getProviderKeyStatus } from '@dexto/agent-management';
import type { LLMProvider } from '@dexto/core';
import type { CustomModelProvider } from '@dexto/agent-management';

interface ApiKeyStepProps {
    /** The provider type */
    provider: CustomModelProvider;
}

/**
 * Displays API key status for the current provider.
 * Shows whether the key is already configured or needs to be set.
 */
export function ApiKeyStep({ provider }: ApiKeyStepProps): React.ReactElement {
    const keyStatus = getProviderKeyStatus(provider as LLMProvider);

    if (keyStatus.hasApiKey) {
        return <Text color="green">✓ {keyStatus.envVar} already set, press Enter to skip</Text>;
    }

    return <Text color="yellowBright">No {keyStatus.envVar} configured</Text>;
}

/**
 * Get the env var name for a provider's API key.
 */
export function getProviderEnvVar(provider: CustomModelProvider): string {
    const keyStatus = getProviderKeyStatus(provider as LLMProvider);
    return keyStatus.envVar;
}

/**
 * Check if a provider has an API key configured.
 */
export function hasApiKeyConfigured(provider: CustomModelProvider): boolean {
    const keyStatus = getProviderKeyStatus(provider as LLMProvider);
    return keyStatus.hasApiKey;
}

export default ApiKeyStep;

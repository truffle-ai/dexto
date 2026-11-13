/**
 * ApiKeyInput Component
 * Interactive overlay for entering API keys when switching to a provider without one
 */

import React, { useState, useEffect, forwardRef, useImperativeHandle, useCallback } from 'react';
import { Box, Text } from 'ink';
import type { Key } from '../../hooks/useInputOrchestrator.js';
import type { LLMProvider } from '@dexto/llm';
import { getPrimaryApiKeyEnvVar, saveProviderApiKey } from '@dexto/agent-management';
import { applyLayeredEnvironmentLoading } from '../../host/index.js';
import {
    getProviderDisplayName,
    isValidApiKeyFormat,
    getProviderInstructions,
} from '../../host/index.js';
import { tone } from '../../signal/index.js';

export interface ApiKeyInputProps {
    isVisible: boolean;
    provider: LLMProvider;
    onSaved: (meta: { provider: LLMProvider; envVar: string }) => void;
    onClose: () => void;
}

export interface ApiKeyInputHandle {
    handleInput: (input: string, key: Key) => boolean;
}

/**
 * API key input overlay - prompts user for API key when switching to a provider
 * that doesn't have a configured key
 */
const ApiKeyInput = forwardRef<ApiKeyInputHandle, ApiKeyInputProps>(function ApiKeyInput(
    { isVisible, provider, onSaved, onClose },
    ref
) {
    const [apiKey, setApiKey] = useState('');
    const [error, setError] = useState<string | null>(null);
    const [isSaving, setIsSaving] = useState(false);

    // Reset when becoming visible or provider changes
    useEffect(() => {
        if (isVisible) {
            setApiKey('');
            setError(null);
            setIsSaving(false);
        }
    }, [isVisible, provider]);

    const handleSubmit = useCallback(async () => {
        const trimmedKey = apiKey.trim();

        // Validate
        if (!trimmedKey) {
            setError('API key is required');
            return;
        }

        if (!isValidApiKeyFormat(trimmedKey, provider)) {
            setError(`Invalid ${getProviderDisplayName(provider)} API key format`);
            return;
        }

        setError(null);
        setIsSaving(true);

        try {
            const meta = await saveProviderApiKey(provider, trimmedKey, process.cwd());

            // Reload environment variables so the key is available
            await applyLayeredEnvironmentLoading();

            onSaved({ provider, envVar: meta.envVar });
        } catch (err) {
            setError(`Failed to save: ${err instanceof Error ? err.message : String(err)}`);
            setIsSaving(false);
        }
    }, [apiKey, provider, onSaved]);

    // Handle keyboard input
    useImperativeHandle(
        ref,
        () => ({
            handleInput: (input: string, key: Key): boolean => {
                if (!isVisible || isSaving) return false;

                // Escape to close
                if (key.escape) {
                    onClose();
                    return true;
                }

                // Enter to submit
                if (key.return) {
                    void handleSubmit();
                    return true;
                }

                // Backspace
                if (key.backspace || key.delete) {
                    setApiKey((prev) => prev.slice(0, -1));
                    setError(null);
                    return true;
                }

                // Regular character input
                if (input && !key.ctrl && !key.meta) {
                    setApiKey((prev) => prev + input);
                    setError(null);
                    return true;
                }

                return false;
            },
        }),
        [isVisible, isSaving, onClose, handleSubmit]
    );

    if (!isVisible) return null;

    const providerName = getProviderDisplayName(provider);
    const envVar = getPrimaryApiKeyEnvVar(provider);
    const instructions = getProviderInstructions(provider);

    // Mask the API key for display (show first 4 and last 4 chars)
    const maskedKey =
        apiKey.length > 8
            ? `${apiKey.slice(0, 4)}${'*'.repeat(Math.min(apiKey.length - 8, 20))}${apiKey.slice(-4)}`
            : '*'.repeat(apiKey.length);

    return (
        <Box
            flexDirection="column"
            borderStyle="round"
            borderColor={tone('teal')}
            paddingX={1}
            marginTop={1}
        >
            {/* Header */}
            <Box marginBottom={1}>
                <Text bold color={tone('teal')}>
                    API Key Required for {providerName}
                </Text>
            </Box>

            {/* Instructions */}
            {instructions && (
                <Box flexDirection="column" marginBottom={1}>
                    <Text color={tone('dim')}>{instructions.content}</Text>
                </Box>
            )}

            {/* Env var hint */}
            <Box marginBottom={1}>
                <Text color={tone('dim')}>This key will be saved to </Text>
                <Text color={tone('amber')}>{envVar}</Text>
                <Text color={tone('dim')}> in your .env file</Text>
            </Box>

            {/* Input prompt */}
            <Box flexDirection="column">
                <Text bold>Enter your {providerName} API key:</Text>
            </Box>

            {/* Input field (masked) */}
            <Box marginTop={1}>
                <Text color={tone('teal')}>&gt; </Text>
                <Text>{maskedKey}</Text>
                {!isSaving && <Text color={tone('teal')}>_</Text>}
            </Box>

            {/* Saving indicator */}
            {isSaving && (
                <Box marginTop={1}>
                    <Text color={tone('amber')}>Saving API key...</Text>
                </Box>
            )}

            {/* Error message */}
            {error && (
                <Box marginTop={1}>
                    <Text color={tone('red')}>{error}</Text>
                </Box>
            )}

            {/* Help text */}
            <Box marginTop={1}>
                <Text color={tone('dim')}>Enter to save • Esc to cancel</Text>
            </Box>
        </Box>
    );
});

export default ApiKeyInput;

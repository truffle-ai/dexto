/**
 * CustomModelWizard Component
 * Multi-step wizard for adding custom models (openai-compatible, openrouter, or litellm)
 */

import React, { useState, useEffect, forwardRef, useImperativeHandle, useCallback } from 'react';
import { Box, Text } from 'ink';
import type { Key } from '../../hooks/useInputOrchestrator.js';
import {
    saveCustomModel,
    deleteCustomModel,
    CUSTOM_MODEL_PROVIDERS,
    type CustomModel,
    type CustomModelProvider,
    saveProviderApiKey,
    getProviderKeyStatus,
    resolveApiKeyForProvider,
    determineApiKeyStorage,
} from '@dexto/agent-management';
import {
    logger,
    lookupOpenRouterModel,
    refreshOpenRouterModelCache,
    type LLMProvider,
} from '@dexto/core';

interface WizardStep {
    field: string;
    label: string;
    placeholder: string;
    required: boolean;
    validate?: (value: string) => string | null;
}

/** Common API key step - added to all providers */
const API_KEY_STEP: WizardStep = {
    field: 'apiKey',
    label: 'API Key (optional)',
    placeholder: 'Enter API key for authentication',
    required: false,
};

/** Steps for openai-compatible provider */
const OPENAI_COMPATIBLE_STEPS: WizardStep[] = [
    {
        field: 'name',
        label: 'Model Name',
        placeholder: 'e.g., llama-3-70b, mixtral-8x7b',
        required: true,
        validate: (v) => (v.trim() ? null : 'Model name is required'),
    },
    {
        field: 'baseURL',
        label: 'API Base URL',
        placeholder: 'e.g., http://localhost:11434/v1',
        required: true,
        validate: (v) => {
            if (!v.trim()) return 'Base URL is required';
            try {
                const url = new URL(v);
                if (!['http:', 'https:'].includes(url.protocol)) {
                    return 'URL must use http:// or https://';
                }
                return null;
            } catch {
                return 'Invalid URL format';
            }
        },
    },
    {
        field: 'displayName',
        label: 'Display Name (optional)',
        placeholder: 'e.g., My Local Llama 3',
        required: false,
    },
    {
        field: 'maxInputTokens',
        label: 'Max Input Tokens (optional)',
        placeholder: 'e.g., 128000 (leave blank for default)',
        required: false,
        validate: (v) => {
            if (!v.trim()) return null;
            const num = parseInt(v, 10);
            if (isNaN(num) || num <= 0) return 'Must be a positive number';
            return null;
        },
    },
    API_KEY_STEP,
];

/** Steps for openrouter provider (simpler - no baseURL or maxInputTokens needed) */
const OPENROUTER_STEPS: WizardStep[] = [
    {
        field: 'name',
        label: 'OpenRouter Model ID',
        placeholder: 'e.g., anthropic/claude-3.5-sonnet, openai/gpt-4o',
        required: true,
        validate: (v) => {
            if (!v.trim()) return 'Model ID is required';
            // OpenRouter models typically have format: provider/model-name
            if (!v.includes('/')) {
                return 'OpenRouter models use format: provider/model (e.g., anthropic/claude-3.5-sonnet)';
            }
            // Async validation happens in handleNext
            return null;
        },
    },
    {
        field: 'displayName',
        label: 'Display Name (optional)',
        placeholder: 'e.g., Claude 3.5 Sonnet',
        required: false,
    },
    { ...API_KEY_STEP, placeholder: 'Saved as OPENROUTER_API_KEY if not set, otherwise per-model' },
];

/** Steps for glama provider (fixed endpoint, similar to OpenRouter but no live validation) */
const GLAMA_STEPS: WizardStep[] = [
    {
        field: 'name',
        label: 'Glama Model ID',
        placeholder: 'e.g., openai/gpt-4o, anthropic/claude-3-sonnet',
        required: true,
        validate: (v) => {
            if (!v.trim()) return 'Model ID is required';
            // Glama models typically have format: provider/model-name
            if (!v.includes('/')) {
                return 'Glama models use format: provider/model (e.g., openai/gpt-4o)';
            }
            return null;
        },
    },
    {
        field: 'displayName',
        label: 'Display Name (optional)',
        placeholder: 'e.g., GPT-4o via Glama',
        required: false,
    },
    { ...API_KEY_STEP, placeholder: 'Saved as GLAMA_API_KEY if not set, otherwise per-model' },
];

/** Steps for litellm provider (requires baseURL for user's proxy) */
const LITELLM_STEPS: WizardStep[] = [
    {
        field: 'name',
        label: 'Model Name',
        placeholder: 'e.g., gpt-4, claude-3-sonnet, bedrock/anthropic.claude-v2',
        required: true,
        validate: (v) => (v.trim() ? null : 'Model name is required'),
    },
    {
        field: 'baseURL',
        label: 'LiteLLM Proxy URL',
        placeholder: 'e.g., http://localhost:4000',
        required: true,
        validate: (v) => {
            if (!v.trim()) return 'Base URL is required';
            try {
                const url = new URL(v);
                if (!['http:', 'https:'].includes(url.protocol)) {
                    return 'URL must use http:// or https://';
                }
                return null;
            } catch {
                return 'Invalid URL format';
            }
        },
    },
    {
        field: 'displayName',
        label: 'Display Name (optional)',
        placeholder: 'e.g., My LiteLLM GPT-4',
        required: false,
    },
    {
        field: 'maxInputTokens',
        label: 'Max Input Tokens (optional)',
        placeholder: 'e.g., 128000 (leave blank for default)',
        required: false,
        validate: (v) => {
            if (!v.trim()) return null;
            const num = parseInt(v, 10);
            if (isNaN(num) || num <= 0) return 'Must be a positive number';
            return null;
        },
    },
    { ...API_KEY_STEP, placeholder: 'Saved as LITELLM_API_KEY if not set, otherwise per-model' },
];

/** Steps for bedrock provider (custom model IDs, no baseURL/apiKey needed) */
const BEDROCK_STEPS: WizardStep[] = [
    {
        field: 'name',
        label: 'Bedrock Model ID',
        placeholder: 'e.g., anthropic.claude-3-haiku-20240307-v1:0',
        required: true,
        validate: (v) => (v.trim() ? null : 'Model ID is required'),
    },
    {
        field: 'displayName',
        label: 'Display Name (optional)',
        placeholder: 'e.g., Claude 3 Haiku',
        required: false,
    },
    {
        field: 'maxInputTokens',
        label: 'Max Input Tokens (optional)',
        placeholder: 'e.g., 200000 (leave blank for default)',
        required: false,
        validate: (v) => {
            if (!v.trim()) return null;
            const num = parseInt(v, 10);
            if (isNaN(num) || num <= 0) return 'Must be a positive number';
            return null;
        },
    },
    // NO apiKey step - Bedrock uses AWS credentials from environment
];

/**
 * Validate OpenRouter model ID against the registry.
 * Refreshes cache if stale and returns error message if invalid.
 */
async function validateOpenRouterModel(modelId: string): Promise<string | null> {
    let status = lookupOpenRouterModel(modelId);

    // If cache is stale/empty, try to refresh
    if (status === 'unknown') {
        try {
            await refreshOpenRouterModelCache();
            status = lookupOpenRouterModel(modelId);
        } catch {
            // Network failed - allow the model (graceful degradation)
            return null;
        }
    }

    if (status === 'invalid') {
        return `Model '${modelId}' not found in OpenRouter. Check the model ID at https://openrouter.ai/models`;
    }

    return null;
}

function getStepsForProvider(provider: CustomModelProvider): WizardStep[] {
    switch (provider) {
        case 'openrouter':
            return OPENROUTER_STEPS;
        case 'glama':
            return GLAMA_STEPS;
        case 'litellm':
            return LITELLM_STEPS;
        case 'bedrock':
            return BEDROCK_STEPS;
        default:
            return OPENAI_COMPATIBLE_STEPS;
    }
}

interface CustomModelWizardProps {
    isVisible: boolean;
    onComplete: (model: CustomModel) => void;
    onClose: () => void;
    /** Optional model to edit - if provided, form will be pre-populated */
    initialModel?: CustomModel | null;
}

export interface CustomModelWizardHandle {
    handleInput: (input: string, key: Key) => boolean;
}

/**
 * Multi-step wizard for custom model configuration
 */
const CustomModelWizard = forwardRef<CustomModelWizardHandle, CustomModelWizardProps>(
    function CustomModelWizard({ isVisible, onComplete, onClose, initialModel }, ref) {
        // Provider selection (step 0) then wizard steps
        const [selectedProvider, setSelectedProvider] = useState<CustomModelProvider | null>(null);
        const [providerIndex, setProviderIndex] = useState(0);
        const [currentStep, setCurrentStep] = useState(0);
        const [values, setValues] = useState<Record<string, string>>({});
        const [currentInput, setCurrentInput] = useState('');
        const [error, setError] = useState<string | null>(null);
        const [isSaving, setIsSaving] = useState(false);
        const [isValidating, setIsValidating] = useState(false);
        // Track original name when editing (to handle renames)
        const [originalName, setOriginalName] = useState<string | null>(null);
        const isEditing = initialModel !== null && initialModel !== undefined;

        // Reset when becoming visible
        useEffect(() => {
            if (isVisible) {
                if (initialModel) {
                    // Editing mode - pre-populate from initialModel
                    const provider = initialModel.provider ?? 'openai-compatible';
                    setSelectedProvider(provider);
                    setOriginalName(initialModel.name);
                    setValues({
                        name: initialModel.name,
                        baseURL: initialModel.baseURL ?? '',
                        displayName: initialModel.displayName ?? '',
                        maxInputTokens: initialModel.maxInputTokens?.toString() ?? '',
                        apiKey: initialModel.apiKey ?? '',
                    });
                    setCurrentStep(0);
                    setCurrentInput(initialModel.name);
                    setProviderIndex(CUSTOM_MODEL_PROVIDERS.indexOf(provider));
                } else {
                    // Adding mode - reset everything
                    setSelectedProvider(null);
                    setOriginalName(null);
                    setProviderIndex(0);
                    setCurrentStep(0);
                    setValues({});
                    setCurrentInput('');
                }
                setError(null);
                setIsSaving(false);
                setIsValidating(false);
            }
        }, [isVisible, initialModel]);

        const wizardSteps = selectedProvider ? getStepsForProvider(selectedProvider) : [];
        const currentStepConfig = wizardSteps[currentStep];

        const handleProviderSelect = useCallback(() => {
            const provider = CUSTOM_MODEL_PROVIDERS[providerIndex];
            if (provider) {
                setSelectedProvider(provider);
                setCurrentStep(0);
                setCurrentInput('');
                setError(null);
            }
        }, [providerIndex]);

        const handleNext = useCallback(async () => {
            if (!currentStepConfig || isSaving || isValidating) return;

            const value = currentInput.trim();

            // Sync validation
            if (currentStepConfig.validate) {
                const validationError = currentStepConfig.validate(value);
                if (validationError) {
                    setError(validationError);
                    return;
                }
            } else if (currentStepConfig.required && !value) {
                setError(`${currentStepConfig.label} is required`);
                return;
            }

            // Async validation for OpenRouter model name
            if (selectedProvider === 'openrouter' && currentStepConfig.field === 'name') {
                setIsValidating(true);
                setError(null);
                try {
                    const openRouterError = await validateOpenRouterModel(value);
                    if (openRouterError) {
                        setError(openRouterError);
                        setIsValidating(false);
                        return;
                    }
                } finally {
                    setIsValidating(false);
                }
            }

            // Save value
            const newValues = { ...values, [currentStepConfig.field]: value };
            setValues(newValues);
            setError(null);
            setCurrentInput('');

            // Check if we're done
            if (currentStep >= wizardSteps.length - 1) {
                // Build model and save
                const model: CustomModel = {
                    name: newValues.name || '',
                    provider: selectedProvider!,
                };

                // Add baseURL for openai-compatible and litellm
                if (
                    (selectedProvider === 'openai-compatible' || selectedProvider === 'litellm') &&
                    newValues.baseURL
                ) {
                    model.baseURL = newValues.baseURL;
                }

                if (newValues.displayName?.trim()) {
                    model.displayName = newValues.displayName.trim();
                }
                if (newValues.maxInputTokens?.trim()) {
                    model.maxInputTokens = parseInt(newValues.maxInputTokens, 10);
                }

                // Determine API key storage strategy using shared logic
                const userEnteredKey = newValues.apiKey?.trim();
                const providerKeyStatus = getProviderKeyStatus(selectedProvider as LLMProvider);
                const existingProviderKey = resolveApiKeyForProvider(
                    selectedProvider as LLMProvider
                );

                const keyStorage = determineApiKeyStorage(
                    selectedProvider!,
                    userEnteredKey,
                    providerKeyStatus.hasApiKey,
                    existingProviderKey
                );

                if (keyStorage.saveToProviderEnvVar && userEnteredKey) {
                    try {
                        await saveProviderApiKey(
                            selectedProvider as LLMProvider,
                            userEnteredKey,
                            process.cwd()
                        );
                    } catch (err) {
                        logger.warn(
                            `Failed to save provider API key: ${err instanceof Error ? err.message : 'Unknown error'}`
                        );
                        // Fall back to per-model storage
                        keyStorage.saveAsPerModel = true;
                    }
                }

                if (keyStorage.saveAsPerModel && userEnteredKey) {
                    model.apiKey = userEnteredKey;
                }

                // Save to storage
                setIsSaving(true);
                try {
                    // If editing and name changed, delete the old model first
                    if (originalName && originalName !== model.name) {
                        try {
                            await deleteCustomModel(originalName);
                        } catch {
                            // Continue even if delete fails - the old model might already be gone
                        }
                    }
                    await saveCustomModel(model);
                    onComplete(model);
                } catch (err) {
                    logger.error(
                        `Failed to save custom model: ${err instanceof Error ? err.message : 'Unknown error'}`
                    );
                    setError(
                        `Failed to save: ${err instanceof Error ? err.message : 'Unknown error'}`
                    );
                    setIsSaving(false);
                }
            } else {
                const nextStep = currentStep + 1;
                setCurrentStep(nextStep);
                // Pre-populate next step from stored values (for edit mode)
                const nextStepConfig = wizardSteps[nextStep];
                const nextValue = nextStepConfig ? newValues[nextStepConfig.field] : undefined;
                setCurrentInput(nextValue ?? '');
            }
        }, [
            currentInput,
            currentStep,
            currentStepConfig,
            isSaving,
            isValidating,
            onComplete,
            selectedProvider,
            values,
            wizardSteps,
            originalName,
        ]);

        const handleBack = useCallback(() => {
            if (currentStep > 0) {
                setCurrentStep(currentStep - 1);
                // Restore previous value
                const prevStep = wizardSteps[currentStep - 1];
                if (prevStep) {
                    setCurrentInput(values[prevStep.field] || '');
                }
                setError(null);
            } else if (selectedProvider) {
                // Go back to provider selection
                setSelectedProvider(null);
                setError(null);
            } else {
                onClose();
            }
        }, [currentStep, onClose, selectedProvider, values, wizardSteps]);

        // Handle keyboard input
        useImperativeHandle(
            ref,
            () => ({
                handleInput: (input: string, key: Key): boolean => {
                    if (!isVisible || isSaving || isValidating) return false;

                    // Escape to go back/close
                    if (key.escape) {
                        handleBack();
                        return true;
                    }

                    // Provider selection mode
                    if (!selectedProvider) {
                        if (key.upArrow) {
                            setProviderIndex((prev) =>
                                prev > 0 ? prev - 1 : CUSTOM_MODEL_PROVIDERS.length - 1
                            );
                            return true;
                        }
                        if (key.downArrow) {
                            setProviderIndex((prev) =>
                                prev < CUSTOM_MODEL_PROVIDERS.length - 1 ? prev + 1 : 0
                            );
                            return true;
                        }
                        if (key.return) {
                            handleProviderSelect();
                            return true;
                        }
                        return true; // Consume all input during provider selection
                    }

                    // Wizard step mode
                    // Enter to submit current step
                    if (key.return) {
                        void handleNext();
                        return true;
                    }

                    // Backspace
                    if (key.backspace || key.delete) {
                        setCurrentInput((prev) => prev.slice(0, -1));
                        setError(null);
                        return true;
                    }

                    // Regular character input
                    if (input && !key.ctrl && !key.meta) {
                        setCurrentInput((prev) => prev + input);
                        setError(null);
                        return true;
                    }

                    return false;
                },
            }),
            [
                isVisible,
                isSaving,
                isValidating,
                handleBack,
                handleNext,
                handleProviderSelect,
                selectedProvider,
            ]
        );

        if (!isVisible) return null;

        // Provider selection screen
        if (!selectedProvider) {
            return (
                <Box
                    flexDirection="column"
                    borderStyle="round"
                    borderColor="green"
                    paddingX={1}
                    marginTop={1}
                >
                    <Box marginBottom={1}>
                        <Text bold color="green">
                            {isEditing ? 'Edit Custom Model' : 'Add Custom Model'}
                        </Text>
                    </Box>

                    <Text bold>Select Provider:</Text>

                    <Box flexDirection="column" marginTop={1}>
                        {CUSTOM_MODEL_PROVIDERS.map((provider, index) => (
                            <Box key={provider}>
                                <Text
                                    color={index === providerIndex ? 'cyan' : 'gray'}
                                    bold={index === providerIndex}
                                >
                                    {index === providerIndex ? '❯ ' : '  '}
                                    {provider === 'openai-compatible'
                                        ? 'OpenAI-Compatible (local/custom endpoint)'
                                        : provider === 'litellm'
                                          ? 'LiteLLM (unified proxy for 100+ providers)'
                                          : provider === 'glama'
                                            ? 'Glama (OpenAI-compatible gateway)'
                                            : provider === 'bedrock'
                                              ? 'AWS Bedrock (custom model IDs)'
                                              : 'OpenRouter (100+ cloud models)'}
                                </Text>
                            </Box>
                        ))}
                    </Box>

                    <Box marginTop={1}>
                        <Text dimColor>↑↓ navigate • Enter select • Esc cancel</Text>
                    </Box>
                </Box>
            );
        }

        // Wizard steps screen
        if (!currentStepConfig) return null;

        return (
            <Box
                flexDirection="column"
                borderStyle="round"
                borderColor="green"
                paddingX={1}
                marginTop={1}
            >
                {/* Header */}
                <Box marginBottom={1}>
                    <Text bold color="green">
                        {isEditing ? 'Edit Custom Model' : 'Add Custom Model'}
                    </Text>
                    <Text dimColor>
                        {' '}
                        ({selectedProvider}) Step {currentStep + 1}/{wizardSteps.length}
                    </Text>
                </Box>

                {/* Bedrock setup info - shown on first step only */}
                {selectedProvider === 'bedrock' && currentStep === 0 && (
                    <Box flexDirection="column" marginBottom={1}>
                        <Text color="blue">
                            ℹ Bedrock uses AWS credentials from your environment.
                        </Text>
                        <Text dimColor>
                            Ensure AWS_REGION and either AWS_BEARER_TOKEN_BEDROCK or IAM credentials
                            are set.
                        </Text>
                        <Text dimColor>
                            Setup guide:
                            https://docs.dexto.ai/guides/supported-llm-providers#amazon-bedrock
                        </Text>
                    </Box>
                )}

                {/* Current step prompt */}
                <Box flexDirection="column">
                    <Text bold>{currentStepConfig.label}:</Text>
                    <Text dimColor>{currentStepConfig.placeholder}</Text>
                    {/* Show existing key status for API key step */}
                    {currentStepConfig.field === 'apiKey' &&
                        selectedProvider &&
                        (() => {
                            const keyStatus = getProviderKeyStatus(selectedProvider as LLMProvider);
                            return keyStatus.hasApiKey ? (
                                <Text color="green">
                                    ✓ {keyStatus.envVar} already set, press Enter to skip
                                </Text>
                            ) : (
                                <Text color="yellow">No {keyStatus.envVar} configured</Text>
                            );
                        })()}
                </Box>

                {/* Input field */}
                <Box marginTop={1}>
                    <Text color="cyan">&gt; </Text>
                    <Text>{currentInput}</Text>
                    <Text color="cyan">_</Text>
                </Box>

                {/* Error message */}
                {error && (
                    <Box marginTop={1}>
                        <Text color="red">{error}</Text>
                    </Box>
                )}

                {/* Validating indicator */}
                {isValidating && (
                    <Box marginTop={1}>
                        <Text color="yellow">Validating model...</Text>
                    </Box>
                )}

                {/* Saving indicator */}
                {isSaving && (
                    <Box marginTop={1}>
                        <Text color="yellow">Saving...</Text>
                    </Box>
                )}

                {/* Help text */}
                <Box marginTop={1}>
                    <Text dimColor>
                        Enter to continue • Esc to{' '}
                        {currentStep > 0 ? 'go back' : 'back to provider'}
                    </Text>
                </Box>
            </Box>
        );
    }
);

export default CustomModelWizard;

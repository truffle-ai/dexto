/**
 * CustomModelWizard Component
 * Multi-step wizard for adding custom models (openai-compatible, openrouter, litellm, glama, bedrock)
 *
 * Architecture:
 * - Provider configs centralized in ./custom-model-wizard/provider-config.ts
 * - Shared UI components in ./custom-model-wizard/shared/
 * - This file is the orchestrator - handles state, navigation, and keyboard input
 */

import React, {
    useState,
    useEffect,
    forwardRef,
    useImperativeHandle,
    useCallback,
    useRef,
} from 'react';
import { Box, Text } from 'ink';
import type { Key } from '../../hooks/useInputOrchestrator.js';
import {
    saveCustomModel,
    deleteCustomModel,
    type CustomModel,
    type CustomModelProvider,
    saveProviderApiKey,
    getProviderKeyStatus,
    resolveApiKeyForProvider,
    determineApiKeyStorage,
} from '@dexto/agent-management';
import { logger, type LLMProvider } from '@dexto/core';

// Import from new modular architecture
import {
    getProviderConfig,
    getAvailableProviders,
    getProviderByMenuIndex,
    runAsyncValidation,
} from './custom-model-wizard/provider-config.js';
import {
    ProviderSelector,
    WizardStepInput,
    SetupInfoBanner,
    ApiKeyStep,
} from './custom-model-wizard/shared/index.js';
import LocalModelWizard, {
    type LocalModelWizardHandle,
} from './custom-model-wizard/LocalModelWizard.js';

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
 * Multi-step wizard for custom model configuration.
 * Uses data-driven provider configs instead of scattered conditionals.
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

        // Ref for LocalModelWizard (specialized wizard for 'local' provider)
        const localModelWizardRef = useRef<LocalModelWizardHandle>(null);

        // Get provider config (data-driven, no conditionals)
        const providerConfig = selectedProvider ? getProviderConfig(selectedProvider) : null;
        const allWizardSteps = providerConfig?.steps ?? [];

        /**
         * Get visible steps based on current values.
         * Steps with a condition function are only shown if the condition returns true.
         */
        const getVisibleSteps = useCallback(
            (currentValues: Record<string, string>) => {
                return allWizardSteps.filter(
                    (step) => !step.condition || step.condition(currentValues)
                );
            },
            [allWizardSteps]
        );

        // Current visible steps based on accumulated values
        const visibleSteps = getVisibleSteps(values);
        const currentStepConfig = visibleSteps[currentStep];

        // Reset when becoming visible
        useEffect(() => {
            if (isVisible) {
                if (initialModel) {
                    // Editing mode - pre-populate from initialModel
                    const provider = initialModel.provider ?? 'openai-compatible';
                    const providers = getAvailableProviders();
                    setSelectedProvider(provider);
                    setOriginalName(initialModel.name);
                    setValues({
                        name: initialModel.name,
                        baseURL: initialModel.baseURL ?? '',
                        displayName: initialModel.displayName ?? '',
                        maxInputTokens: initialModel.maxInputTokens?.toString() ?? '',
                        reasoningEffort: initialModel.reasoningEffort ?? '',
                        apiKey: initialModel.apiKey ?? '',
                        filePath: initialModel.filePath ?? '',
                    });
                    setCurrentStep(0);
                    setCurrentInput(initialModel.name);
                    const idx = providers.indexOf(provider);
                    setProviderIndex(idx >= 0 ? idx : 0);
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

        const handleProviderSelect = useCallback(() => {
            const provider = getProviderByMenuIndex(providerIndex);
            if (provider) {
                setSelectedProvider(provider);
                setCurrentStep(0);
                setCurrentInput('');
                setError(null);
            }
        }, [providerIndex]);

        const handleNext = useCallback(async () => {
            if (!currentStepConfig || !selectedProvider || isSaving || isValidating) return;

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

            // Async validation (data-driven - no provider-specific conditionals)
            const asyncError = await (async () => {
                setIsValidating(true);
                setError(null);
                try {
                    return await runAsyncValidation(
                        selectedProvider,
                        currentStepConfig.field,
                        value
                    );
                } finally {
                    setIsValidating(false);
                }
            })();

            if (asyncError) {
                setError(asyncError);
                return;
            }

            // Save value
            const newValues = { ...values, [currentStepConfig.field]: value };
            setValues(newValues);
            setError(null);
            setCurrentInput('');

            // Get updated visible steps with new values
            const updatedVisibleSteps = getVisibleSteps(newValues);

            // Check if we're done
            if (currentStep >= updatedVisibleSteps.length - 1) {
                await saveModel(newValues);
            } else {
                const nextStep = currentStep + 1;
                setCurrentStep(nextStep);
                // Pre-populate next step from stored values (for edit mode)
                const nextStepConfig = updatedVisibleSteps[nextStep];
                const nextValue = nextStepConfig ? newValues[nextStepConfig.field] : undefined;
                setCurrentInput(nextValue ?? '');
            }
        }, [
            currentInput,
            currentStep,
            currentStepConfig,
            getVisibleSteps,
            isSaving,
            isValidating,
            selectedProvider,
            values,
        ]);

        /**
         * Build and save the model using provider config's buildModel function.
         */
        const saveModel = useCallback(
            async (finalValues: Record<string, string>) => {
                if (!selectedProvider || !providerConfig) return;

                // Build model using provider config (no conditionals!)
                const model = providerConfig.buildModel(finalValues, selectedProvider);

                // Handle API key storage
                const userEnteredKey = finalValues.apiKey?.trim();
                const providerKeyStatus = getProviderKeyStatus(selectedProvider as LLMProvider);
                const existingProviderKey = resolveApiKeyForProvider(
                    selectedProvider as LLMProvider
                );

                const keyStorage = determineApiKeyStorage(
                    selectedProvider,
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
                        } catch (err) {
                            // Log but continue - old model might already be deleted
                            logger.warn(
                                `Failed to delete old model "${originalName}" during rename: ${err instanceof Error ? err.message : String(err)}`
                            );
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
            },
            [selectedProvider, providerConfig, originalName, onComplete]
        );

        const handleBack = useCallback(() => {
            if (currentStep > 0) {
                setCurrentStep(currentStep - 1);
                // Restore previous value
                const prevStep = visibleSteps[currentStep - 1];
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
        }, [currentStep, onClose, selectedProvider, values, visibleSteps]);

        // Handle keyboard input
        useImperativeHandle(
            ref,
            () => ({
                handleInput: (input: string, key: Key): boolean => {
                    if (!isVisible || isSaving || isValidating) return false;

                    // Delegate to LocalModelWizard when local provider is selected
                    if (selectedProvider === 'local' && localModelWizardRef.current) {
                        return localModelWizardRef.current.handleInput(input, key);
                    }

                    // Escape to go back/close
                    if (key.escape) {
                        handleBack();
                        return true;
                    }

                    // Provider selection mode
                    if (!selectedProvider) {
                        const providers = getAvailableProviders();
                        if (key.upArrow) {
                            setProviderIndex((prev) =>
                                prev > 0 ? prev - 1 : providers.length - 1
                            );
                            return true;
                        }
                        if (key.downArrow) {
                            setProviderIndex((prev) =>
                                prev < providers.length - 1 ? prev + 1 : 0
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

        // Provider selection screen (using shared component)
        if (!selectedProvider) {
            return <ProviderSelector selectedIndex={providerIndex} isEditing={isEditing} />;
        }

        // Local provider uses specialized wizard with download support
        if (selectedProvider === 'local') {
            return (
                <LocalModelWizard
                    ref={localModelWizardRef}
                    isVisible={isVisible}
                    onComplete={onComplete}
                    onClose={() => {
                        // Go back to provider selection instead of closing completely
                        setSelectedProvider(null);
                    }}
                />
            );
        }

        // Wizard steps screen for other providers
        if (!currentStepConfig || !providerConfig) return null;

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
                    <Text color="gray">
                        {' '}
                        ({providerConfig.displayName}) Step {currentStep + 1}/{visibleSteps.length}
                    </Text>
                </Box>

                {/* Setup info banner - data-driven, shown on first step only */}
                {providerConfig.setupInfo && currentStep === 0 && (
                    <SetupInfoBanner
                        title={providerConfig.setupInfo.title}
                        description={providerConfig.setupInfo.description}
                        docsUrl={providerConfig.setupInfo.docsUrl}
                    />
                )}

                {/* Step input with optional API key status */}
                <WizardStepInput
                    step={currentStepConfig}
                    currentInput={currentInput}
                    error={error}
                    isValidating={isValidating}
                    isSaving={isSaving}
                    additionalContent={
                        currentStepConfig.field === 'apiKey' ? (
                            <ApiKeyStep provider={selectedProvider} />
                        ) : undefined
                    }
                />

                {/* Help text */}
                <Box marginTop={1}>
                    <Text color="gray">
                        Enter to continue • Esc to{' '}
                        {currentStep > 0 ? 'go back' : 'back to provider'}
                    </Text>
                </Box>
            </Box>
        );
    }
);

export default CustomModelWizard;

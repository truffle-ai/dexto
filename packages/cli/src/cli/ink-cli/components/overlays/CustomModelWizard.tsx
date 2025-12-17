/**
 * CustomModelWizard Component
 * Multi-step wizard for adding a custom openai-compatible model
 */

import React, { useState, useEffect, forwardRef, useImperativeHandle, useCallback } from 'react';
import { Box, Text } from 'ink';
import type { Key } from '../../hooks/useInputOrchestrator.js';
import { saveCustomModel, type CustomModel } from '@dexto/agent-management';
import { logger } from '@dexto/core';

interface WizardStep {
    field: keyof CustomModel;
    label: string;
    placeholder: string;
    required: boolean;
    validate?: (value: string) => string | null;
}

const WIZARD_STEPS: WizardStep[] = [
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
];

interface CustomModelWizardProps {
    isVisible: boolean;
    onComplete: (model: CustomModel) => void;
    onClose: () => void;
}

export interface CustomModelWizardHandle {
    handleInput: (input: string, key: Key) => boolean;
}

/**
 * Multi-step wizard for custom model configuration
 */
const CustomModelWizard = forwardRef<CustomModelWizardHandle, CustomModelWizardProps>(
    function CustomModelWizard({ isVisible, onComplete, onClose }, ref) {
        const [currentStep, setCurrentStep] = useState(0);
        const [values, setValues] = useState<Record<string, string>>({});
        const [currentInput, setCurrentInput] = useState('');
        const [error, setError] = useState<string | null>(null);
        const [isSaving, setIsSaving] = useState(false);

        // Reset when becoming visible
        useEffect(() => {
            if (isVisible) {
                setCurrentStep(0);
                setValues({});
                setCurrentInput('');
                setError(null);
                setIsSaving(false);
            }
        }, [isVisible]);

        const currentStepConfig = WIZARD_STEPS[currentStep];

        const handleNext = useCallback(async () => {
            if (!currentStepConfig || isSaving) return;

            const value = currentInput.trim();

            // Validate
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

            // Save value
            const newValues = { ...values, [currentStepConfig.field]: value };
            setValues(newValues);
            setError(null);
            setCurrentInput('');

            // Check if we're done
            if (currentStep >= WIZARD_STEPS.length - 1) {
                // Build model and save
                const model: CustomModel = {
                    name: newValues.name || '',
                    baseURL: newValues.baseURL || '',
                };

                if (newValues.displayName?.trim()) {
                    model.displayName = newValues.displayName.trim();
                }
                if (newValues.maxInputTokens?.trim()) {
                    model.maxInputTokens = parseInt(newValues.maxInputTokens, 10);
                }

                // Save to storage
                setIsSaving(true);
                try {
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
                setCurrentStep(currentStep + 1);
            }
        }, [currentInput, currentStep, currentStepConfig, isSaving, onComplete, values]);

        const handleBack = useCallback(() => {
            if (currentStep > 0) {
                setCurrentStep(currentStep - 1);
                // Restore previous value
                const prevStep = WIZARD_STEPS[currentStep - 1];
                if (prevStep) {
                    setCurrentInput(values[prevStep.field] || '');
                }
                setError(null);
            } else {
                onClose();
            }
        }, [currentStep, onClose, values]);

        // Handle keyboard input
        useImperativeHandle(
            ref,
            () => ({
                handleInput: (input: string, key: Key): boolean => {
                    if (!isVisible || isSaving) return false;

                    // Escape to go back/close
                    if (key.escape) {
                        handleBack();
                        return true;
                    }

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
            [isVisible, isSaving, handleBack, handleNext]
        );

        if (!isVisible || !currentStepConfig) return null;

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
                        Add Custom Model
                    </Text>
                    <Text dimColor>
                        {' '}
                        (Step {currentStep + 1}/{WIZARD_STEPS.length})
                    </Text>
                </Box>

                {/* Current step prompt */}
                <Box flexDirection="column">
                    <Text bold>{currentStepConfig.label}:</Text>
                    <Text dimColor>{currentStepConfig.placeholder}</Text>
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

                {/* Saving indicator */}
                {isSaving && (
                    <Box marginTop={1}>
                        <Text color="yellow">Saving...</Text>
                    </Box>
                )}

                {/* Help text */}
                <Box marginTop={1}>
                    <Text dimColor>
                        Enter to continue • Esc to {currentStep > 0 ? 'go back' : 'cancel'}
                    </Text>
                </Box>
            </Box>
        );
    }
);

export default CustomModelWizard;

/**
 * PromptAddWizard Component
 * Multi-step wizard for creating a new prompt
 */

import React, { useState, useEffect, forwardRef, useImperativeHandle, useCallback } from 'react';
import { Box, Text } from 'ink';
import type { Key } from '../../hooks/useInputOrchestrator.js';
import type { PromptAddScope } from '../../state/types.js';

export interface NewPromptData {
    name: string;
    title?: string;
    description?: string;
    argumentHint?: string;
    content: string;
}

interface WizardStep {
    field: keyof NewPromptData;
    label: string;
    placeholder: string;
    required: boolean;
    multiline?: boolean;
    validate?: (value: string) => string | null;
}

const PROMPT_NAME_REGEX = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const WIZARD_STEPS: WizardStep[] = [
    {
        field: 'name',
        label: 'Prompt Name',
        placeholder: 'e.g., my-prompt (kebab-case)',
        required: true,
        validate: (v) => {
            if (!v.trim()) return 'Name is required';
            if (!PROMPT_NAME_REGEX.test(v.trim())) {
                return 'Name must be kebab-case (lowercase letters, numbers, hyphens)';
            }
            return null;
        },
    },
    {
        field: 'title',
        label: 'Title (optional)',
        placeholder: 'e.g., My Custom Prompt',
        required: false,
    },
    {
        field: 'description',
        label: 'Description (optional)',
        placeholder: 'e.g., Helps with specific task',
        required: false,
    },
    {
        field: 'argumentHint',
        label: 'Arguments (optional)',
        placeholder: 'e.g., [style] [length?] - use ? for optional',
        required: false,
    },
    {
        field: 'content',
        label: 'Prompt Content',
        placeholder: 'Use $1, $2 for args, $ARGUMENTS for remaining',
        required: true,
        multiline: true,
        validate: (v) => (v.trim() ? null : 'Content is required'),
    },
];

interface PromptAddWizardProps {
    isVisible: boolean;
    scope: PromptAddScope;
    onComplete: (data: NewPromptData) => void;
    onClose: () => void;
}

export interface PromptAddWizardHandle {
    handleInput: (input: string, key: Key) => boolean;
}

/**
 * Multi-step wizard for creating a new prompt
 */
const PromptAddWizard = forwardRef<PromptAddWizardHandle, PromptAddWizardProps>(
    function PromptAddWizard({ isVisible, scope, onComplete, onClose }, ref) {
        const [currentStep, setCurrentStep] = useState(0);
        const [values, setValues] = useState<Record<string, string>>({});
        const [currentInput, setCurrentInput] = useState('');
        const [error, setError] = useState<string | null>(null);

        // Reset when becoming visible
        useEffect(() => {
            if (isVisible) {
                setCurrentStep(0);
                setValues({});
                setCurrentInput('');
                setError(null);
            }
        }, [isVisible, scope]);

        const currentStepConfig = WIZARD_STEPS[currentStep];

        const handleNext = useCallback(() => {
            if (!currentStepConfig) return;

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
                // Build data and complete
                const data: NewPromptData = {
                    name: newValues.name || '',
                    content: newValues.content || '',
                };

                if (newValues.title?.trim()) {
                    data.title = newValues.title.trim();
                }
                if (newValues.description?.trim()) {
                    data.description = newValues.description.trim();
                }
                if (newValues.argumentHint?.trim()) {
                    data.argumentHint = newValues.argumentHint.trim();
                }

                onComplete(data);
            } else {
                setCurrentStep(currentStep + 1);
            }
        }, [currentInput, currentStep, currentStepConfig, onComplete, values]);

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
                    if (!isVisible) return false;

                    // Escape to go back/close
                    if (key.escape) {
                        handleBack();
                        return true;
                    }

                    // Enter to submit current step (or add newline in multiline mode)
                    if (key.return) {
                        if (currentStepConfig?.multiline && key.shift) {
                            // Shift+Enter adds newline in multiline mode
                            setCurrentInput((prev) => prev + '\n');
                            return true;
                        }
                        handleNext();
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
            [isVisible, handleBack, handleNext, currentStepConfig]
        );

        if (!isVisible || !currentStepConfig) return null;

        const scopeLabel = scope === 'agent' ? 'Agent' : 'Shared';

        return (
            <Box
                flexDirection="column"
                borderStyle="round"
                borderColor="yellowBright"
                paddingX={1}
                marginTop={1}
            >
                {/* Header */}
                <Box marginBottom={1}>
                    <Text bold color="yellowBright">
                        Add {scopeLabel} Prompt
                    </Text>
                    <Text color="gray">
                        {' '}
                        (Step {currentStep + 1}/{WIZARD_STEPS.length})
                    </Text>
                </Box>

                {/* Current step prompt */}
                <Box flexDirection="column">
                    <Text bold>{currentStepConfig.label}:</Text>
                    <Text color="gray">{currentStepConfig.placeholder}</Text>
                </Box>

                {/* Input field */}
                <Box marginTop={1} flexDirection="column">
                    <Box>
                        <Text color="cyan">&gt; </Text>
                        <Text>{currentInput}</Text>
                        <Text color="cyan">_</Text>
                    </Box>
                    {currentStepConfig.multiline && (
                        <Text color="gray" italic>
                            (Shift+Enter for newline)
                        </Text>
                    )}
                </Box>

                {/* Error message */}
                {error && (
                    <Box marginTop={1}>
                        <Text color="red">{error}</Text>
                    </Box>
                )}

                {/* Help text */}
                <Box marginTop={1}>
                    <Text color="gray">
                        Enter to continue • Esc to {currentStep > 0 ? 'go back' : 'cancel'}
                    </Text>
                </Box>
            </Box>
        );
    }
);

export default PromptAddWizard;

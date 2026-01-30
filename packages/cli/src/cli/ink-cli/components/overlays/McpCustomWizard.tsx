/**
 * McpCustomWizard Component
 * Multi-step wizard for collecting custom MCP server configuration
 */

import React, { useState, useEffect, forwardRef, useImperativeHandle, useCallback } from 'react';
import { Box, Text } from 'ink';
import type { Key } from '../../hooks/useInputOrchestrator.js';
import type { McpServerType } from '@dexto/core';

export interface McpCustomConfig {
    serverType: McpServerType;
    name: string;
    // STDIO fields
    command?: string;
    args?: string[];
    // HTTP/SSE fields
    url?: string;
}

interface WizardStep {
    field: string;
    label: string;
    placeholder: string;
    required: boolean;
    validate?: (value: string) => string | null; // Returns error message or null if valid
}

const STDIO_STEPS: WizardStep[] = [
    {
        field: 'name',
        label: 'Server Name',
        placeholder: 'e.g., my-server',
        required: true,
        validate: (v) => (v.trim() ? null : 'Name is required'),
    },
    {
        field: 'command',
        label: 'Command',
        placeholder: 'e.g., npx, uvx, node, python',
        required: true,
        validate: (v) => (v.trim() ? null : 'Command is required'),
    },
    {
        field: 'args',
        label: 'Arguments (space-separated, optional)',
        placeholder: 'e.g., -y @modelcontextprotocol/server-filesystem .',
        required: false,
    },
];

const HTTP_STEPS: WizardStep[] = [
    {
        field: 'name',
        label: 'Server Name',
        placeholder: 'e.g., my-http-server',
        required: true,
        validate: (v) => (v.trim() ? null : 'Name is required'),
    },
    {
        field: 'url',
        label: 'Server URL',
        placeholder: 'e.g., http://localhost:8080',
        required: true,
        validate: (v) => {
            if (!v.trim()) return 'URL is required';
            try {
                new URL(v);
                return null;
            } catch {
                return 'Invalid URL format';
            }
        },
    },
];

const SSE_STEPS: WizardStep[] = [
    {
        field: 'name',
        label: 'Server Name',
        placeholder: 'e.g., my-sse-server',
        required: true,
        validate: (v) => (v.trim() ? null : 'Name is required'),
    },
    {
        field: 'url',
        label: 'SSE Endpoint URL',
        placeholder: 'e.g., http://localhost:9000/events',
        required: true,
        validate: (v) => {
            if (!v.trim()) return 'URL is required';
            try {
                new URL(v);
                return null;
            } catch {
                return 'Invalid URL format';
            }
        },
    },
];

function getStepsForType(serverType: McpServerType): WizardStep[] {
    switch (serverType) {
        case 'stdio':
            return STDIO_STEPS;
        case 'http':
            return HTTP_STEPS;
        case 'sse':
            return SSE_STEPS;
    }
}

interface McpCustomWizardProps {
    isVisible: boolean;
    serverType: McpServerType;
    onComplete: (config: McpCustomConfig) => void;
    onClose: () => void;
}

export interface McpCustomWizardHandle {
    handleInput: (input: string, key: Key) => boolean;
}

/**
 * Multi-step wizard for custom MCP server configuration
 */
const McpCustomWizard = forwardRef<McpCustomWizardHandle, McpCustomWizardProps>(
    function McpCustomWizard({ isVisible, serverType, onComplete, onClose }, ref) {
        const steps = getStepsForType(serverType);
        const [currentStep, setCurrentStep] = useState(0);
        const [values, setValues] = useState<Record<string, string>>({});
        const [currentInput, setCurrentInput] = useState('');
        const [error, setError] = useState<string | null>(null);

        // Reset when becoming visible or server type changes
        useEffect(() => {
            if (isVisible) {
                setCurrentStep(0);
                setValues({});
                setCurrentInput('');
                setError(null);
            }
        }, [isVisible, serverType]);

        const currentStepConfig = steps[currentStep];

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
            if (currentStep >= steps.length - 1) {
                // Build config and complete
                const config: McpCustomConfig = {
                    serverType,
                    name: newValues.name || '',
                };

                if (serverType === 'stdio') {
                    if (newValues.command) {
                        config.command = newValues.command;
                    }
                    if (newValues.args?.trim()) {
                        config.args = newValues.args.split(/\s+/).filter(Boolean);
                    }
                } else {
                    if (newValues.url) {
                        config.url = newValues.url;
                    }
                }

                onComplete(config);
            } else {
                setCurrentStep(currentStep + 1);
            }
        }, [
            currentInput,
            currentStep,
            currentStepConfig,
            onComplete,
            serverType,
            steps.length,
            values,
        ]);

        const handleBack = useCallback(() => {
            if (currentStep > 0) {
                setCurrentStep(currentStep - 1);
                // Restore previous value
                const prevStep = steps[currentStep - 1];
                if (prevStep) {
                    setCurrentInput(values[prevStep.field] || '');
                }
                setError(null);
            } else {
                onClose();
            }
        }, [currentStep, onClose, steps, values]);

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

                    // Enter to submit current step
                    if (key.return) {
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
            [isVisible, handleBack, handleNext]
        );

        if (!isVisible || !currentStepConfig) return null;

        const serverTypeLabel = serverType.toUpperCase();

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
                        Add Custom {serverTypeLabel} Server
                    </Text>
                    <Text color="gray">
                        {' '}
                        (Step {currentStep + 1}/{steps.length})
                    </Text>
                </Box>

                {/* Current step prompt */}
                <Box flexDirection="column">
                    <Text bold>{currentStepConfig.label}:</Text>
                    <Text color="gray">{currentStepConfig.placeholder}</Text>
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

export default McpCustomWizard;

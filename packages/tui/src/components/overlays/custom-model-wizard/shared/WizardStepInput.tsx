/**
 * WizardStepInput Component
 * Renders a single wizard step with label, placeholder, input, and error display.
 */

import React from 'react';
import { Box, Text } from 'ink';
import type { WizardStep } from '../types.js';

interface WizardStepInputProps {
    /** Current step configuration */
    step: WizardStep;
    /** Current input value */
    currentInput: string;
    /** Error message (if any) */
    error: string | null;
    /** Whether validation is in progress */
    isValidating: boolean;
    /** Whether saving is in progress */
    isSaving: boolean;
    /** Optional additional content to render after placeholder (e.g., API key status) */
    additionalContent?: React.ReactNode;
}

/**
 * Renders a wizard step with:
 * - Step label and placeholder text
 * - Text input field with cursor
 * - Error message (if any)
 * - Validation/saving indicators
 */
export function WizardStepInput({
    step,
    currentInput,
    error,
    isValidating,
    isSaving,
    additionalContent,
}: WizardStepInputProps): React.ReactElement {
    return (
        <>
            {/* Current step prompt */}
            <Box flexDirection="column">
                <Text bold>{step.label}:</Text>
                <Text color="gray">{step.placeholder}</Text>
                {additionalContent}
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
                    <Text color="yellowBright">Validating model...</Text>
                </Box>
            )}

            {/* Saving indicator */}
            {isSaving && (
                <Box marginTop={1}>
                    <Text color="yellowBright">Saving...</Text>
                </Box>
            )}
        </>
    );
}

export default WizardStepInput;

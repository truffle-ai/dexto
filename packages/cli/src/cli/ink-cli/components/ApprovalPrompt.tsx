import React, { forwardRef, useState, useImperativeHandle, useRef, useEffect } from 'react';
import { Box, Text } from 'ink';
import type { ToolDisplayData } from '@dexto/core';
import type { Key } from '../hooks/useInputOrchestrator.js';
import {
    ElicitationForm,
    type ElicitationFormHandle,
    type ElicitationMetadata,
} from './ElicitationForm.js';
import { DiffRenderer, ShellRenderer, FileRenderer } from './renderers/index.js';

export interface ApprovalRequest {
    approvalId: string;
    type: string;
    sessionId?: string;
    timeout?: number;
    timestamp: Date;
    metadata: Record<string, unknown>;
}

export interface ApprovalPromptHandle {
    handleInput: (input: string, key: Key) => boolean;
}

interface ApprovalPromptProps {
    approval: ApprovalRequest;
    onApprove: (rememberChoice: boolean, formData?: Record<string, unknown>) => void;
    onDeny: () => void;
    onCancel: () => void;
}

type SelectionOption = 'yes' | 'yes-session' | 'no';

/**
 * Compact approval prompt component that displays above the input area
 * Shows three options in a vertical list: Yes, Yes for Session, and No
 * For elicitation requests, renders a form with input fields
 */
export const ApprovalPrompt = forwardRef<ApprovalPromptHandle, ApprovalPromptProps>(
    ({ approval, onApprove, onDeny, onCancel }, ref) => {
        const isCommandConfirmation = approval.type === 'command_confirmation';
        const isElicitation = approval.type === 'elicitation';
        const [selectedOption, setSelectedOption] = useState<SelectionOption>('yes');

        // Ref for elicitation form
        const elicitationFormRef = useRef<ElicitationFormHandle>(null);

        // Use ref to avoid stale closure issues in handleInput
        const selectedOptionRef = useRef<SelectionOption>('yes');

        // Keep ref in sync with state
        useEffect(() => {
            selectedOptionRef.current = selectedOption;
        }, [selectedOption]);

        // Expose handleInput method via ref
        useImperativeHandle(
            ref,
            () => ({
                handleInput: (input: string, key: Key) => {
                    // For elicitation, delegate to the form
                    if (isElicitation && elicitationFormRef.current) {
                        return elicitationFormRef.current.handleInput(input, key);
                    }

                    if (key.upArrow) {
                        // Move up (skip yes-session for command confirmations)
                        setSelectedOption((current) => {
                            if (current === 'yes') return 'no';
                            if (current === 'yes-session') return 'yes';
                            // no -> yes-session (or yes for command confirmations)
                            return isCommandConfirmation ? 'yes' : 'yes-session';
                        });
                        return true;
                    } else if (key.downArrow) {
                        // Move down (skip yes-session for command confirmations)
                        setSelectedOption((current) => {
                            if (current === 'yes')
                                return isCommandConfirmation ? 'no' : 'yes-session';
                            if (current === 'yes-session') return 'no';
                            return 'yes'; // no -> yes (wrap)
                        });
                        return true;
                    } else if (key.return) {
                        // Enter key - confirm selection
                        const currentSelection = selectedOptionRef.current;
                        if (currentSelection === 'yes') {
                            onApprove(false);
                        } else if (currentSelection === 'yes-session') {
                            onApprove(true);
                        } else {
                            onDeny();
                        }
                        return true;
                    } else if (key.escape) {
                        // Escape key - cancel
                        onCancel();
                        return true;
                    }
                    return false;
                },
            }),
            [isCommandConfirmation, isElicitation, onApprove, onDeny, onCancel]
        );

        // For elicitation, render the form
        if (isElicitation) {
            const metadata = approval.metadata as unknown as ElicitationMetadata;
            return (
                <ElicitationForm
                    ref={elicitationFormRef}
                    metadata={metadata}
                    onSubmit={(formData) => onApprove(false, formData)}
                    onCancel={onCancel}
                />
            );
        }

        // Extract information from metadata based on approval type
        const toolName = approval.metadata.toolName as string | undefined;
        const command = approval.metadata.command as string | undefined;
        const displayPreview = approval.metadata.displayPreview as ToolDisplayData | undefined;

        // Render preview based on display type
        const renderPreview = () => {
            if (!displayPreview) return null;

            switch (displayPreview.type) {
                case 'diff':
                    return (
                        <Box marginBottom={1}>
                            <DiffRenderer data={displayPreview} maxLines={20} />
                        </Box>
                    );
                case 'shell':
                    // For shell preview, just show the command (no output yet)
                    return (
                        <Box marginBottom={1} flexDirection="row">
                            <Text dimColor>$ </Text>
                            <Text color="yellow">{displayPreview.command}</Text>
                            {displayPreview.isBackground && <Text dimColor> (background)</Text>}
                        </Box>
                    );
                case 'file':
                    return (
                        <Box marginBottom={1}>
                            <FileRenderer data={displayPreview} />
                        </Box>
                    );
                default:
                    return null;
            }
        };

        return (
            <Box paddingX={0} paddingY={0} flexDirection="column">
                {/* Compact header with context */}
                <Box flexDirection="column" marginBottom={0}>
                    <Box flexDirection="row">
                        <Text color="yellow" bold>
                            🔐 Approval:{' '}
                        </Text>
                        {toolName && <Text color="cyan">{toolName}</Text>}
                    </Box>
                    {isCommandConfirmation && command && (
                        <Box flexDirection="row" marginTop={0}>
                            <Text color="gray">{'  Command: '}</Text>
                            <Text color="red">{command}</Text>
                        </Box>
                    )}
                </Box>

                {/* Preview section - shown BEFORE approval options */}
                {renderPreview()}

                {/* Vertical selection options */}
                <Box flexDirection="column" marginTop={0}>
                    <Box>
                        {selectedOption === 'yes' ? (
                            <Text color="green" bold>
                                {'  ▶ '}Yes
                            </Text>
                        ) : (
                            <Text color="gray">{'    '}Yes</Text>
                        )}
                    </Box>
                    {/* Only show "Yes (Session)" for tool confirmations, not command confirmations */}
                    {!isCommandConfirmation && (
                        <Box>
                            {selectedOption === 'yes-session' ? (
                                <Text color="green" bold>
                                    {'  ▶ '}Yes (Session)
                                </Text>
                            ) : (
                                <Text color="gray">{'    '}Yes (Session)</Text>
                            )}
                        </Box>
                    )}
                    <Box>
                        {selectedOption === 'no' ? (
                            <Text color="red" bold>
                                {'  ▶ '}No
                            </Text>
                        ) : (
                            <Text color="gray">{'    '}No</Text>
                        )}
                    </Box>
                </Box>

                {/* Compact instructions */}
                <Box marginTop={0}>
                    <Text color="gray" dimColor>
                        {'  '}↑↓ to select • Enter to confirm • Esc to cancel
                    </Text>
                </Box>
            </Box>
        );
    }
);

ApprovalPrompt.displayName = 'ApprovalPrompt';

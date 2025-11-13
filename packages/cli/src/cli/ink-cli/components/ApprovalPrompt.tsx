import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';

export interface ApprovalRequest {
    approvalId: string;
    type: string;
    sessionId?: string;
    timeout?: number;
    timestamp: Date;
    metadata: Record<string, unknown>;
}

interface ApprovalPromptProps {
    approval: ApprovalRequest;
    onApprove: (rememberChoice: boolean) => void;
    onDeny: () => void;
    onCancel: () => void;
}

type SelectionOption = 'yes' | 'yes-session' | 'no';

/**
 * Compact approval prompt component that displays above the input area
 * Shows three options in a vertical list: Yes, Yes for Session, and No
 */
export function ApprovalPrompt({ approval, onApprove, onDeny, onCancel }: ApprovalPromptProps) {
    const isCommandConfirmation = approval.type === 'command_confirmation';
    const [selectedOption, setSelectedOption] = useState<SelectionOption>('yes');

    // Handle keyboard navigation (vertical)
    useInput(
        (input, key) => {
            if (key.upArrow) {
                // Move up (skip yes-session for command confirmations)
                setSelectedOption((current) => {
                    if (current === 'yes') return 'no';
                    if (current === 'yes-session') return 'yes';
                    // no -> yes-session (or yes for command confirmations)
                    return isCommandConfirmation ? 'yes' : 'yes-session';
                });
            } else if (key.downArrow) {
                // Move down (skip yes-session for command confirmations)
                setSelectedOption((current) => {
                    if (current === 'yes') return isCommandConfirmation ? 'no' : 'yes-session';
                    if (current === 'yes-session') return 'no';
                    return 'yes'; // no -> yes (wrap)
                });
            } else if (key.return) {
                // Enter key - confirm selection
                if (selectedOption === 'yes') {
                    onApprove(false);
                } else if (selectedOption === 'yes-session') {
                    onApprove(true);
                } else {
                    onDeny();
                }
            } else if (key.escape) {
                // Escape key - cancel
                onCancel();
            }
        },
        { isActive: true }
    );

    // Extract information from metadata based on approval type
    const toolName = approval.metadata.toolName as string | undefined;
    const command = approval.metadata.command as string | undefined;

    return (
        <Box
            borderStyle="single"
            borderColor="yellow"
            paddingX={1}
            paddingY={0}
            flexDirection="column"
        >
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

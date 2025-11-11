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
    const [selectedOption, setSelectedOption] = useState<SelectionOption>('yes');

    // Handle keyboard navigation (vertical)
    useInput(
        (input, key) => {
            if (key.upArrow) {
                // Move up: yes-session -> yes, no -> yes-session, yes -> no (wrap)
                setSelectedOption((current) => {
                    if (current === 'yes') return 'no';
                    if (current === 'yes-session') return 'yes';
                    return 'yes-session'; // no -> yes-session
                });
            } else if (key.downArrow) {
                // Move down: yes -> yes-session, yes-session -> no, no -> yes (wrap)
                setSelectedOption((current) => {
                    if (current === 'yes') return 'yes-session';
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

    // Extract tool information from metadata
    const toolName = approval.metadata.toolName as string | undefined;

    return (
        <Box
            borderStyle="single"
            borderColor="yellow"
            paddingX={1}
            paddingY={0}
            flexDirection="column"
        >
            {/* Compact header with tool name inline */}
            <Box flexDirection="row" marginBottom={0}>
                <Text color="yellow" bold>
                    🔐 Approval:{' '}
                </Text>
                {toolName && <Text color="cyan">{toolName}</Text>}
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
                <Box>
                    {selectedOption === 'yes-session' ? (
                        <Text color="green" bold>
                            {'  ▶ '}Yes (Session)
                        </Text>
                    ) : (
                        <Text color="gray">{'    '}Yes (Session)</Text>
                    )}
                </Box>
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

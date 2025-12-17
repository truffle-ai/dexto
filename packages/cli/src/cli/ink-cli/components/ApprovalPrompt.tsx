import React, { forwardRef, useState, useImperativeHandle, useRef, useEffect } from 'react';
import { Box, Text } from 'ink';
import type { ToolDisplayData, ElicitationMetadata } from '@dexto/core';
import type { Key } from '../hooks/useInputOrchestrator.js';
import { ElicitationForm, type ElicitationFormHandle } from './ElicitationForm.js';
import { DiffPreview, CreateFilePreview } from './renderers/index.js';
import { isEditWriteTool } from '../utils/toolUtils.js';

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

/**
 * Options passed when approving a request
 */
export interface ApprovalOptions {
    /** Remember this tool for the entire session (approves ALL uses) */
    rememberChoice?: boolean;
    /** Remember a specific command pattern for bash (e.g., "git *") */
    rememberPattern?: string;
    /** Form data for elicitation requests */
    formData?: Record<string, unknown>;
    /** Enable "accept all edits" mode (auto-approve future edit_file/write_file) */
    enableAcceptEditsMode?: boolean;
}

interface ApprovalPromptProps {
    approval: ApprovalRequest;
    onApprove: (options: ApprovalOptions) => void;
    onDeny: () => void;
    onCancel: () => void;
}

/**
 * Selection option type - supports both simple yes/no and pattern-based options
 */
type SelectionOption = 'yes' | 'yes-session' | 'yes-accept-edits' | 'no' | `pattern-${number}`;

/**
 * Compact approval prompt component that displays above the input area
 * Shows options based on approval type:
 * - Tool confirmation: Yes, Yes (Session), No
 * - Bash with patterns: Yes (once), pattern options, Yes (all bash), No
 * - Elicitation: Form with input fields
 */
export const ApprovalPrompt = forwardRef<ApprovalPromptHandle, ApprovalPromptProps>(
    ({ approval, onApprove, onDeny, onCancel }, ref) => {
        const isCommandConfirmation = approval.type === 'command_confirmation';
        const isElicitation = approval.type === 'elicitation';

        // Extract suggested patterns for bash tools
        const suggestedPatterns =
            (approval.metadata.suggestedPatterns as string[] | undefined) ?? [];
        const hasBashPatterns = suggestedPatterns.length > 0;

        // Check if this is an edit/write file tool
        const toolName = approval.metadata.toolName as string | undefined;
        const isEditOrWriteTool = isEditWriteTool(toolName);

        const [selectedIndex, setSelectedIndex] = useState(0);

        // Ref for elicitation form
        const elicitationFormRef = useRef<ElicitationFormHandle>(null);

        // Use ref to avoid stale closure issues in handleInput
        const selectedIndexRef = useRef(0);

        // Build the list of options based on approval type
        const options: Array<{ id: SelectionOption; label: string }> = [];

        if (hasBashPatterns) {
            // Bash tool with pattern suggestions
            options.push({ id: 'yes', label: 'Yes (once)' });
            suggestedPatterns.forEach((pattern, i) => {
                options.push({
                    id: `pattern-${i}` as SelectionOption,
                    label: `Yes, allow "${pattern}"`,
                });
            });
            options.push({ id: 'yes-session', label: 'Yes, allow all bash' });
            options.push({ id: 'no', label: 'No' });
        } else if (isCommandConfirmation) {
            // Command confirmation (no session option)
            options.push({ id: 'yes', label: 'Yes' });
            options.push({ id: 'no', label: 'No' });
        } else if (isEditOrWriteTool) {
            // Edit/write file tools - offer "accept all edits" mode instead of session
            options.push({ id: 'yes', label: 'Yes' });
            options.push({ id: 'yes-accept-edits', label: 'Yes, and accept all edits' });
            options.push({ id: 'no', label: 'No' });
        } else {
            // Standard tool confirmation
            options.push({ id: 'yes', label: 'Yes' });
            options.push({ id: 'yes-session', label: 'Yes (Session)' });
            options.push({ id: 'no', label: 'No' });
        }

        // Keep ref in sync with state
        useEffect(() => {
            selectedIndexRef.current = selectedIndex;
        }, [selectedIndex]);

        // Helper to get the option at current index
        const getCurrentOption = () => options[selectedIndexRef.current];

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
                        setSelectedIndex((current) =>
                            current === 0 ? options.length - 1 : current - 1
                        );
                        return true;
                    } else if (key.downArrow) {
                        setSelectedIndex((current) =>
                            current === options.length - 1 ? 0 : current + 1
                        );
                        return true;
                    } else if (key.return) {
                        const option = getCurrentOption();
                        if (!option) return false;

                        if (option.id === 'yes') {
                            onApprove({});
                        } else if (option.id === 'yes-session') {
                            onApprove({ rememberChoice: true });
                        } else if (option.id === 'yes-accept-edits') {
                            // Approve and enable "accept all edits" mode
                            onApprove({ enableAcceptEditsMode: true });
                        } else if (option.id === 'no') {
                            onDeny();
                        } else if (option.id.startsWith('pattern-')) {
                            // Extract pattern index and get the pattern string
                            const patternIndex = parseInt(option.id.replace('pattern-', ''), 10);
                            const pattern = suggestedPatterns[patternIndex];
                            if (pattern) {
                                onApprove({ rememberPattern: pattern });
                            } else {
                                onApprove({});
                            }
                        }
                        return true;
                    } else if (key.shift && key.tab && isEditOrWriteTool) {
                        // Shift+Tab on edit/write tool: approve and enable "accept all edits" mode
                        onApprove({ enableAcceptEditsMode: true });
                        return true;
                    } else if (key.escape) {
                        onCancel();
                        return true;
                    }
                    return false;
                },
            }),
            [
                isElicitation,
                isEditOrWriteTool,
                options,
                suggestedPatterns,
                onApprove,
                onDeny,
                onCancel,
            ]
        );

        // For elicitation, render the form
        if (isElicitation) {
            const metadata = approval.metadata as unknown as ElicitationMetadata;
            return (
                <ElicitationForm
                    ref={elicitationFormRef}
                    metadata={metadata}
                    onSubmit={(formData) => onApprove({ formData })}
                    onCancel={onCancel}
                />
            );
        }

        // Extract information from metadata based on approval type
        const command = approval.metadata.command as string | undefined;
        const displayPreview = approval.metadata.displayPreview as ToolDisplayData | undefined;

        // Render preview based on display type
        const renderPreview = () => {
            if (!displayPreview) return null;

            switch (displayPreview.type) {
                case 'diff': {
                    const isOverwrite =
                        toolName === 'internal--write_file' || toolName === 'write_file';
                    return (
                        <DiffPreview
                            data={displayPreview}
                            headerType={isOverwrite ? 'overwrite' : 'edit'}
                        />
                    );
                }
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
                    // Use enhanced file preview with full content for new file creation
                    if (displayPreview.operation === 'create' && displayPreview.content) {
                        return <CreateFilePreview data={displayPreview} />;
                    }
                    // Fallback for other file operations
                    return (
                        <Box marginBottom={1}>
                            <Text dimColor>
                                {displayPreview.operation === 'read' &&
                                    `Read ${displayPreview.lineCount ?? 'file'} lines`}
                                {displayPreview.operation === 'write' &&
                                    `Write to ${displayPreview.path}`}
                                {displayPreview.operation === 'delete' &&
                                    `Delete ${displayPreview.path}`}
                            </Text>
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
                    {options.map((option, index) => {
                        const isSelected = index === selectedIndex;
                        const isNo = option.id === 'no';

                        return (
                            <Box key={option.id}>
                                {isSelected ? (
                                    <Text color={isNo ? 'red' : 'green'} bold>
                                        {'  ▶ '}
                                        {option.label}
                                    </Text>
                                ) : (
                                    <Text color="gray">
                                        {'    '}
                                        {option.label}
                                    </Text>
                                )}
                            </Box>
                        );
                    })}
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

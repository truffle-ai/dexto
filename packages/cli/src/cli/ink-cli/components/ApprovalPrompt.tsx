import React, {
    forwardRef,
    useState,
    useImperativeHandle,
    useRef,
    useEffect,
    useMemo,
} from 'react';
import { Box, Text } from 'ink';
import type { ToolDisplayData, ElicitationMetadata } from '@dexto/core';
import type { Key } from '../hooks/useInputOrchestrator.js';
import { ElicitationForm, type ElicitationFormHandle } from './ElicitationForm.js';
import { DiffPreview, CreateFilePreview } from './renderers/index.js';
import { isEditWriteTool } from '../utils/toolUtils.js';
import { formatToolHeader } from '../utils/messageFormatting.js';

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
    /** Remember an approval pattern (e.g., "git *") */
    rememberPattern?: string;
    /** Form data for elicitation requests */
    formData?: Record<string, unknown>;
    /** Enable "accept all edits" mode (auto-approve future edit_file/write_file) */
    enableAcceptEditsMode?: boolean;
    /** Remember directory access for the session */
    rememberDirectory?: boolean;
}

interface ApprovalPromptProps {
    approval: ApprovalRequest;
    onApprove: (options: ApprovalOptions) => void;
    onDeny: (feedback?: string) => void;
    onCancel: () => void;
}

/**
 * Selection option type - supports both simple yes/no and pattern-based options
 */
type SelectionOption =
    | 'yes'
    | 'yes-session'
    | 'yes-accept-edits'
    | 'no'
    | `pattern-${number}`
    // Plan review specific options
    | 'plan-approve'
    | 'plan-approve-accept-edits'
    | 'plan-reject'; // Single reject option with feedback input

/**
 * Compact approval prompt component that displays above the input area
 * Shows options based on approval type:
 * - Tool confirmation: Yes, Yes (Session), No
 * - Tool with patterns: Yes (once), pattern options, Yes (session), No
 * - Elicitation: Form with input fields
 */
export const ApprovalPrompt = forwardRef<ApprovalPromptHandle, ApprovalPromptProps>(
    ({ approval, onApprove, onDeny, onCancel }, ref) => {
        const isCommandConfirmation = approval.type === 'command_confirmation';
        const isElicitation = approval.type === 'elicitation';
        const isDirectoryAccess = approval.type === 'directory_access';

        // Extract tool metadata
        const toolName = approval.metadata.toolName as string | undefined;
        const toolArgs = (approval.metadata.args as Record<string, unknown>) || {};
        const toolDisplayName = approval.metadata.toolDisplayName as string | undefined;

        // Check if this is a plan_review tool (shows custom approval options)
        const isPlanReview = toolName === 'plan_review';

        // Extract suggested patterns for tools that support pattern-based approvals
        const suggestedPatterns =
            (approval.metadata.suggestedPatterns as string[] | undefined) ?? [];
        const hasSuggestedPatterns = suggestedPatterns.length > 0;

        // Check if this is an edit/write file tool
        const isEditOrWriteTool = isEditWriteTool(toolName);

        // Format tool header using shared utility (same format as tool messages)
        const formattedTool = useMemo(() => {
            if (!toolName) return null;
            return formatToolHeader({
                toolName,
                args: toolArgs,
                ...(toolDisplayName !== undefined && { toolDisplayName }),
            });
        }, [toolName, toolDisplayName, toolArgs]);

        const [selectedIndex, setSelectedIndex] = useState(0);

        // State for plan review feedback input
        const [showFeedbackInput, setShowFeedbackInput] = useState(false);
        const [feedbackText, setFeedbackText] = useState('');

        // Ref for elicitation form
        const elicitationFormRef = useRef<ElicitationFormHandle>(null);

        // Use ref to avoid stale closure issues in handleInput
        const selectedIndexRef = useRef(0);

        // Build the list of options based on approval type
        const options: Array<{ id: SelectionOption; label: string }> = [];

        if (isPlanReview) {
            // Plan review - show plan-specific options (2 options + feedback input)
            options.push({ id: 'plan-approve', label: 'Approve' });
            options.push({ id: 'plan-approve-accept-edits', label: 'Approve + Accept All Edits' });
            // Third "option" is the feedback input (handled specially in render)
        } else if (hasSuggestedPatterns) {
            // Tool with pattern suggestions
            options.push({ id: 'yes', label: 'Yes (once)' });
            suggestedPatterns.forEach((pattern, i) => {
                options.push({
                    id: `pattern-${i}` as SelectionOption,
                    label: `Yes, allow "${pattern}"`,
                });
            });
            options.push({ id: 'yes-session', label: 'Yes, allow this tool (session)' });
            options.push({ id: 'no', label: 'No' });
        } else if (isCommandConfirmation) {
            // Command confirmation (no session option)
            options.push({ id: 'yes', label: 'Yes' });
            options.push({ id: 'no', label: 'No' });
        } else if (isDirectoryAccess) {
            // Directory access - offer session-scoped access
            const parentDir = approval.metadata.parentDir as string | undefined;
            const dirLabel = parentDir ? ` "${parentDir}"` : '';
            options.push({ id: 'yes', label: 'Yes (once)' });
            options.push({ id: 'yes-session', label: `Yes, allow${dirLabel} (session)` });
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

                    // For plan review, calculate total options including feedback input
                    const totalOptions = isPlanReview ? options.length + 1 : options.length;
                    const isFeedbackSelected =
                        isPlanReview && selectedIndexRef.current === options.length;

                    // Handle typing when feedback input is selected
                    if (isFeedbackSelected) {
                        if (key.return) {
                            // Submit rejection with feedback
                            onDeny(feedbackText || undefined);
                            return true;
                        } else if (key.backspace || key.delete) {
                            setFeedbackText((prev) => prev.slice(0, -1));
                            return true;
                        } else if (key.upArrow) {
                            // Navigate up from feedback input
                            setSelectedIndex(options.length - 1);
                            return true;
                        } else if (key.downArrow) {
                            // Wrap to first option
                            setSelectedIndex(0);
                            return true;
                        } else if (key.escape) {
                            onCancel();
                            return true;
                        } else if (input && !key.ctrl && !key.meta) {
                            // Add typed character to feedback
                            setFeedbackText((prev) => prev + input);
                            return true;
                        }
                        return true; // Consume all input when feedback is selected
                    }

                    if (key.upArrow) {
                        setSelectedIndex((current) =>
                            current === 0 ? totalOptions - 1 : current - 1
                        );
                        return true;
                    } else if (key.downArrow) {
                        setSelectedIndex((current) =>
                            current === totalOptions - 1 ? 0 : current + 1
                        );
                        return true;
                    } else if (key.return) {
                        const option = getCurrentOption();
                        if (!option) return false;

                        // Plan review options
                        if (option.id === 'plan-approve') {
                            onApprove({});
                        } else if (option.id === 'plan-approve-accept-edits') {
                            onApprove({ enableAcceptEditsMode: true });
                        } else if (option.id === 'yes') {
                            onApprove({});
                        } else if (option.id === 'yes-session') {
                            // For directory access, remember the directory; otherwise remember the tool
                            if (isDirectoryAccess) {
                                onApprove({ rememberDirectory: true });
                            } else {
                                onApprove({ rememberChoice: true });
                            }
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
                isDirectoryAccess,
                isPlanReview,
                options,
                suggestedPatterns,
                onApprove,
                onDeny,
                onCancel,
                feedbackText,
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
                    const isOverwrite = toolName === 'write_file';
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
                            <Text color="gray">$ </Text>
                            <Text color="yellowBright">{displayPreview.command}</Text>
                            {displayPreview.isBackground && <Text color="gray"> (background)</Text>}
                        </Box>
                    );
                case 'file':
                    // Use enhanced file preview with full content for file creation
                    if (displayPreview.operation === 'create' && displayPreview.content) {
                        return <CreateFilePreview data={displayPreview} />;
                    }
                    // For plan_review (read operation with content), show full content for review
                    if (
                        displayPreview.operation === 'read' &&
                        displayPreview.content &&
                        isPlanReview
                    ) {
                        return <CreateFilePreview data={displayPreview} header="Review plan" />;
                    }
                    // Fallback for other file operations
                    return (
                        <Box marginBottom={1}>
                            <Text color="gray">
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

        // Extract directory access metadata
        const directoryPath = approval.metadata.path as string | undefined;
        const parentDir = approval.metadata.parentDir as string | undefined;
        const operation = approval.metadata.operation as string | undefined;

        return (
            <Box paddingX={0} paddingY={0} flexDirection="column">
                {/* Compact header with context */}
                <Box flexDirection="column" marginBottom={0}>
                    {isDirectoryAccess ? (
                        <>
                            <Box flexDirection="row">
                                <Text color="yellowBright" bold>
                                    🔐 Directory Access:{' '}
                                </Text>
                                <Text color="cyan">{parentDir || directoryPath}</Text>
                            </Box>
                            <Box flexDirection="row" marginTop={0}>
                                <Text color="gray">{'  '}</Text>
                                <Text color="gray">
                                    {formattedTool ? `"${formattedTool.displayName}"` : 'Tool'}{' '}
                                    wants to {operation || 'access'} files outside working directory
                                </Text>
                            </Box>
                        </>
                    ) : (
                        <>
                            <Box flexDirection="row">
                                <Text color="yellowBright" bold>
                                    🔐 Approval:{' '}
                                </Text>
                                {formattedTool && <Text color="cyan">{formattedTool.header}</Text>}
                            </Box>
                            {isCommandConfirmation && command && (
                                <Box flexDirection="row" marginTop={0}>
                                    <Text color="gray">{'  Command: '}</Text>
                                    <Text color="red">{command}</Text>
                                </Box>
                            )}
                        </>
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

                    {/* Feedback input as third option for plan review */}
                    {isPlanReview && (
                        <Box>
                            {selectedIndex === options.length ? (
                                // Selected - show editable input
                                <Box flexDirection="row">
                                    <Text color="red" bold>
                                        {'  ▶ '}
                                    </Text>
                                    {feedbackText ? (
                                        <Text color="white">
                                            {feedbackText}
                                            <Text color="cyan">▋</Text>
                                        </Text>
                                    ) : (
                                        <Text color="gray">
                                            What changes would you like?
                                            <Text color="cyan">▋</Text>
                                        </Text>
                                    )}
                                </Box>
                            ) : (
                                // Not selected - show placeholder
                                <Text color="gray">
                                    {'    '}
                                    {feedbackText || 'What changes would you like?'}
                                </Text>
                            )}
                        </Box>
                    )}
                </Box>

                {/* Compact instructions */}
                <Box marginTop={0}>
                    <Text color="gray">{'  '}↑↓ to select • Enter to confirm • Esc to cancel</Text>
                </Box>
            </Box>
        );
    }
);

ApprovalPrompt.displayName = 'ApprovalPrompt';

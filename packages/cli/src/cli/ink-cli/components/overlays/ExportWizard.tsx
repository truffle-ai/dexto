/**
 * ExportWizard Component
 * Interactive wizard for exporting conversation to markdown or JSON
 */

import React, { useState, useEffect, forwardRef, useImperativeHandle, useCallback } from 'react';
import { Box, Text } from 'ink';
import fs from 'fs/promises';
import path from 'path';
import type { Key } from '../../hooks/useInputOrchestrator.js';
import type { DextoAgent } from '@dexto/core';

type ExportFormat = 'markdown' | 'json';

interface ExportOptions {
    format: ExportFormat;
    includeToolCalls: boolean;
    filename: string;
}

type WizardStep = 'format' | 'toolCalls' | 'filename' | 'confirm' | 'exporting' | 'done' | 'error';

interface ExportWizardProps {
    isVisible: boolean;
    agent: DextoAgent;
    sessionId: string | null;
    onClose: () => void;
}

export interface ExportWizardHandle {
    handleInput: (input: string, key: Key) => boolean;
}

/**
 * Generate default filename based on date and session ID
 */
function generateDefaultFilename(sessionId: string | null, format: ExportFormat): string {
    const date = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
    const shortId = sessionId ? sessionId.slice(0, 6) : 'unknown';
    const ext = format === 'markdown' ? 'md' : 'json';
    return `conversation-${date}-${shortId}.${ext}`;
}

interface FormattedMessage {
    role: string;
    content: unknown;
    timestamp?: string | undefined;
}

interface ExportMetadata {
    sessionId: string;
    title?: string | undefined;
    createdAt?: string | undefined;
}

/**
 * Format conversation history as Markdown
 */
function formatAsMarkdown(
    messages: FormattedMessage[],
    metadata: ExportMetadata,
    includeToolCalls: boolean
): string {
    const lines: string[] = [];

    // Header
    lines.push('# Conversation Export');
    lines.push('');
    lines.push(`- **Session**: ${metadata.sessionId}`);
    if (metadata.title) {
        lines.push(`- **Title**: ${metadata.title}`);
    }
    if (metadata.createdAt) {
        lines.push(`- **Created**: ${metadata.createdAt}`);
    }
    lines.push(`- **Exported**: ${new Date().toISOString()}`);
    lines.push('');
    lines.push('---');
    lines.push('');

    // Messages
    for (const msg of messages) {
        const role = msg.role.charAt(0).toUpperCase() + msg.role.slice(1);

        // Skip tool messages if not including tool calls
        if (!includeToolCalls && msg.role === 'tool') {
            continue;
        }

        lines.push(`## ${role}`);
        if (msg.timestamp) {
            lines.push(`*${msg.timestamp}*`);
        }
        lines.push('');

        // Handle different content types
        if (typeof msg.content === 'string') {
            lines.push(msg.content);
        } else if (Array.isArray(msg.content)) {
            // Handle content parts (text, tool calls, tool results)
            for (const part of msg.content) {
                if (typeof part === 'string') {
                    lines.push(part);
                } else if (part && typeof part === 'object') {
                    if ('text' in part) {
                        lines.push(String(part.text));
                    } else if ('type' in part && part.type === 'tool-call' && includeToolCalls) {
                        const toolCall = part as { toolName?: string; args?: unknown };
                        lines.push('');
                        lines.push(`### Tool: ${toolCall.toolName || 'unknown'}`);
                        lines.push('```json');
                        lines.push(JSON.stringify(toolCall.args || {}, null, 2));
                        lines.push('```');
                    } else if ('type' in part && part.type === 'tool-result' && includeToolCalls) {
                        const toolResult = part as { toolName?: string; result?: unknown };
                        lines.push('');
                        lines.push('<details>');
                        lines.push(
                            `<summary>Result: ${toolResult.toolName || 'unknown'}</summary>`
                        );
                        lines.push('');
                        lines.push('```');
                        const resultStr =
                            typeof toolResult.result === 'string'
                                ? toolResult.result
                                : JSON.stringify(toolResult.result, null, 2);
                        // Truncate very long results
                        if (resultStr.length > 2000) {
                            lines.push(resultStr.slice(0, 2000) + '\n... (truncated)');
                        } else {
                            lines.push(resultStr);
                        }
                        lines.push('```');
                        lines.push('</details>');
                    }
                }
            }
        } else if (msg.content && typeof msg.content === 'object') {
            lines.push('```json');
            lines.push(JSON.stringify(msg.content, null, 2));
            lines.push('```');
        }

        lines.push('');
        lines.push('---');
        lines.push('');
    }

    return lines.join('\n');
}

/**
 * Format conversation history as JSON
 */
function formatAsJson(
    messages: FormattedMessage[],
    metadata: ExportMetadata,
    includeToolCalls: boolean
): string {
    const filteredMessages = includeToolCalls
        ? messages
        : messages.filter((m) => m.role !== 'tool');

    return JSON.stringify(
        {
            exportedAt: new Date().toISOString(),
            session: metadata,
            messages: filteredMessages,
        },
        null,
        2
    );
}

/**
 * Interactive wizard for exporting conversation
 */
const ExportWizard = forwardRef<ExportWizardHandle, ExportWizardProps>(function ExportWizard(
    { isVisible, agent, sessionId, onClose },
    ref
) {
    const [step, setStep] = useState<WizardStep>('format');
    const [options, setOptions] = useState<ExportOptions>({
        format: 'markdown',
        includeToolCalls: true,
        filename: '',
    });
    const [selectedIndex, setSelectedIndex] = useState(0);
    const [filenameInput, setFilenameInput] = useState('');
    const [exportResult, setExportResult] = useState<{
        success: boolean;
        path?: string;
        error?: string;
    } | null>(null);

    // Reset when becoming visible
    useEffect(() => {
        if (isVisible) {
            setStep('format');
            setOptions({
                format: 'markdown',
                includeToolCalls: true,
                filename: '',
            });
            setSelectedIndex(0);
            setFilenameInput('');
            setExportResult(null);
        }
    }, [isVisible]);

    // Update default filename when format changes
    useEffect(() => {
        if (step === 'filename' && !filenameInput) {
            setFilenameInput(generateDefaultFilename(sessionId, options.format));
        }
    }, [step, sessionId, options.format, filenameInput]);

    const doExport = useCallback(async () => {
        if (!sessionId) {
            setExportResult({ success: false, error: 'No active session' });
            setStep('error');
            return;
        }

        setStep('exporting');

        try {
            // Get session history and metadata
            const history = await agent.getSessionHistory(sessionId);
            const metadata = await agent.getSessionMetadata(sessionId);

            const exportMetadata = {
                sessionId,
                title: metadata?.title,
                createdAt: metadata?.createdAt
                    ? new Date(metadata.createdAt).toISOString()
                    : undefined,
            };

            // Format content - cast history to expected type
            const formattedHistory = history.map((msg) => ({
                role: msg.role,
                content: msg.content,
                timestamp:
                    'timestamp' in msg && typeof msg.timestamp === 'number'
                        ? new Date(msg.timestamp).toISOString()
                        : undefined,
            }));

            const content =
                options.format === 'markdown'
                    ? formatAsMarkdown(formattedHistory, exportMetadata, options.includeToolCalls)
                    : formatAsJson(formattedHistory, exportMetadata, options.includeToolCalls);

            // Write file
            const outputPath = path.resolve(process.cwd(), options.filename || filenameInput);
            await fs.writeFile(outputPath, content, 'utf-8');

            setExportResult({ success: true, path: outputPath });
            setStep('done');
        } catch (error) {
            setExportResult({
                success: false,
                error: error instanceof Error ? error.message : String(error),
            });
            setStep('error');
        }
    }, [agent, sessionId, options, filenameInput]);

    // Handle keyboard input
    useImperativeHandle(
        ref,
        () => ({
            handleInput: (input: string, key: Key): boolean => {
                if (!isVisible) return false;

                // Escape to close
                if (key.escape) {
                    onClose();
                    return true;
                }

                // Done/error state - Enter/Esc closes, consume all other input
                if (step === 'done' || step === 'error') {
                    if (key.return || key.escape) {
                        onClose();
                    }
                    return true; // Consume all input in terminal states
                }

                // Format selection step
                if (step === 'format') {
                    if (key.upArrow || key.downArrow) {
                        setSelectedIndex((prev) => (prev === 0 ? 1 : 0));
                        return true;
                    }
                    if (key.return) {
                        setOptions((prev) => ({
                            ...prev,
                            format: selectedIndex === 0 ? 'markdown' : 'json',
                        }));
                        setSelectedIndex(0);
                        setStep('toolCalls');
                        return true;
                    }
                    return false;
                }

                // Tool calls selection step
                if (step === 'toolCalls') {
                    if (key.upArrow || key.downArrow) {
                        setSelectedIndex((prev) => (prev === 0 ? 1 : 0));
                        return true;
                    }
                    if (key.return) {
                        setOptions((prev) => ({
                            ...prev,
                            includeToolCalls: selectedIndex === 0,
                        }));
                        setFilenameInput(generateDefaultFilename(sessionId, options.format));
                        setStep('filename');
                        return true;
                    }
                    return false;
                }

                // Filename input step
                if (step === 'filename') {
                    if (key.return) {
                        setOptions((prev) => ({ ...prev, filename: filenameInput }));
                        setStep('confirm');
                        return true;
                    }
                    if (key.backspace || key.delete) {
                        setFilenameInput((prev) => prev.slice(0, -1));
                        return true;
                    }
                    if (input && !key.ctrl && !key.meta) {
                        setFilenameInput((prev) => prev + input);
                        return true;
                    }
                    return false;
                }

                // Confirm step
                if (step === 'confirm') {
                    if (key.upArrow || key.downArrow) {
                        setSelectedIndex((prev) => (prev === 0 ? 1 : 0));
                        return true;
                    }
                    if (key.return) {
                        if (selectedIndex === 0) {
                            doExport();
                        } else {
                            onClose();
                        }
                        return true;
                    }
                    return false;
                }

                return false;
            },
        }),
        [isVisible, step, selectedIndex, options, filenameInput, onClose, doExport, sessionId]
    );

    if (!isVisible) return null;

    // Render based on current step
    return (
        <Box
            flexDirection="column"
            borderStyle="round"
            borderColor="cyan"
            paddingX={1}
            marginTop={1}
        >
            {/* Header */}
            <Box marginBottom={1}>
                <Text bold color="cyan">
                    📤 Export Conversation
                </Text>
            </Box>

            {/* Format selection */}
            {step === 'format' && (
                <Box flexDirection="column">
                    <Text>Select export format:</Text>
                    <Box marginTop={1} flexDirection="column">
                        <Text {...(selectedIndex === 0 ? { color: 'cyan' } : {})}>
                            {selectedIndex === 0 ? '❯ ' : '  '}Markdown (.md) - Human readable
                        </Text>
                        <Text {...(selectedIndex === 1 ? { color: 'cyan' } : {})}>
                            {selectedIndex === 1 ? '❯ ' : '  '}JSON (.json) - Structured data
                        </Text>
                    </Box>
                    <Box marginTop={1}>
                        <Text color="gray">↑↓ to select • Enter to continue • Esc to cancel</Text>
                    </Box>
                </Box>
            )}

            {/* Tool calls selection */}
            {step === 'toolCalls' && (
                <Box flexDirection="column">
                    <Text>Include tool calls and results?</Text>
                    <Box marginTop={1} flexDirection="column">
                        <Text {...(selectedIndex === 0 ? { color: 'cyan' } : {})}>
                            {selectedIndex === 0 ? '❯ ' : '  '}Yes - Include all tool interactions
                        </Text>
                        <Text {...(selectedIndex === 1 ? { color: 'cyan' } : {})}>
                            {selectedIndex === 1 ? '❯ ' : '  '}No - Only user and assistant messages
                        </Text>
                    </Box>
                    <Box marginTop={1}>
                        <Text color="gray">↑↓ to select • Enter to continue • Esc to cancel</Text>
                    </Box>
                </Box>
            )}

            {/* Filename input */}
            {step === 'filename' && (
                <Box flexDirection="column">
                    <Text>Filename:</Text>
                    <Box marginTop={1}>
                        <Text color="cyan">&gt; </Text>
                        <Text>{filenameInput}</Text>
                        <Text color="cyan">_</Text>
                    </Box>
                    <Box marginTop={1}>
                        <Text color="gray">Enter to continue • Esc to cancel</Text>
                    </Box>
                </Box>
            )}

            {/* Confirm step */}
            {step === 'confirm' && (
                <Box flexDirection="column">
                    <Text>Export with these settings?</Text>
                    <Box marginTop={1} flexDirection="column" marginLeft={2}>
                        <Text color="gray">
                            Format:{' '}
                            <Text color="white">
                                {options.format === 'markdown' ? 'Markdown' : 'JSON'}
                            </Text>
                        </Text>
                        <Text color="gray">
                            Tool calls:{' '}
                            <Text color="white">{options.includeToolCalls ? 'Yes' : 'No'}</Text>
                        </Text>
                        <Text color="gray">
                            File: <Text color="white">{filenameInput}</Text>
                        </Text>
                    </Box>
                    <Box marginTop={1} flexDirection="column">
                        <Text {...(selectedIndex === 0 ? { color: 'green' } : {})}>
                            {selectedIndex === 0 ? '❯ ' : '  '}Export
                        </Text>
                        <Text {...(selectedIndex === 1 ? { color: 'red' } : {})}>
                            {selectedIndex === 1 ? '❯ ' : '  '}Cancel
                        </Text>
                    </Box>
                    <Box marginTop={1}>
                        <Text color="gray">↑↓ to select • Enter to confirm</Text>
                    </Box>
                </Box>
            )}

            {/* Exporting state */}
            {step === 'exporting' && (
                <Box flexDirection="column">
                    <Text color="yellow">Exporting...</Text>
                </Box>
            )}

            {/* Done state */}
            {step === 'done' && exportResult?.success && (
                <Box flexDirection="column">
                    <Text color="green">✓ Exported successfully!</Text>
                    <Box marginTop={1}>
                        <Text color="gray">Saved to: </Text>
                        <Text>{exportResult.path}</Text>
                    </Box>
                    <Box marginTop={1}>
                        <Text color="gray">Press Enter or Esc to close</Text>
                    </Box>
                </Box>
            )}

            {/* Error state */}
            {step === 'error' && (
                <Box flexDirection="column">
                    <Text color="red">✗ Export failed</Text>
                    <Box marginTop={1}>
                        <Text color="red">{exportResult?.error}</Text>
                    </Box>
                    <Box marginTop={1}>
                        <Text color="gray">Press Enter or Esc to close</Text>
                    </Box>
                </Box>
            )}
        </Box>
    );
});

export default ExportWizard;

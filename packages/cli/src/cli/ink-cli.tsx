import React, { useState, useEffect, useCallback, useRef } from 'react';
import { render, Box, Text, useInput, useApp } from 'ink';
import TextInput from 'ink-text-input';
import Spinner from 'ink-spinner';
import { DextoAgent, ApprovalStatus, DenialReason, ApprovalType } from '@dexto/core';
import { parseInput } from './commands/interactive-commands/command-parser.js';
import { executeCommand } from './commands/interactive-commands/commands.js';
import { capture } from '../analytics/index.js';
import type { AgentEventBus, PromptInfo, ResourceMetadata } from '@dexto/core';
import SlashCommandAutocomplete from './ink-cli/components/SlashCommandAutocomplete.js';
import ResourceAutocomplete from './ink-cli/components/ResourceAutocomplete.js';
import CustomInput from './ink-cli/components/CustomInput.js';
import { ApprovalPrompt, type ApprovalRequest } from './ink-cli/components/ApprovalPrompt.js';

interface Message {
    id: string;
    role: 'user' | 'assistant' | 'system' | 'tool';
    content: string;
    timestamp: Date;
    isStreaming?: boolean;
}

interface InkCLIProps {
    agent: DextoAgent;
}

/**
 * Modern CLI interface using React Ink for a clean, chat-optimized experience
 */
export function InkCLI({ agent }: InkCLIProps) {
    const { exit } = useApp();
    const [messages, setMessages] = useState<Message[]>([]);
    const [input, setInput] = useState('');
    const [isProcessing, setIsProcessing] = useState(false);
    const [currentStreamingContent, setCurrentStreamingContent] = useState('');
    const [currentStreamingId, setCurrentStreamingId] = useState<string | null>(null);
    const [eventBus, setEventBus] = useState<AgentEventBus | null>(null);
    const streamingIdRef = useRef<string | null>(null);
    const [showSlashAutocomplete, setShowSlashAutocomplete] = useState(false);
    const [showResourceAutocomplete, setShowResourceAutocomplete] = useState(false);
    const [inputHistory, setInputHistory] = useState<string[]>([]);
    const [historyIndex, setHistoryIndex] = useState<number>(-1);
    const historyIndexRef = useRef<number>(-1);
    const [pendingApproval, setPendingApproval] = useState<ApprovalRequest | null>(null);

    // Keep refs in sync with state
    useEffect(() => {
        streamingIdRef.current = currentStreamingId;
    }, [currentStreamingId]);

    useEffect(() => {
        historyIndexRef.current = historyIndex;
    }, [historyIndex]);

    // Initialize event bus subscription
    useEffect(() => {
        const bus = agent.agentEventBus;
        setEventBus(bus);

        const handleChunk = (payload: { type: string; content: string }) => {
            if (payload.type === 'text') {
                setCurrentStreamingContent((prev: string) => prev + payload.content);
            }
        };

        const handleResponse = (payload: { content: string }) => {
            setIsProcessing(false);
            const streamingId = streamingIdRef.current;
            setMessages((prev: Message[]) => {
                if (streamingId) {
                    return prev.map((msg: Message) =>
                        msg.id === streamingId
                            ? { ...msg, content: payload.content, isStreaming: false }
                            : msg
                    );
                } else {
                    // Fallback: add as new message
                    return [
                        ...prev,
                        {
                            id: `msg-${Date.now()}`,
                            role: 'assistant',
                            content: payload.content,
                            timestamp: new Date(),
                        },
                    ];
                }
            });
            setCurrentStreamingContent('');
            setCurrentStreamingId(null);
        };

        const handleError = (payload: { error: Error }) => {
            setIsProcessing(false);
            setCurrentStreamingContent('');
            const errorId = streamingIdRef.current;
            setCurrentStreamingId(null);
            setMessages((prev: Message[]) => {
                // Remove streaming message if it exists
                const filtered = errorId ? prev.filter((msg: Message) => msg.id !== errorId) : prev;
                return [
                    ...filtered,
                    {
                        id: `error-${Date.now()}`,
                        role: 'system',
                        content: `❌ Error: ${payload.error.message}`,
                        timestamp: new Date(),
                    },
                ];
            });
        };

        const handleToolCall = (payload: { toolName: string; args: any }) => {
            setMessages((prev: Message[]) => [
                ...prev,
                {
                    id: `tool-${Date.now()}`,
                    role: 'tool',
                    content: `🔧 Calling tool: ${payload.toolName}`,
                    timestamp: new Date(),
                },
            ]);
        };

        const handleApprovalRequest = (event: {
            approvalId: string;
            type: string;
            sessionId?: string;
            timeout?: number;
            timestamp: Date;
            metadata: Record<string, any>;
        }) => {
            // Only handle tool confirmation approvals in ink-cli
            // Elicitation can be handled separately if needed
            if (event.type === ApprovalType.TOOL_CONFIRMATION) {
                const approval: ApprovalRequest = {
                    approvalId: event.approvalId,
                    type: event.type,
                    timestamp: event.timestamp,
                    metadata: event.metadata,
                };

                // Only include optional properties if they're defined
                if (event.sessionId !== undefined) {
                    approval.sessionId = event.sessionId;
                }
                if (event.timeout !== undefined) {
                    approval.timeout = event.timeout;
                }

                setPendingApproval(approval);
            }
        };

        bus.on('llmservice:chunk', handleChunk);
        bus.on('llmservice:response', handleResponse);
        bus.on('llmservice:error', handleError);
        bus.on('llmservice:toolCall', handleToolCall);
        bus.on('dexto:approvalRequest', handleApprovalRequest);

        return () => {
            bus.off('llmservice:chunk', handleChunk);
            bus.off('llmservice:response', handleResponse);
            bus.off('llmservice:error', handleError);
            bus.off('llmservice:toolCall', handleToolCall);
            bus.off('dexto:approvalRequest', handleApprovalRequest);
        };
    }, [agent]);

    // Update streaming message content
    useEffect(() => {
        if (currentStreamingContent && currentStreamingId) {
            setMessages((prev: Message[]) =>
                prev.map((msg: Message) =>
                    msg.id === currentStreamingId
                        ? { ...msg, content: currentStreamingContent, isStreaming: true }
                        : msg
                )
            );
        }
    }, [currentStreamingContent, currentStreamingId]);

    const handleSubmit = useCallback(
        async (value: string) => {
            if (!value.trim() || isProcessing) return;

            // Close autocomplete when submitting
            setShowSlashAutocomplete(false);
            setShowResourceAutocomplete(false);

            const trimmed = value.trim();

            // Add to history (avoid duplicates and empty strings)
            setInputHistory((prev) => {
                if (trimmed && (prev.length === 0 || prev[prev.length - 1] !== trimmed)) {
                    return [...prev, trimmed].slice(-100); // Keep last 100 entries
                }
                return prev;
            });
            setHistoryIndex(-1); // Reset history index

            setInput('');
            setIsProcessing(true);

            // Add user message
            const userMessage: Message = {
                id: `user-${Date.now()}`,
                role: 'user',
                content: trimmed,
                timestamp: new Date(),
            };
            setMessages((prev: Message[]) => [...prev, userMessage]);

            // Parse input to check if it's a command
            const parsed = parseInput(trimmed);

            if (parsed.type === 'command') {
                // Handle slash command
                if (!parsed.command) {
                    setMessages((prev: Message[]) => [
                        ...prev,
                        {
                            id: `system-${Date.now()}`,
                            role: 'system',
                            content: '💡 Type /help to see available commands',
                            timestamp: new Date(),
                        },
                    ]);
                    setIsProcessing(false);
                    return;
                }

                try {
                    const shouldContinue = await executeCommand(
                        parsed.command,
                        parsed.args || [],
                        agent
                    );
                    setIsProcessing(false);
                    if (!shouldContinue) {
                        // Command handled, don't add assistant message
                        return;
                    }
                } catch (error) {
                    setIsProcessing(false);
                    setMessages((prev) => [
                        ...prev,
                        {
                            id: `error-${Date.now()}`,
                            role: 'system',
                            content: `❌ Command error: ${error instanceof Error ? error.message : String(error)}`,
                            timestamp: new Date(),
                        },
                    ]);
                    return;
                }
            } else {
                // Handle regular prompt - pass to AI
                const llm = agent.getCurrentLLMConfig();
                capture('dexto_prompt', {
                    mode: 'ink-cli',
                    provider: llm.provider,
                    model: llm.model,
                });

                // Create streaming message placeholder
                const streamingMessageId = `assistant-${Date.now()}`;
                setCurrentStreamingId(streamingMessageId);
                setCurrentStreamingContent('');
                setMessages((prev: Message[]) => [
                    ...prev,
                    {
                        id: streamingMessageId,
                        role: 'assistant',
                        content: '',
                        timestamp: new Date(),
                        isStreaming: true,
                    },
                ]);

                try {
                    await agent.run(trimmed);
                } catch (error) {
                    setIsProcessing(false);
                    setCurrentStreamingId(null);
                    setCurrentStreamingContent('');
                    setMessages((prev: Message[]) =>
                        prev.filter((msg: Message) => msg.id !== streamingMessageId)
                    );
                    setMessages((prev: Message[]) => [
                        ...prev,
                        {
                            id: `error-${Date.now()}`,
                            role: 'system',
                            content: `❌ Error: ${error instanceof Error ? error.message : String(error)}`,
                            timestamp: new Date(),
                        },
                    ]);
                }
            }
        },
        [agent, isProcessing]
    );

    // Find active @ mention position (at start or after space)
    const findActiveAtIndex = useCallback((value: string, caret: number) => {
        // Walk backwards from caret to find an '@'
        // @ is only valid if:
        // 1. At the start of the message (i === 0), OR
        // 2. Preceded by whitespace
        for (let i = caret - 1; i >= 0; i--) {
            const ch = value[i];
            if (ch === '@') {
                // Check if @ is at start or preceded by whitespace
                if (i === 0) {
                    return i; // @ at start is valid
                }
                const prev = value[i - 1];
                if (prev && /\s/.test(prev)) {
                    return i; // @ after whitespace is valid
                }
                return -1; // @ in middle of text (like email) - ignore
            }
            if (ch && /\s/.test(ch)) break; // stop at whitespace
        }
        return -1;
    }, []);

    // Detect slash command or @ mention input for autocomplete
    useEffect(() => {
        const caret = input.length; // Approximate caret position (end of input for now)

        if (input.startsWith('/')) {
            setShowSlashAutocomplete(true);
            setShowResourceAutocomplete(false);
        } else {
            const atIndex = findActiveAtIndex(input, caret);
            if (atIndex >= 0) {
                setShowSlashAutocomplete(false);
                setShowResourceAutocomplete(true);
            } else {
                setShowSlashAutocomplete(false);
                setShowResourceAutocomplete(false);
            }
        }
    }, [input, findActiveAtIndex]);

    // Handle prompt selection from autocomplete
    const handlePromptSelect = useCallback((prompt: PromptInfo) => {
        setInput(`/${prompt.name} `);
        setShowSlashAutocomplete(false);
    }, []);

    // Handle resource selection from autocomplete
    const handleResourceSelect = useCallback(
        (resource: ResourceMetadata) => {
            // Find the @ position and replace everything after it with the resource reference
            const atIndex = findActiveAtIndex(input, input.length);
            if (atIndex >= 0) {
                const before = input.slice(0, atIndex + 1);
                // Use resource name if available, otherwise extract from URI
                const uriParts = resource.uri.split('/');
                const reference = resource.name || uriParts[uriParts.length - 1] || resource.uri;
                setInput(`${before}${reference} `);
            } else {
                // Fallback: just append
                const uriParts = resource.uri.split('/');
                const reference = resource.name || uriParts[uriParts.length - 1] || resource.uri;
                setInput(`${input}@${reference} `);
            }
            setShowResourceAutocomplete(false);
        },
        [input, findActiveAtIndex]
    );

    // Helper function to delete word backward (from cursor position)
    const deleteWordBackward = useCallback(
        (text: string, cursorPos: number = text.length): string => {
            if (cursorPos === 0) return text;

            // Find the start of the word before cursor
            let pos = cursorPos - 1;

            // Skip whitespace
            while (pos >= 0) {
                const char = text[pos];
                if (char && !/\s/.test(char)) break;
                pos--;
            }

            // Skip word characters
            while (pos >= 0) {
                const char = text[pos];
                if (char && /\s/.test(char)) break;
                pos--;
            }

            // pos is now at the start of the word (or -1)
            const deleteStart = pos + 1;
            return text.slice(0, deleteStart) + text.slice(cursorPos);
        },
        []
    );

    // Helper function to delete word forward (from cursor position)
    const deleteWordForward = useCallback(
        (text: string, cursorPos: number = text.length): string => {
            if (cursorPos >= text.length) return text;

            // Find the end of the word after cursor
            let pos = cursorPos;

            // Skip whitespace
            while (pos < text.length) {
                const char = text[pos];
                if (char && !/\s/.test(char)) break;
                pos++;
            }

            // Skip word characters
            while (pos < text.length) {
                const char = text[pos];
                if (char && /\s/.test(char)) break;
                pos++;
            }

            return text.slice(0, cursorPos) + text.slice(pos);
        },
        []
    );

    // Helper function to delete line (delete everything from start to cursor)
    // For single-line input, this deletes the entire input
    const deleteLine = useCallback((text: string): string => {
        // For single-line input, delete everything
        return '';
    }, []);

    // Handle keyboard shortcuts and input history
    // Note: All text input (including Shift+Enter) is handled by CustomInput component
    // This hook only handles global shortcuts (history, cancel, etc.)
    // IMPORTANT: We need to be careful not to interfere with CustomInput's input handling
    useInput(
        (inputChar, key) => {
            // Don't intercept if approval prompt is active
            if (pendingApproval) {
                return; // Let ApprovalPrompt handle input
            }

            // Don't intercept if autocomplete is handling input
            if (
                (showSlashAutocomplete || showResourceAutocomplete) &&
                (key.upArrow || key.downArrow || key.tab || key.escape)
            ) {
                return; // Let autocomplete handle it
            }

            // Don't intercept Enter/Return keys - TextInput handles them
            if (key.return) {
                return;
            }

            // Handle input history navigation (only when not in autocomplete)
            if (!showSlashAutocomplete && !showResourceAutocomplete && inputHistory.length > 0) {
                if (key.upArrow) {
                    // Navigate backward in history
                    const newIndex =
                        historyIndexRef.current < 0
                            ? inputHistory.length - 1
                            : Math.max(0, historyIndexRef.current - 1);
                    const historyItem = inputHistory[newIndex];
                    if (historyItem !== undefined) {
                        setHistoryIndex(newIndex);
                        setInput(historyItem);
                    }
                    return;
                }

                if (key.downArrow) {
                    // Navigate forward in history
                    if (historyIndexRef.current >= 0) {
                        const newIndex = historyIndexRef.current + 1;
                        if (newIndex >= inputHistory.length) {
                            // Reached end of history, clear input
                            setHistoryIndex(-1);
                            setInput('');
                        } else {
                            const historyItem = inputHistory[newIndex];
                            if (historyItem !== undefined) {
                                setHistoryIndex(newIndex);
                                setInput(historyItem);
                            }
                        }
                    }
                    return;
                }
            }

            if (key.ctrl && inputChar === 'c') {
                // Cancel current operation
                if (isProcessing) {
                    void agent.cancel().catch(() => {});
                    setIsProcessing(false);
                    setCurrentStreamingId(null);
                    setCurrentStreamingContent('');
                } else {
                    exit();
                }
            }
            if (key.escape && isProcessing) {
                void agent.cancel().catch(() => {});
                setIsProcessing(false);
                setCurrentStreamingId(null);
                setCurrentStreamingContent('');
            }
        },
        {
            // Only active when NOT processing and NOT showing approval (CustomInput handles input when active)
            // This ensures CustomInput's useInput hook has priority
            isActive: !isProcessing && !pendingApproval,
        }
    );

    // Handle approval responses
    const handleApprove = useCallback(
        (rememberChoice: boolean) => {
            if (!pendingApproval || !eventBus) return;

            const response = {
                approvalId: pendingApproval.approvalId,
                status: ApprovalStatus.APPROVED,
                sessionId: pendingApproval.sessionId,
                data: {
                    rememberChoice,
                },
            };

            eventBus.emit('dexto:approvalResponse', response);
            setPendingApproval(null);
        },
        [pendingApproval, eventBus]
    );

    const handleDeny = useCallback(() => {
        if (!pendingApproval || !eventBus) return;

        const response = {
            approvalId: pendingApproval.approvalId,
            status: ApprovalStatus.DENIED,
            sessionId: pendingApproval.sessionId,
            reason: DenialReason.USER_DENIED,
            message: 'User denied the tool execution',
        };

        eventBus.emit('dexto:approvalResponse', response);
        setPendingApproval(null);
    }, [pendingApproval, eventBus]);

    const handleCancel = useCallback(() => {
        if (!pendingApproval || !eventBus) return;

        const response = {
            approvalId: pendingApproval.approvalId,
            status: ApprovalStatus.CANCELLED,
            sessionId: pendingApproval.sessionId,
            reason: DenialReason.USER_CANCELLED,
            message: 'User cancelled the approval request',
        };

        eventBus.emit('dexto:approvalResponse', response);
        setPendingApproval(null);
    }, [pendingApproval, eventBus]);

    // Calculate visible messages (last 50 for performance)
    const visibleMessages = messages.slice(-50);

    return (
        <Box flexDirection="column" height="100%" width="100%">
            {/* Header */}
            <Box borderStyle="single" borderColor="gray" paddingX={1} flexDirection="column">
                <Box marginTop={1}>
                    <Text color="greenBright">
                        ██████╗ ███████╗██╗ ██╗████████╗ ██████╗ ██████╗██╗ ██╗
                    </Text>
                </Box>
                <Box>
                    <Text color="greenBright">
                        ██╔══██╗██╔════╝╚██╗██╔╝╚══██╔══╝██╔═══██╗ ██╔════╝██║ ██║
                    </Text>
                </Box>
                <Box>
                    <Text color="greenBright">██║ ██║█████╗ ╚███╔╝ ██║ ██║ ██║ ██║ ██║ ██║</Text>
                </Box>
                <Box>
                    <Text color="greenBright">██║ ██║██╔══╝ ██╔██╗ ██║ ██║ ██║ ██║ ██║ ██║</Text>
                </Box>
                <Box>
                    <Text color="greenBright">
                        ██████╔╝███████╗██╔╝ ██╗ ██║ ╚██████╔╝ ╚██████╗███████╗██║
                    </Text>
                </Box>
                <Box>
                    <Text color="greenBright">
                        ╚═════╝ ╚══════╝╚═╝ ╚═╝ ╚═╝ ╚═════╝ ╚═════╝╚══════╝╚═╝
                    </Text>
                </Box>
                <Box marginTop={1} flexDirection="row">
                    <Text color="gray" dimColor>
                        Model:{' '}
                    </Text>
                    <Text color="white">{agent.getCurrentLLMConfig().model}</Text>
                    <Text color="gray" dimColor>
                        {' '}
                        • Session:{' '}
                    </Text>
                    <Text color="white">{agent.getCurrentSessionId().slice(0, 8)}</Text>
                </Box>
                <Box marginBottom={1}>
                    <Text> </Text>
                </Box>
            </Box>

            {/* Messages area */}
            <Box flexDirection="column" flexGrow={1} paddingX={1} paddingY={1}>
                {visibleMessages.length === 0 && (
                    <Box marginY={2}>
                        <Text dimColor>
                            Welcome to Dexto CLI! Type your message below or use /help for commands.
                        </Text>
                    </Box>
                )}
                {visibleMessages.map((msg) => (
                    <Box key={msg.id} marginBottom={1} flexDirection="column">
                        <Box>
                            <Text
                                color={
                                    msg.role === 'user'
                                        ? 'green'
                                        : msg.role === 'assistant'
                                          ? 'cyan'
                                          : msg.role === 'tool'
                                            ? 'yellow'
                                            : 'gray'
                                }
                                bold
                            >
                                {msg.role === 'user'
                                    ? 'You:'
                                    : msg.role === 'assistant'
                                      ? 'AI:'
                                      : msg.role === 'tool'
                                        ? 'Tool:'
                                        : 'System:'}
                            </Text>
                        </Box>
                        <Box marginLeft={2}>
                            <Text wrap="wrap">{msg.content || '...'}</Text>
                            {msg.isStreaming && (
                                <Text color="gray">
                                    {' '}
                                    <Spinner type="dots" />
                                </Text>
                            )}
                        </Box>
                    </Box>
                ))}
            </Box>

            {/* Approval prompt - above input area */}
            {pendingApproval && (
                <ApprovalPrompt
                    approval={pendingApproval}
                    onApprove={handleApprove}
                    onDeny={handleDeny}
                    onCancel={handleCancel}
                />
            )}

            {/* Input area */}
            <Box borderStyle="single" borderColor="green" paddingX={1} flexDirection="row">
                <Text color="green" bold>
                    {'> '}
                </Text>
                <Box flexGrow={1}>
                    <CustomInput
                        value={input}
                        onChange={setInput}
                        onSubmit={handleSubmit}
                        placeholder={
                            pendingApproval
                                ? 'Approval required above...'
                                : isProcessing
                                  ? 'Processing... (Press Esc to cancel)'
                                  : 'Type your message or /help for commands'
                        }
                        isProcessing={isProcessing || !!pendingApproval}
                        onWordDelete={() => setInput((prev) => deleteWordBackward(prev))}
                        onLineDelete={() => setInput((prev) => deleteLine(prev))}
                    />
                </Box>
                {isProcessing && (
                    <Box marginLeft={1}>
                        <Text color="yellow">
                            <Spinner type="dots" />
                        </Text>
                    </Box>
                )}
            </Box>

            {/* Slash command autocomplete - below input */}
            {showSlashAutocomplete && (
                <Box marginTop={1}>
                    <SlashCommandAutocomplete
                        isVisible={showSlashAutocomplete}
                        searchQuery={input}
                        onSelectPrompt={handlePromptSelect}
                        onClose={() => setShowSlashAutocomplete(false)}
                        agent={agent}
                    />
                </Box>
            )}

            {/* Resource autocomplete - below input */}
            {showResourceAutocomplete && (
                <Box marginTop={1}>
                    <ResourceAutocomplete
                        isVisible={showResourceAutocomplete}
                        searchQuery={input}
                        onSelectResource={handleResourceSelect}
                        onClose={() => setShowResourceAutocomplete(false)}
                        agent={agent}
                    />
                </Box>
            )}

            {/* Footer */}
            <Box borderStyle="single" borderColor="gray" paddingX={1}>
                <Text dimColor>Ctrl+C: exit • Esc: cancel • ↑↓: history • /help: commands</Text>
            </Box>
        </Box>
    );
}

/**
 * Start the modern Ink-based CLI
 */
export async function startInkCli(agent: DextoAgent): Promise<void> {
    // Minimal initialization for ink-cli (no console spam, UI handles display)
    const { registerGracefulShutdown } = await import('../utils/graceful-shutdown.js');
    registerGracefulShutdown(() => agent);

    // Render the Ink CLI interface
    render(<InkCLI agent={agent} />);
}

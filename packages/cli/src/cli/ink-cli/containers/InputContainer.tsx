/**
 * InputContainer Component
 * Smart container for input area - handles submission and state
 *
 * Buffer is passed as prop from parent (useCLIState).
 * No more ref chain - buffer can be accessed directly.
 */

import React, { useCallback, useRef, useEffect } from 'react';
import type { DextoAgent } from '@dexto/core';
import { InputArea, type OverlayTrigger } from '../components/input/InputArea.js';
import { InputService } from '../services/InputService.js';
import type { OverlayType, McpWizardServerType, Message } from '../state/types.js';
import { createUserMessage } from '../utils/messageFormatting.js';
import { generateMessageId } from '../utils/idGenerator.js';
import type { ApprovalRequest } from '../components/ApprovalPrompt.js';
import type { TextBuffer } from '../components/shared/text-buffer.js';

/** Type for pending session creation promise */
type SessionCreationResult = { id: string };

/** UI state shape */
interface UIState {
    isProcessing: boolean;
    isCancelling: boolean;
    isThinking: boolean;
    activeOverlay: OverlayType;
    exitWarningShown: boolean;
    exitWarningTimestamp: number | null;
    mcpWizardServerType: McpWizardServerType;
    copyModeEnabled: boolean;
}

/** Input state shape - just tracks history now */
interface InputState {
    value: string; // Synced from buffer.onChange
    history: string[];
    historyIndex: number;
}

/** Session state shape */
interface SessionState {
    id: string | null;
    hasActiveSession: boolean;
    modelName: string;
}

interface InputContainerProps {
    /** Text buffer (owned by useCLIState) */
    buffer: TextBuffer;
    input: InputState;
    ui: UIState;
    session: SessionState;
    approval: ApprovalRequest | null;
    setInput: React.Dispatch<React.SetStateAction<InputState>>;
    setUi: React.Dispatch<React.SetStateAction<UIState>>;
    setSession: React.Dispatch<React.SetStateAction<SessionState>>;
    setMessages: React.Dispatch<React.SetStateAction<Message[]>>;
    agent: DextoAgent;
    inputService: InputService;
    /** Optional keyboard scroll handler (for alternate buffer mode) */
    onKeyboardScroll?: (direction: 'up' | 'down') => void;
}

/**
 * Smart container for input area
 * Manages submission, history, and overlay triggers
 */
export function InputContainer({
    buffer,
    input,
    ui,
    session,
    approval,
    setInput,
    setUi,
    setSession,
    setMessages,
    agent,
    inputService,
    onKeyboardScroll,
}: InputContainerProps) {
    // Track pending session creation to prevent race conditions
    const sessionCreationPromiseRef = useRef<Promise<SessionCreationResult> | null>(null);

    // Clear the session creation ref when session is cleared
    useEffect(() => {
        if (session.id === null) {
            sessionCreationPromiseRef.current = null;
        }
    }, [session.id]);

    // Handle history navigation - set text directly on buffer
    const handleHistoryNavigate = useCallback(
        (direction: 'up' | 'down') => {
            const { history, historyIndex } = input;
            if (history.length === 0) return;

            let newIndex = historyIndex;
            if (direction === 'up') {
                if (newIndex < 0) {
                    newIndex = history.length - 1;
                } else if (newIndex > 0) {
                    newIndex = newIndex - 1;
                }
            } else {
                if (newIndex >= 0 && newIndex < history.length - 1) {
                    newIndex = newIndex + 1;
                } else if (newIndex === history.length - 1) {
                    // At end of history, clear input
                    buffer.setText('');
                    setInput((prev) => ({ ...prev, value: '', historyIndex: -1 }));
                    return;
                }
                if (newIndex < 0) return;
            }

            const historyItem = history[newIndex] || '';
            buffer.setText(historyItem);
            setInput((prev) => ({ ...prev, value: historyItem, historyIndex: newIndex }));
        },
        [buffer, input, setInput]
    );

    // Handle overlay triggers
    const handleTriggerOverlay = useCallback(
        (trigger: OverlayTrigger) => {
            if (ui.isProcessing || approval) return;

            if (trigger === 'close') {
                if (
                    ui.activeOverlay === 'slash-autocomplete' ||
                    ui.activeOverlay === 'resource-autocomplete'
                ) {
                    setUi((prev) => ({
                        ...prev,
                        activeOverlay: 'none',
                        mcpWizardServerType: null,
                    }));
                }
            } else if (trigger === 'slash-autocomplete') {
                setUi((prev) => ({ ...prev, activeOverlay: 'slash-autocomplete' }));
            } else if (trigger === 'resource-autocomplete') {
                setUi((prev) => ({ ...prev, activeOverlay: 'resource-autocomplete' }));
            }
        },
        [setUi, ui.isProcessing, ui.activeOverlay, approval]
    );

    // Handle submission
    const handleSubmit = useCallback(
        async (value: string) => {
            const trimmed = value.trim();
            if (!trimmed || ui.isProcessing) return;

            // Prevent double submission when autocomplete/selector is active
            if (ui.activeOverlay !== 'none' && ui.activeOverlay !== 'approval') {
                return;
            }

            // Create user message and add it to messages
            const userMessage = createUserMessage(trimmed);
            setMessages((prev) => [...prev, userMessage]);

            // Clear input directly on buffer and update history
            buffer.setText('');
            setInput((prev) => {
                const newHistory =
                    prev.history.length > 0 && prev.history[prev.history.length - 1] === trimmed
                        ? prev.history
                        : [...prev.history, trimmed].slice(-100);
                return { value: '', history: newHistory, historyIndex: -1 };
            });

            // Start processing
            setUi((prev) => ({
                ...prev,
                isProcessing: true,
                isCancelling: false,
                activeOverlay: 'none',
                exitWarningShown: false,
                exitWarningTimestamp: null,
            }));

            // Parse and handle command or prompt
            const parsed = inputService.parseInput(trimmed);

            // Check if this is a command that should show an interactive selector
            if (parsed.type === 'command' && parsed.command) {
                const command = parsed.command;
                const hasArgs = parsed.args && parsed.args.length > 0;

                if (command === 'mcp' && !hasArgs) {
                    setUi((prev) => ({
                        ...prev,
                        isProcessing: false,
                        activeOverlay: 'mcp-selector',
                    }));
                    return;
                }

                if (command === 'mcp' && parsed.args?.[0] === 'add' && parsed.args.length === 1) {
                    setUi((prev) => ({
                        ...prev,
                        isProcessing: false,
                        activeOverlay: 'mcp-add-selector',
                    }));
                    return;
                }

                if (
                    command === 'mcp' &&
                    parsed.args?.[0] === 'remove' &&
                    parsed.args.length === 1
                ) {
                    setUi((prev) => ({
                        ...prev,
                        isProcessing: false,
                        activeOverlay: 'mcp-remove-selector',
                    }));
                    return;
                }

                if (command === 'log' && !hasArgs) {
                    setUi((prev) => ({
                        ...prev,
                        isProcessing: false,
                        activeOverlay: 'log-level-selector',
                    }));
                    return;
                }

                if (command === 'session' && !hasArgs) {
                    setUi((prev) => ({
                        ...prev,
                        isProcessing: false,
                        activeOverlay: 'session-subcommand-selector',
                    }));
                    return;
                }
            }

            if (parsed.type === 'command' && parsed.command) {
                const { CommandService } = await import('../services/CommandService.js');
                const commandService = new CommandService();

                try {
                    const result = await commandService.executeCommand(
                        parsed.command,
                        parsed.args || [],
                        agent,
                        session.id || undefined
                    );

                    if (result.type === 'prompt') {
                        return;
                    }

                    if (result.type === 'output' && result.output) {
                        const output = result.output;
                        setMessages((prev) => [
                            ...prev,
                            {
                                id: generateMessageId('command'),
                                role: 'system',
                                content: output,
                                timestamp: new Date(),
                            },
                        ]);
                    }

                    if (result.type === 'styled' && result.styled) {
                        const { fallbackText, styledType, styledData } = result.styled;
                        setMessages((prev) => [
                            ...prev,
                            {
                                id: generateMessageId('command'),
                                role: 'system',
                                content: fallbackText,
                                timestamp: new Date(),
                                styledType,
                                styledData,
                            },
                        ]);
                    }

                    setUi((prev) => ({
                        ...prev,
                        isProcessing: false,
                        isCancelling: false,
                        isThinking: false,
                    }));
                } catch (error) {
                    setMessages((prev) => [
                        ...prev,
                        {
                            id: generateMessageId('error'),
                            role: 'system',
                            content: `❌ Error: ${error instanceof Error ? error.message : String(error)}`,
                            timestamp: new Date(),
                        },
                    ]);
                    setUi((prev) => ({
                        ...prev,
                        isProcessing: false,
                        isCancelling: false,
                        isThinking: false,
                    }));
                }
            } else {
                try {
                    let currentSessionId = session.id;

                    if (!currentSessionId) {
                        if (sessionCreationPromiseRef.current) {
                            try {
                                const existingSession = await sessionCreationPromiseRef.current;
                                currentSessionId = existingSession.id;
                            } catch {
                                sessionCreationPromiseRef.current = null;
                            }
                        }

                        if (!currentSessionId) {
                            const sessionPromise = agent.createSession();
                            sessionCreationPromiseRef.current = sessionPromise;

                            const newSession = await sessionPromise;
                            currentSessionId = newSession.id;
                            setSession((prev) => ({
                                ...prev,
                                id: currentSessionId,
                                hasActiveSession: true,
                            }));
                        }
                    }

                    if (!currentSessionId) {
                        throw new Error('Failed to create or retrieve session');
                    }

                    const metadata = await agent.getSessionMetadata(currentSessionId);
                    const isFirstMessage = !metadata || metadata.messageCount <= 0;

                    await agent.generate(trimmed, { sessionId: currentSessionId });

                    if (isFirstMessage) {
                        agent.generateSessionTitle(currentSessionId).catch((error) => {
                            console.error('Failed to generate session title:', error);
                        });
                    }
                } catch (error) {
                    setMessages((prev) => [
                        ...prev,
                        {
                            id: generateMessageId('error'),
                            role: 'system',
                            content: `❌ Error: ${error instanceof Error ? error.message : String(error)}`,
                            timestamp: new Date(),
                        },
                    ]);
                    setUi((prev) => ({
                        ...prev,
                        isProcessing: false,
                        isCancelling: false,
                        isThinking: false,
                    }));
                }
            }
        },
        [
            buffer,
            setInput,
            setUi,
            setMessages,
            setSession,
            agent,
            inputService,
            ui.isProcessing,
            ui.activeOverlay,
            session.id,
        ]
    );

    // Determine if input should be active (not blocked by approval/overlay)
    const isInputActive = !approval && ui.activeOverlay === 'none';
    const isInputDisabled = !!approval;
    const shouldHandleSubmit = ui.activeOverlay === 'none' || ui.activeOverlay === 'approval';
    const canNavigateHistory = !ui.isProcessing && !approval && ui.activeOverlay === 'none';

    const placeholder = approval
        ? 'Approval required above...'
        : 'Type your message or /help for commands';

    return (
        <InputArea
            buffer={buffer}
            onSubmit={shouldHandleSubmit ? handleSubmit : () => {}}
            isDisabled={isInputDisabled}
            isActive={isInputActive}
            placeholder={placeholder}
            onHistoryNavigate={canNavigateHistory ? handleHistoryNavigate : undefined}
            onTriggerOverlay={handleTriggerOverlay}
            onKeyboardScroll={onKeyboardScroll}
        />
    );
}

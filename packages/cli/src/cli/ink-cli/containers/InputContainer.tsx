/**
 * InputContainer Component
 * Smart container for input area - handles submission and state
 */

import React, { useCallback, useRef, forwardRef, useImperativeHandle, useEffect } from 'react';
import type { DextoAgent } from '@dexto/core';
import type { Key } from '../hooks/useInputOrchestrator.js';
import {
    InputArea,
    type InputAreaHandle,
    type OverlayTrigger,
} from '../components/input/InputArea.js';
import { InputService } from '../services/InputService.js';
import type { OverlayType, McpWizardServerType, Message } from '../state/types.js';
import { createUserMessage } from '../utils/messageFormatting.js';
import { generateMessageId } from '../utils/idGenerator.js';
import type { ApprovalRequest } from '../components/ApprovalPrompt.js';

/** Type for pending session creation promise */
type SessionCreationResult = { id: string };

export type InputContainerHandle = InputAreaHandle;

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

/** Input state shape */
interface InputState {
    value: string;
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
}

/**
 * Smart container for input area
 * Manages input state and handles submission
 */
export const InputContainer = forwardRef<InputContainerHandle, InputContainerProps>(
    function InputContainer(
        {
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
        },
        ref
    ) {
        // Ref to the InputArea component for delegating handleInput
        const inputAreaRef = useRef<InputAreaHandle>(null);

        // Track pending session creation to prevent race conditions
        // when multiple messages are sent before first session is created
        const sessionCreationPromiseRef = useRef<Promise<SessionCreationResult> | null>(null);

        // Clear the session creation ref when session is cleared (e.g., via /clear)
        // This ensures we create a NEW session instead of reusing the old one
        useEffect(() => {
            if (session.id === null) {
                sessionCreationPromiseRef.current = null;
            }
        }, [session.id]);

        // Expose handleInput method via ref - delegates to InputArea
        useImperativeHandle(
            ref,
            () => ({
                handleInput: (inputStr: string, key: Key): boolean => {
                    return inputAreaRef.current?.handleInput(inputStr, key) ?? false;
                },
            }),
            []
        );

        // Handle input change
        const handleChange = useCallback(
            (value: string) => {
                setInput((prev) => ({ ...prev, value }));
                // Clear exit warning when user starts typing
                if (ui.exitWarningShown) {
                    setUi((prev) => ({
                        ...prev,
                        exitWarningShown: false,
                        exitWarningTimestamp: null,
                    }));
                }
            },
            [setInput, setUi, ui.exitWarningShown]
        );

        // Handle history navigation
        const handleHistoryNavigate = useCallback(
            (direction: 'up' | 'down') => {
                setInput((prev) => {
                    const { history, historyIndex } = prev;
                    if (history.length === 0) return prev;

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
                            return { ...prev, value: '', historyIndex: -1 };
                        }
                        if (newIndex < 0) return prev;
                    }

                    const historyItem = history[newIndex];
                    return { ...prev, value: historyItem || '', historyIndex: newIndex };
                });
            },
            [setInput]
        );

        // Handle overlay triggers from input (event-driven overlay detection)
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

                // Update input state: clear input, add to history
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

                    // /mcp with no args -> show mcp selector
                    if (command === 'mcp' && !hasArgs) {
                        setUi((prev) => ({
                            ...prev,
                            isProcessing: false,
                            activeOverlay: 'mcp-selector',
                        }));
                        return;
                    }

                    // /mcp add with no further args -> show mcp-add selector
                    if (
                        command === 'mcp' &&
                        parsed.args?.[0] === 'add' &&
                        parsed.args.length === 1
                    ) {
                        setUi((prev) => ({
                            ...prev,
                            isProcessing: false,
                            activeOverlay: 'mcp-add-selector',
                        }));
                        return;
                    }

                    // /mcp remove with no further args -> show mcp-remove selector
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

                    // /log with no args -> show log level selector
                    if (command === 'log' && !hasArgs) {
                        setUi((prev) => ({
                            ...prev,
                            isProcessing: false,
                            activeOverlay: 'log-level-selector',
                        }));
                        return;
                    }

                    // /session with no args -> show session subcommand selector
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
                    // Import command service dynamically to avoid circular deps
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
                            // Command executed a prompt via agent.generate()
                            // Processing will continue via event bus
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
                    // Regular prompt - pass to AI with explicit sessionId
                    try {
                        let currentSessionId = session.id;

                        // Create session on first message if not already created (deferred creation)
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

                        // Check if this is the first message
                        const metadata = await agent.getSessionMetadata(currentSessionId);
                        const isFirstMessage = !metadata || metadata.messageCount <= 0;

                        await agent.generate(trimmed, { sessionId: currentSessionId });

                        // Generate title for new sessions after first message
                        if (isFirstMessage) {
                            agent.generateSessionTitle(currentSessionId).catch((error) => {
                                console.error('Failed to generate session title:', error);
                            });
                        }

                        // Response will come via event bus
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

        // Determine placeholder
        const placeholder = approval
            ? 'Approval required above...'
            : 'Type your message or /help for commands';

        // Don't wire up onSubmit when autocomplete/selector is active
        const shouldHandleSubmit = ui.activeOverlay === 'none' || ui.activeOverlay === 'approval';

        // Only enable history navigation when not processing and no overlay
        const canNavigateHistory = !ui.isProcessing && !approval && ui.activeOverlay === 'none';

        // Disable input only for approval states
        const isInputDisabled = !!approval;

        return (
            <InputArea
                ref={inputAreaRef}
                value={input.value}
                onChange={handleChange}
                onSubmit={shouldHandleSubmit ? handleSubmit : () => {}}
                isProcessing={ui.isProcessing}
                isDisabled={isInputDisabled}
                placeholder={placeholder}
                history={input.history}
                historyIndex={input.historyIndex}
                onHistoryNavigate={canNavigateHistory ? handleHistoryNavigate : undefined}
                onTriggerOverlay={handleTriggerOverlay}
            />
        );
    }
);

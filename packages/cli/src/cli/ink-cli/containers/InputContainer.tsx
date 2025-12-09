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
import type { CLIAction } from '../state/actions.js';
import type { CLIState } from '../state/types.js';
import { createUserMessage } from '../utils/messageFormatting.js';
import { generateMessageId } from '../utils/idGenerator.js';

/** Type for pending session creation promise */
type SessionCreationResult = { id: string };

export type InputContainerHandle = InputAreaHandle;

interface InputContainerProps {
    state: CLIState;
    dispatch: React.Dispatch<CLIAction>;
    agent: DextoAgent;
    inputService: InputService;
}

/**
 * Smart container for input area
 * Manages input state and handles submission
 */
export const InputContainer = forwardRef<InputContainerHandle, InputContainerProps>(
    function InputContainer({ state, dispatch, agent, inputService }, ref) {
        const { input, ui, approval, session } = state;

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
                dispatch({ type: 'INPUT_CHANGE', value });
            },
            [dispatch]
        );

        // Handle history navigation
        const handleHistoryNavigate = useCallback(
            (direction: 'up' | 'down') => {
                dispatch({ type: 'INPUT_HISTORY_NAVIGATE', direction });
            },
            [dispatch]
        );

        // Handle overlay triggers from input (event-driven overlay detection)
        // This is called immediately when trigger characters are typed/removed
        // Replaces the problematic useEffect that watched state.input.value
        const handleTriggerOverlay = useCallback(
            (trigger: OverlayTrigger) => {
                // Don't trigger overlays during processing or approval
                if (ui.isProcessing || approval) return;

                if (trigger === 'close') {
                    // Only close autocomplete overlays (not enter-triggered ones like selectors)
                    if (
                        ui.activeOverlay === 'slash-autocomplete' ||
                        ui.activeOverlay === 'resource-autocomplete'
                    ) {
                        dispatch({ type: 'CLOSE_OVERLAY' });
                    }
                } else if (trigger === 'slash-autocomplete') {
                    dispatch({ type: 'SHOW_OVERLAY', overlay: 'slash-autocomplete' });
                } else if (trigger === 'resource-autocomplete') {
                    dispatch({ type: 'SHOW_OVERLAY', overlay: 'resource-autocomplete' });
                }
            },
            [dispatch, ui.isProcessing, ui.activeOverlay, approval]
        );

        // Handle submission
        const handleSubmit = useCallback(
            async (value: string) => {
                const trimmed = value.trim();
                if (!trimmed || ui.isProcessing) return;

                // Prevent double submission when autocomplete/selector is active
                // The autocomplete/selector will handle the submission
                if (ui.activeOverlay !== 'none' && ui.activeOverlay !== 'approval') {
                    return;
                }

                // Create user message
                const userMessage = createUserMessage(trimmed);

                // Dispatch submit start (clears input, adds to history, adds user message)
                dispatch({
                    type: 'SUBMIT_START',
                    userMessage,
                    inputValue: trimmed,
                });

                // Parse and handle command or prompt
                const parsed = inputService.parseInput(trimmed);

                // Check if this is a command that should show an interactive selector
                // These selectors are triggered on Enter, not auto-detected while typing
                if (parsed.type === 'command' && parsed.command) {
                    const command = parsed.command;
                    const hasArgs = parsed.args && parsed.args.length > 0;

                    // /mcp with no args -> show mcp selector
                    if (command === 'mcp' && !hasArgs) {
                        dispatch({ type: 'SUBMIT_COMPLETE' });
                        dispatch({ type: 'SHOW_OVERLAY', overlay: 'mcp-selector' });
                        return;
                    }

                    // /mcp add with no further args -> show mcp-add selector (presets)
                    if (
                        command === 'mcp' &&
                        parsed.args?.[0] === 'add' &&
                        parsed.args.length === 1
                    ) {
                        dispatch({ type: 'SUBMIT_COMPLETE' });
                        dispatch({ type: 'SHOW_OVERLAY', overlay: 'mcp-add-selector' });
                        return;
                    }

                    // /mcp remove with no further args -> show mcp-remove selector
                    if (
                        command === 'mcp' &&
                        parsed.args?.[0] === 'remove' &&
                        parsed.args.length === 1
                    ) {
                        dispatch({ type: 'SUBMIT_COMPLETE' });
                        dispatch({ type: 'SHOW_OVERLAY', overlay: 'mcp-remove-selector' });
                        return;
                    }

                    // /log with no args -> show log level selector
                    if (command === 'log' && !hasArgs) {
                        dispatch({ type: 'SUBMIT_COMPLETE' });
                        dispatch({ type: 'SHOW_OVERLAY', overlay: 'log-level-selector' });
                        return;
                    }

                    // /session with no args -> show session subcommand selector
                    if (command === 'session' && !hasArgs) {
                        dispatch({ type: 'SUBMIT_COMPLETE' });
                        dispatch({ type: 'SHOW_OVERLAY', overlay: 'session-subcommand-selector' });
                        return;
                    }
                }

                if (parsed.type === 'command' && parsed.command) {
                    // Import command service dynamically to avoid circular deps
                    const { CommandService } = await import('../services/CommandService.js');
                    const commandService = new CommandService();

                    try {
                        // Pass sessionId from state to command execution
                        const currentSessionId = session.id;
                        const result = await commandService.executeCommand(
                            parsed.command,
                            parsed.args || [],
                            agent,
                            currentSessionId || undefined
                        );

                        if (result.type === 'prompt') {
                            // Command executed a prompt via agent.run()
                            // Processing will continue via event bus
                            // Don't set SUBMIT_COMPLETE here - wait for agent response
                            return;
                        }

                        if (result.type === 'output' && result.output) {
                            // Command returned output for display
                            dispatch({
                                type: 'MESSAGE_ADD',
                                message: {
                                    id: generateMessageId('command'),
                                    role: 'system',
                                    content: result.output,
                                    timestamp: new Date(),
                                },
                            });
                        }

                        if (result.type === 'styled' && result.styled) {
                            // Command returned styled output
                            dispatch({
                                type: 'MESSAGE_ADD',
                                message: {
                                    id: generateMessageId('command'),
                                    role: 'system',
                                    content: result.styled.fallbackText,
                                    timestamp: new Date(),
                                    styledType: result.styled.styledType,
                                    styledData: result.styled.styledData,
                                },
                            });
                        }

                        // Always complete for non-prompt commands
                        dispatch({ type: 'SUBMIT_COMPLETE' });
                    } catch (error) {
                        dispatch({
                            type: 'SUBMIT_ERROR',
                            errorMessage: error instanceof Error ? error.message : String(error),
                        });
                    }
                } else {
                    // Regular prompt - pass to AI with explicit sessionId
                    try {
                        const streamingId = generateMessageId('assistant');
                        dispatch({ type: 'STREAMING_START', id: streamingId });

                        // Pass sessionId explicitly to agent.run() like WebUI does
                        // Use sessionId from state (never from getCurrentSessionId)
                        let currentSessionId = session.id;

                        // Create session on first message if not already created (deferred creation)
                        // Use ref to prevent race condition when multiple messages sent rapidly
                        if (!currentSessionId) {
                            // Check if session creation is already in progress
                            if (sessionCreationPromiseRef.current) {
                                // Wait for existing session creation to complete
                                try {
                                    const existingSession = await sessionCreationPromiseRef.current;
                                    currentSessionId = existingSession.id;
                                } catch {
                                    // If the existing session creation failed, we'll try again below
                                    sessionCreationPromiseRef.current = null;
                                }
                            }

                            // Double-check: might have been set by another message while we waited
                            if (!currentSessionId) {
                                // Start new session creation and store promise in ref
                                // Don't clear the ref until session is in state to prevent race conditions
                                const sessionPromise = agent.createSession();
                                sessionCreationPromiseRef.current = sessionPromise;

                                const newSession = await sessionPromise;
                                currentSessionId = newSession.id;
                                dispatch({
                                    type: 'SESSION_SET',
                                    sessionId: currentSessionId,
                                    hasActiveSession: true,
                                });
                                // Note: We intentionally don't clear the ref here
                                // It will be naturally superseded by the state having a session ID
                            }
                        }

                        // At this point currentSessionId must be defined (either from state or created above)
                        if (!currentSessionId) {
                            throw new Error('Failed to create or retrieve session');
                        }

                        // Check if this is the first message (message count is 0 or 1)
                        const metadata = await agent.getSessionMetadata(currentSessionId);
                        const isFirstMessage = !metadata || metadata.messageCount <= 0;

                        await agent.run(trimmed, undefined, undefined, currentSessionId);

                        // Generate title for new sessions after first message
                        // Fire and forget to avoid blocking the response
                        if (isFirstMessage) {
                            agent.generateSessionTitle(currentSessionId).catch((error) => {
                                // Log but don't fail - title generation is optional
                                console.error('Failed to generate session title:', error);
                            });
                        }

                        // Response will come via event bus
                        // SUBMIT_COMPLETE will be dispatched by event handler
                    } catch (error) {
                        dispatch({
                            type: 'SUBMIT_ERROR',
                            errorMessage: error instanceof Error ? error.message : String(error),
                        });
                    }
                }
            },
            [dispatch, agent, inputService, ui.isProcessing, ui.activeOverlay, session]
        );

        // Determine placeholder (processing state shown in StatusBar above)
        const placeholder = approval
            ? 'Approval required above...'
            : 'Type your message or /help for commands';

        // Don't wire up onSubmit when autocomplete/selector is active (they handle Enter)
        const shouldHandleSubmit = ui.activeOverlay === 'none' || ui.activeOverlay === 'approval';

        // Only enable history navigation when not processing and no overlay
        const canNavigateHistory = !ui.isProcessing && !approval && ui.activeOverlay === 'none';

        // Disable input only for approval states
        // Allow typing during processing, but handleSubmit will prevent submission
        // Note: We no longer disable for overlays because:
        // 1. We use a unified orchestrator (no useInput conflicts)
        // 2. Overlay handlers return false for unhandled keys, allowing fall-through
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

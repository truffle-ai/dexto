/**
 * InputContainer Component
 * Smart container for input area - handles submission and state
 */

import React, { useCallback } from 'react';
import type { DextoAgent } from '@dexto/core';
import { InputArea } from '../components/input/InputArea.js';
import { InputService } from '../services/InputService.js';
import type { CLIAction } from '../state/actions.js';
import type { CLIState } from '../state/types.js';
import { createUserMessage } from '../utils/messageFormatting.js';

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
export function InputContainer({ state, dispatch, agent, inputService }: InputContainerProps) {
    const { input, ui, approval } = state;

    // Handle input change
    const handleChange = useCallback(
        (value: string) => {
            dispatch({ type: 'INPUT_CHANGE', value });
        },
        [dispatch]
    );

    // Handle word delete
    const handleWordDelete = useCallback(() => {
        const newValue = inputService.deleteWordBackward(input.value);
        dispatch({ type: 'INPUT_CHANGE', value: newValue });
    }, [dispatch, inputService, input.value]);

    // Handle line delete
    const handleLineDelete = useCallback(() => {
        const newValue = inputService.deleteLine(input.value);
        dispatch({ type: 'INPUT_CHANGE', value: newValue });
    }, [dispatch, inputService, input.value]);

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

            if (parsed.type === 'command' && parsed.command) {
                // Import command service dynamically to avoid circular deps
                const { CommandService } = await import('../services/CommandService.js');
                const commandService = new CommandService();

                try {
                    const result = await commandService.executeCommand(
                        parsed.command,
                        parsed.args || [],
                        agent
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
                                id: `command-${Date.now()}`,
                                role: 'system',
                                content: result.output,
                                timestamp: new Date(),
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
                // Regular prompt - pass to AI
                try {
                    const streamingId = `assistant-${Date.now()}`;
                    dispatch({ type: 'STREAMING_START', id: streamingId });

                    await agent.run(trimmed);

                    // Session should now exist
                    const sessionId = agent.getCurrentSessionId();
                    dispatch({
                        type: 'SESSION_SET',
                        sessionId,
                        hasActiveSession: true,
                    });
                } catch (error) {
                    dispatch({
                        type: 'SUBMIT_ERROR',
                        errorMessage: error instanceof Error ? error.message : String(error),
                    });
                }
            }
        },
        [dispatch, agent, inputService, ui.isProcessing]
    );

    // Determine placeholder
    const placeholder = approval
        ? 'Approval required above...'
        : ui.isProcessing
          ? 'Processing... (Press Esc to cancel)'
          : 'Type your message or /help for commands';

    return (
        <InputArea
            value={input.value}
            onChange={handleChange}
            onSubmit={handleSubmit}
            isProcessing={ui.isProcessing}
            isDisabled={ui.isProcessing || !!approval}
            placeholder={placeholder}
            onWordDelete={handleWordDelete}
            onLineDelete={handleLineDelete}
            remountKey={input.remountKey}
        />
    );
}

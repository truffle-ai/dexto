/**
 * OverlayContainer Component
 * Smart container for managing all overlays (selectors, autocomplete, approval)
 */

import React, { useCallback, useRef, useImperativeHandle, forwardRef } from 'react';
import { Box } from 'ink';
import type { Key } from 'ink';
import type { DextoAgent } from '@dexto/core';
import { ApprovalStatus, DenialReason } from '@dexto/core';
import type { CLIAction } from '../state/actions.js';
import type { CLIState } from '../state/types.js';
import { ApprovalPrompt, type ApprovalPromptHandle } from '../components/ApprovalPrompt.js';
import {
    SlashCommandAutocomplete,
    type SlashCommandAutocompleteHandle,
} from '../components/SlashCommandAutocomplete.js';
import ResourceAutocomplete, {
    type ResourceAutocompleteHandle,
} from '../components/ResourceAutocomplete.js';
import ModelSelectorRefactored, {
    type ModelSelectorHandle,
} from '../components/overlays/ModelSelectorRefactored.js';
import SessionSelectorRefactored, {
    type SessionSelectorHandle,
} from '../components/overlays/SessionSelectorRefactored.js';
import type { PromptInfo, ResourceMetadata } from '@dexto/core';
import { InputService } from '../services/InputService.js';
import { createUserMessage, convertHistoryToUIMessages } from '../utils/messageFormatting.js';
import { generateMessageId } from '../utils/idGenerator.js';

export interface OverlayContainerHandle {
    handleInput: (input: string, key: Key) => boolean;
}

interface OverlayContainerProps {
    state: CLIState;
    dispatch: React.Dispatch<CLIAction>;
    agent: DextoAgent;
    inputService: InputService;
}

/**
 * Smart container for managing overlays
 * Handles all modal interactions (selectors, autocomplete, approval)
 */
export const OverlayContainer = forwardRef<OverlayContainerHandle, OverlayContainerProps>(
    function OverlayContainer({ state, dispatch, agent, inputService }, ref) {
        const { ui, input, approval } = state;
        const eventBus = agent.agentEventBus;

        console.log(
            '[OverlayContainer] Render - approval:',
            approval,
            'activeOverlay:',
            ui.activeOverlay
        );

        // Refs to overlay components for input handling
        const approvalRef = useRef<ApprovalPromptHandle>(null);
        const slashAutocompleteRef = useRef<SlashCommandAutocompleteHandle>(null);
        const resourceAutocompleteRef = useRef<ResourceAutocompleteHandle>(null);
        const modelSelectorRef = useRef<ModelSelectorHandle>(null);
        const sessionSelectorRef = useRef<SessionSelectorHandle>(null);

        // Expose handleInput method via ref - routes to appropriate overlay
        useImperativeHandle(
            ref,
            () => ({
                handleInput: (inputStr: string, key: Key): boolean => {
                    // Route to active overlay
                    if (approval && approvalRef.current) {
                        return approvalRef.current.handleInput(inputStr, key);
                    }

                    if (ui.activeOverlay === 'slash-autocomplete' && slashAutocompleteRef.current) {
                        return slashAutocompleteRef.current.handleInput(inputStr, key);
                    }

                    if (
                        ui.activeOverlay === 'resource-autocomplete' &&
                        resourceAutocompleteRef.current
                    ) {
                        return resourceAutocompleteRef.current.handleInput(inputStr, key);
                    }

                    if (ui.activeOverlay === 'model-selector' && modelSelectorRef.current) {
                        return modelSelectorRef.current.handleInput(inputStr, key);
                    }

                    if (ui.activeOverlay === 'session-selector' && sessionSelectorRef.current) {
                        return sessionSelectorRef.current.handleInput(inputStr, key);
                    }

                    // Return false to indicate input was not consumed
                    return false;
                },
            }),
            [approval, ui.activeOverlay]
        );

        // NOTE: Automatic overlay detection removed to prevent infinite loop
        // Overlays are now shown explicitly via SHOW_OVERLAY actions from InputContainer
        // or from the main component's input detection logic

        // Handle approval responses
        const handleApprove = useCallback(
            (rememberChoice: boolean) => {
                if (!approval || !eventBus) return;

                eventBus.emit('approval:response', {
                    approvalId: approval.approvalId,
                    status: ApprovalStatus.APPROVED,
                    sessionId: approval.sessionId,
                    data: { rememberChoice },
                });

                dispatch({ type: 'APPROVAL_COMPLETE' });
            },
            [approval, eventBus, dispatch]
        );

        const handleDeny = useCallback(() => {
            if (!approval || !eventBus) return;

            eventBus.emit('approval:response', {
                approvalId: approval.approvalId,
                status: ApprovalStatus.DENIED,
                sessionId: approval.sessionId,
                reason: DenialReason.USER_DENIED,
                message: 'User denied the tool execution',
            });

            dispatch({ type: 'APPROVAL_COMPLETE' });
        }, [approval, eventBus, dispatch]);

        const handleCancelApproval = useCallback(() => {
            if (!approval || !eventBus) return;

            eventBus.emit('approval:response', {
                approvalId: approval.approvalId,
                status: ApprovalStatus.CANCELLED,
                sessionId: approval.sessionId,
                reason: DenialReason.USER_CANCELLED,
                message: 'User cancelled the approval request',
            });

            dispatch({ type: 'APPROVAL_COMPLETE' });
        }, [approval, eventBus, dispatch]);

        // Handle model selection
        const handleModelSelect = useCallback(
            async (provider: string, model: string) => {
                dispatch({ type: 'CLOSE_OVERLAY' });
                dispatch({ type: 'INPUT_CLEAR' });

                try {
                    dispatch({
                        type: 'MESSAGE_ADD',
                        message: {
                            id: generateMessageId('system'),
                            role: 'system',
                            content: `🔄 Switching to ${model} (${provider})...`,
                            timestamp: new Date(),
                        },
                    });

                    // Pass sessionId from state to switchLLM (WebUI pattern)
                    const currentSessionId = state.session.id;
                    await agent.switchLLM(
                        { provider: provider as any, model },
                        currentSessionId || undefined
                    );

                    dispatch({
                        type: 'MESSAGE_ADD',
                        message: {
                            id: generateMessageId('system'),
                            role: 'system',
                            content: `✅ Successfully switched to ${model} (${provider})`,
                            timestamp: new Date(),
                        },
                    });
                } catch (error) {
                    dispatch({
                        type: 'ERROR',
                        errorMessage: `Failed to switch model: ${error instanceof Error ? error.message : String(error)}`,
                    });
                }
            },
            [dispatch, agent, state.session.id]
        );

        // Handle session selection
        const handleSessionSelect = useCallback(
            async (newSessionId: string) => {
                dispatch({ type: 'CLOSE_OVERLAY' });
                dispatch({ type: 'INPUT_CLEAR' });

                try {
                    // Check if already on this session (use state, not getCurrentSessionId)
                    const currentId = state.session.id;
                    if (newSessionId === currentId) {
                        dispatch({
                            type: 'MESSAGE_ADD',
                            message: {
                                id: generateMessageId('system'),
                                role: 'system',
                                content: `ℹ️  Already using session ${newSessionId.slice(0, 8)}`,
                                timestamp: new Date(),
                            },
                        });
                        return;
                    }

                    dispatch({
                        type: 'MESSAGE_ADD',
                        message: {
                            id: generateMessageId('system'),
                            role: 'system',
                            content: `🔄 Switching to session ${newSessionId.slice(0, 8)}...`,
                            timestamp: new Date(),
                        },
                    });

                    // Verify session exists
                    const session = await agent.getSession(newSessionId);
                    if (!session) {
                        throw new Error(`Session ${newSessionId} not found`);
                    }

                    // Clear messages and update sessionId (WebUI pattern - no loadSessionAsDefault)
                    dispatch({ type: 'SESSION_CLEAR' }); // Clears messages

                    dispatch({
                        type: 'SESSION_SET',
                        sessionId: newSessionId,
                        hasActiveSession: true,
                    });

                    // Load session history
                    const history = await agent.getSessionHistory(newSessionId);
                    if (history && history.length > 0) {
                        const historyMessages = convertHistoryToUIMessages(history, newSessionId);
                        dispatch({ type: 'MESSAGE_ADD_MULTIPLE', messages: historyMessages });
                    }

                    dispatch({
                        type: 'MESSAGE_ADD',
                        message: {
                            id: generateMessageId('system'),
                            role: 'system',
                            content: `✅ Switched to session ${newSessionId.slice(0, 8)}`,
                            timestamp: new Date(),
                        },
                    });
                } catch (error) {
                    dispatch({
                        type: 'ERROR',
                        errorMessage: `Failed to switch session: ${error instanceof Error ? error.message : String(error)}`,
                    });
                }
            },
            [dispatch, agent, state.session.id]
        );

        // Handle slash command/prompt selection
        const handlePromptSelect = useCallback(
            async (prompt: PromptInfo) => {
                const commandText = `/${prompt.name}`;
                dispatch({ type: 'CLOSE_OVERLAY' });
                dispatch({ type: 'INPUT_CLEAR' });

                // Show user message for the executed command
                const userMessage = createUserMessage(commandText);
                dispatch({
                    type: 'MESSAGE_ADD',
                    message: userMessage,
                });

                dispatch({ type: 'PROCESSING_START' });

                const { CommandService } = await import('../services/CommandService.js');
                const commandService = new CommandService();

                try {
                    // Pass sessionId from state to command execution
                    const currentSessionId = state.session.id;
                    const result = await commandService.executeCommand(
                        prompt.name,
                        [],
                        agent,
                        currentSessionId || undefined
                    );

                    if (result.type === 'prompt') {
                        // Prompt execution continues via event bus
                        return;
                    }

                    if (result.type === 'output' && result.output) {
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

                    dispatch({ type: 'PROCESSING_END' });
                } catch (error) {
                    dispatch({
                        type: 'ERROR',
                        errorMessage: error instanceof Error ? error.message : String(error),
                    });
                }
            },
            [dispatch, agent, state.session.id]
        );

        // Handle loading command/prompt into input for editing (Tab key)

        const handleSystemCommandSelect = useCallback(
            async (command: string) => {
                const commandText = `/${command}`;
                dispatch({ type: 'CLOSE_OVERLAY' });
                dispatch({ type: 'INPUT_CLEAR' });

                // Show user message for the executed command
                const userMessage = createUserMessage(commandText);
                dispatch({
                    type: 'MESSAGE_ADD',
                    message: userMessage,
                });

                dispatch({ type: 'PROCESSING_START' });

                const { CommandService } = await import('../services/CommandService.js');
                const commandService = new CommandService();

                try {
                    // Pass sessionId from state to command execution
                    const currentSessionId = state.session.id;
                    const result = await commandService.executeCommand(
                        command,
                        [],
                        agent,
                        currentSessionId || undefined
                    );

                    if (result.type === 'prompt') {
                        // Prompt execution continues via event bus
                        return;
                    }

                    if (result.type === 'output' && result.output) {
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

                    dispatch({ type: 'PROCESSING_END' });
                } catch (error) {
                    dispatch({
                        type: 'ERROR',
                        errorMessage: error instanceof Error ? error.message : String(error),
                    });
                }
            },
            [dispatch, agent, state.session.id]
        );

        const handleLoadIntoInput = useCallback(
            (text: string) => {
                dispatch({ type: 'INPUT_CHANGE', value: text });
                dispatch({ type: 'CLOSE_OVERLAY' });
            },
            [dispatch]
        );

        // Handle resource selection
        const handleResourceSelect = useCallback(
            (resource: ResourceMetadata) => {
                // Insert resource reference into input
                const atIndex = input.value.lastIndexOf('@');
                if (atIndex >= 0) {
                    const before = input.value.slice(0, atIndex + 1);
                    const uriParts = resource.uri.split('/');
                    const reference =
                        resource.name || uriParts[uriParts.length - 1] || resource.uri;
                    dispatch({ type: 'INPUT_CHANGE', value: `${before}${reference} ` });
                }
                dispatch({ type: 'CLOSE_OVERLAY' });
            },
            [dispatch, input.value]
        );

        const handleClose = useCallback(() => {
            dispatch({ type: 'CLOSE_OVERLAY' });
        }, [dispatch]);

        return (
            <>
                {/* Approval prompt */}
                {approval && (
                    <ApprovalPrompt
                        ref={approvalRef}
                        approval={approval}
                        onApprove={handleApprove}
                        onDeny={handleDeny}
                        onCancel={handleCancelApproval}
                    />
                )}

                {/* Slash command autocomplete */}
                {ui.activeOverlay === 'slash-autocomplete' && (
                    <Box marginTop={1}>
                        <SlashCommandAutocomplete
                            ref={slashAutocompleteRef}
                            isVisible={true}
                            searchQuery={input.value}
                            onSelectPrompt={handlePromptSelect}
                            onSelectSystemCommand={handleSystemCommandSelect}
                            onLoadIntoInput={handleLoadIntoInput}
                            onClose={handleClose}
                            agent={agent}
                        />
                    </Box>
                )}

                {/* Resource autocomplete */}
                {ui.activeOverlay === 'resource-autocomplete' && (
                    <Box marginTop={1}>
                        <ResourceAutocomplete
                            ref={resourceAutocompleteRef}
                            isVisible={true}
                            searchQuery={input.value}
                            onSelectResource={handleResourceSelect}
                            onLoadIntoInput={handleLoadIntoInput}
                            onClose={handleClose}
                            agent={agent}
                        />
                    </Box>
                )}

                {/* Model selector */}
                {ui.activeOverlay === 'model-selector' && (
                    <Box marginTop={1}>
                        <ModelSelectorRefactored
                            ref={modelSelectorRef}
                            isVisible={true}
                            onSelectModel={handleModelSelect}
                            onClose={handleClose}
                            agent={agent}
                        />
                    </Box>
                )}

                {/* Session selector */}
                {ui.activeOverlay === 'session-selector' && (
                    <Box marginTop={1}>
                        <SessionSelectorRefactored
                            ref={sessionSelectorRef}
                            isVisible={true}
                            onSelectSession={handleSessionSelect}
                            onClose={handleClose}
                            agent={agent}
                            currentSessionId={state.session.id || undefined}
                        />
                    </Box>
                )}
            </>
        );
    }
);

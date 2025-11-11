/**
 * OverlayContainer Component
 * Smart container for managing all overlays (selectors, autocomplete, approval)
 */

import React, { useCallback, useEffect } from 'react';
import { Box } from 'ink';
import type { DextoAgent } from '@dexto/core';
import { ApprovalStatus, DenialReason } from '@dexto/core';
import type { CLIAction } from '../state/actions.js';
import type { CLIState } from '../state/types.js';
import { ApprovalPrompt } from '../components/ApprovalPrompt.js';
import SlashCommandAutocomplete from '../components/SlashCommandAutocomplete.js';
import ResourceAutocomplete from '../components/ResourceAutocomplete.js';
import ModelSelectorRefactored from '../components/overlays/ModelSelectorRefactored.js';
import SessionSelectorRefactored from '../components/overlays/SessionSelectorRefactored.js';
import type { PromptInfo, ResourceMetadata } from '@dexto/core';
import { InputService } from '../services/InputService.js';

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
export function OverlayContainer({ state, dispatch, agent, inputService }: OverlayContainerProps) {
    const { ui, input, approval } = state;
    const eventBus = agent.agentEventBus;

    // NOTE: Automatic overlay detection removed to prevent infinite loop
    // Overlays are now shown explicitly via SHOW_OVERLAY actions from InputContainer
    // or from the main component's input detection logic

    // Handle approval responses
    const handleApprove = useCallback(
        (rememberChoice: boolean) => {
            if (!approval || !eventBus) return;

            eventBus.emit('dexto:approvalResponse', {
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

        eventBus.emit('dexto:approvalResponse', {
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

        eventBus.emit('dexto:approvalResponse', {
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
                        id: `system-${Date.now()}`,
                        role: 'system',
                        content: `🔄 Switching to ${model} (${provider})...`,
                        timestamp: new Date(),
                    },
                });

                await agent.switchLLM({ provider: provider as any, model });

                dispatch({
                    type: 'MESSAGE_ADD',
                    message: {
                        id: `system-${Date.now()}`,
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
        [dispatch, agent]
    );

    // Handle session selection
    const handleSessionSelect = useCallback(
        async (sessionId: string) => {
            dispatch({ type: 'CLOSE_OVERLAY' });
            dispatch({ type: 'INPUT_CLEAR' });

            try {
                const currentId = agent.getCurrentSessionId();
                if (sessionId === currentId) {
                    dispatch({
                        type: 'MESSAGE_ADD',
                        message: {
                            id: `system-${Date.now()}`,
                            role: 'system',
                            content: `ℹ️  Already using session ${sessionId.slice(0, 8)}`,
                            timestamp: new Date(),
                        },
                    });
                    return;
                }

                dispatch({
                    type: 'MESSAGE_ADD',
                    message: {
                        id: `system-${Date.now()}`,
                        role: 'system',
                        content: `🔄 Switching to session ${sessionId.slice(0, 8)}...`,
                        timestamp: new Date(),
                    },
                });

                await agent.loadSessionAsDefault(sessionId);

                dispatch({
                    type: 'SESSION_SET',
                    sessionId,
                    hasActiveSession: true,
                });

                dispatch({
                    type: 'MESSAGE_ADD',
                    message: {
                        id: `system-${Date.now()}`,
                        role: 'system',
                        content: `✅ Switched to session ${sessionId.slice(0, 8)}`,
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
        [dispatch, agent]
    );

    // Handle slash command/prompt selection
    const handlePromptSelect = useCallback(
        (prompt: PromptInfo) => {
            // Execute immediately
            const commandText = `/${prompt.name}`;
            dispatch({ type: 'INPUT_CLEAR' });
            dispatch({ type: 'CLOSE_OVERLAY' });

            // Trigger submission
            setTimeout(() => {
                const userMessage = {
                    id: `user-${Date.now()}`,
                    role: 'user' as const,
                    content: commandText,
                    timestamp: new Date(),
                };
                dispatch({ type: 'SUBMIT_START', userMessage, inputValue: commandText });
            }, 0);
        },
        [dispatch]
    );

    const handleSystemCommandSelect = useCallback(
        (command: string) => {
            const commandText = `/${command}`;
            dispatch({ type: 'INPUT_CLEAR' });
            dispatch({ type: 'CLOSE_OVERLAY' });

            // Execute immediately
            setTimeout(() => {
                const userMessage = {
                    id: `user-${Date.now()}`,
                    role: 'user' as const,
                    content: commandText,
                    timestamp: new Date(),
                };
                dispatch({ type: 'SUBMIT_START', userMessage, inputValue: commandText });
            }, 0);
        },
        [dispatch]
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
                const reference = resource.name || uriParts[uriParts.length - 1] || resource.uri;
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
                        isVisible={true}
                        onSelectSession={handleSessionSelect}
                        onClose={handleClose}
                        agent={agent}
                    />
                </Box>
            )}
        </>
    );
}

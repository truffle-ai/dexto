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
import LogLevelSelector, {
    type LogLevelSelectorHandle,
} from '../components/overlays/LogLevelSelector.js';
import McpSelector, {
    type McpSelectorHandle,
    type McpAction,
} from '../components/overlays/McpSelector.js';
import McpAddSelector, {
    type McpAddSelectorHandle,
    type McpAddResult,
} from '../components/overlays/McpAddSelector.js';
import McpRemoveSelector, {
    type McpRemoveSelectorHandle,
} from '../components/overlays/McpRemoveSelector.js';
import SessionSubcommandSelector, {
    type SessionSubcommandSelectorHandle,
    type SessionAction,
} from '../components/overlays/SessionSubcommandSelector.js';
import McpCustomTypeSelector, {
    type McpCustomTypeSelectorHandle,
    type McpServerType,
} from '../components/overlays/McpCustomTypeSelector.js';
import McpCustomWizard, {
    type McpCustomWizardHandle,
    type McpCustomConfig,
} from '../components/overlays/McpCustomWizard.js';
import type { PromptInfo, ResourceMetadata } from '@dexto/core';
import { logger } from '@dexto/core';
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

        // Refs to overlay components for input handling
        const approvalRef = useRef<ApprovalPromptHandle>(null);
        const slashAutocompleteRef = useRef<SlashCommandAutocompleteHandle>(null);
        const resourceAutocompleteRef = useRef<ResourceAutocompleteHandle>(null);
        const modelSelectorRef = useRef<ModelSelectorHandle>(null);
        const sessionSelectorRef = useRef<SessionSelectorHandle>(null);
        const logLevelSelectorRef = useRef<LogLevelSelectorHandle>(null);
        const mcpSelectorRef = useRef<McpSelectorHandle>(null);
        const mcpAddSelectorRef = useRef<McpAddSelectorHandle>(null);
        const mcpRemoveSelectorRef = useRef<McpRemoveSelectorHandle>(null);
        const mcpCustomTypeSelectorRef = useRef<McpCustomTypeSelectorHandle>(null);
        const mcpCustomWizardRef = useRef<McpCustomWizardHandle>(null);
        const sessionSubcommandSelectorRef = useRef<SessionSubcommandSelectorHandle>(null);

        // Expose handleInput method via ref - routes to appropriate overlay
        useImperativeHandle(
            ref,
            () => ({
                handleInput: (inputStr: string, key: Key): boolean => {
                    // Route to approval first (highest priority)
                    if (approval && approvalRef.current) {
                        return approvalRef.current.handleInput(inputStr, key);
                    }

                    // Route to active overlay based on type
                    switch (ui.activeOverlay) {
                        case 'slash-autocomplete':
                            return (
                                slashAutocompleteRef.current?.handleInput(inputStr, key) ?? false
                            );
                        case 'resource-autocomplete':
                            return (
                                resourceAutocompleteRef.current?.handleInput(inputStr, key) ?? false
                            );
                        case 'model-selector':
                            return modelSelectorRef.current?.handleInput(inputStr, key) ?? false;
                        case 'session-selector':
                            return sessionSelectorRef.current?.handleInput(inputStr, key) ?? false;
                        case 'log-level-selector':
                            return logLevelSelectorRef.current?.handleInput(inputStr, key) ?? false;
                        case 'mcp-selector':
                            return mcpSelectorRef.current?.handleInput(inputStr, key) ?? false;
                        case 'mcp-add-selector':
                            return mcpAddSelectorRef.current?.handleInput(inputStr, key) ?? false;
                        case 'mcp-remove-selector':
                            return (
                                mcpRemoveSelectorRef.current?.handleInput(inputStr, key) ?? false
                            );
                        case 'mcp-custom-type-selector':
                            return (
                                mcpCustomTypeSelectorRef.current?.handleInput(inputStr, key) ??
                                false
                            );
                        case 'mcp-custom-wizard':
                            return mcpCustomWizardRef.current?.handleInput(inputStr, key) ?? false;
                        case 'session-subcommand-selector':
                            return (
                                sessionSubcommandSelectorRef.current?.handleInput(inputStr, key) ??
                                false
                            );
                        default:
                            return false;
                    }
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

                    // Clear messages immediately before any async operations
                    // This ensures old conversation is cleared before showing new session
                    dispatch({ type: 'SESSION_CLEAR' });

                    dispatch({
                        type: 'SESSION_SET',
                        sessionId: newSessionId,
                        hasActiveSession: true,
                    });

                    // Verify session exists
                    const session = await agent.getSession(newSessionId);
                    if (!session) {
                        throw new Error(`Session ${newSessionId} not found`);
                    }

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

                    // Handle styled output
                    if (result.type === 'styled' && result.styled) {
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
                // Check if this is an interactive command that should show a selector
                // instead of being executed
                if (command === 'model') {
                    dispatch({ type: 'INPUT_CHANGE', value: '/model' });
                    dispatch({ type: 'SHOW_OVERLAY', overlay: 'model-selector' });
                    return;
                }
                if (command === 'resume' || command === 'switch') {
                    dispatch({ type: 'INPUT_CHANGE', value: `/${command}` });
                    dispatch({ type: 'SHOW_OVERLAY', overlay: 'session-selector' });
                    return;
                }
                if (command === 'log') {
                    dispatch({ type: 'CLOSE_OVERLAY' });
                    dispatch({ type: 'INPUT_CLEAR' });
                    dispatch({ type: 'SHOW_OVERLAY', overlay: 'log-level-selector' });
                    return;
                }
                if (command === 'mcp') {
                    dispatch({ type: 'CLOSE_OVERLAY' });
                    dispatch({ type: 'INPUT_CLEAR' });
                    dispatch({ type: 'SHOW_OVERLAY', overlay: 'mcp-selector' });
                    return;
                }
                if (command === 'session') {
                    dispatch({ type: 'CLOSE_OVERLAY' });
                    dispatch({ type: 'INPUT_CLEAR' });
                    dispatch({ type: 'SHOW_OVERLAY', overlay: 'session-subcommand-selector' });
                    return;
                }

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

                    // Handle styled output (for /help, /config, /stats, etc.)
                    if (result.type === 'styled' && result.styled) {
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

        // Handle log level selection
        const handleLogLevelSelect = useCallback(
            (level: string) => {
                dispatch({ type: 'CLOSE_OVERLAY' });
                dispatch({ type: 'INPUT_CLEAR' });

                logger.setLevel(level);

                dispatch({
                    type: 'MESSAGE_ADD',
                    message: {
                        id: generateMessageId('system'),
                        role: 'system',
                        content: `📊 Log level set to: ${level}`,
                        timestamp: new Date(),
                    },
                });
            },
            [dispatch]
        );

        // Handle main MCP action selection
        const handleMcpAction = useCallback(
            async (action: McpAction) => {
                switch (action) {
                    case 'list': {
                        // Execute list directly
                        dispatch({ type: 'CLOSE_OVERLAY' });
                        dispatch({ type: 'INPUT_CLEAR' });
                        dispatch({ type: 'PROCESSING_START' });

                        try {
                            const { CommandService } = await import(
                                '../services/CommandService.js'
                            );
                            const commandService = new CommandService();
                            const result = await commandService.executeCommand(
                                'mcp',
                                ['list'],
                                agent,
                                state.session.id || undefined
                            );

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
                            if (result.type === 'styled' && result.styled) {
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
                            dispatch({ type: 'PROCESSING_END' });
                        } catch (error) {
                            dispatch({
                                type: 'ERROR',
                                errorMessage:
                                    error instanceof Error ? error.message : String(error),
                            });
                        }
                        break;
                    }
                    case 'add-preset':
                        // Drill down to preset selector (registry servers only)
                        dispatch({ type: 'SHOW_OVERLAY', overlay: 'mcp-add-selector' });
                        break;
                    case 'add-custom':
                        // Show type selector for guided custom server setup
                        dispatch({ type: 'SHOW_OVERLAY', overlay: 'mcp-custom-type-selector' });
                        break;
                    case 'remove':
                        // Drill down to remove selector
                        dispatch({ type: 'SHOW_OVERLAY', overlay: 'mcp-remove-selector' });
                        break;
                }
            },
            [dispatch, agent, state.session.id]
        );

        // Handle MCP add selection (presets only - custom is handled by McpSelector)
        const handleMcpAddSelect = useCallback(
            async (result: McpAddResult) => {
                dispatch({ type: 'CLOSE_OVERLAY' });
                dispatch({ type: 'INPUT_CLEAR' });
                dispatch({ type: 'PROCESSING_START' });

                dispatch({
                    type: 'MESSAGE_ADD',
                    message: {
                        id: generateMessageId('system'),
                        role: 'system',
                        content: `🔌 Connecting to ${result.entry.name}...`,
                        timestamp: new Date(),
                    },
                });

                try {
                    await agent.connectMcpServer(result.entry.id, result.entry.config as any);
                    dispatch({
                        type: 'MESSAGE_ADD',
                        message: {
                            id: generateMessageId('system'),
                            role: 'system',
                            content: `✅ Connected to ${result.entry.name}`,
                            timestamp: new Date(),
                        },
                    });
                } catch (error) {
                    dispatch({
                        type: 'MESSAGE_ADD',
                        message: {
                            id: generateMessageId('system'),
                            role: 'system',
                            content: `❌ Failed to connect: ${error instanceof Error ? error.message : String(error)}`,
                            timestamp: new Date(),
                        },
                    });
                }
                dispatch({ type: 'PROCESSING_END' });
            },
            [dispatch, agent]
        );

        // Handle MCP remove selection
        const handleMcpRemoveSelect = useCallback(
            async (serverName: string) => {
                dispatch({ type: 'CLOSE_OVERLAY' });
                dispatch({ type: 'INPUT_CLEAR' });
                dispatch({ type: 'PROCESSING_START' });

                dispatch({
                    type: 'MESSAGE_ADD',
                    message: {
                        id: generateMessageId('system'),
                        role: 'system',
                        content: `🗑️ Removing ${serverName}...`,
                        timestamp: new Date(),
                    },
                });

                try {
                    await agent.removeMcpServer(serverName);
                    dispatch({
                        type: 'MESSAGE_ADD',
                        message: {
                            id: generateMessageId('system'),
                            role: 'system',
                            content: `✅ Removed ${serverName}`,
                            timestamp: new Date(),
                        },
                    });
                } catch (error) {
                    dispatch({
                        type: 'MESSAGE_ADD',
                        message: {
                            id: generateMessageId('system'),
                            role: 'system',
                            content: `❌ Failed to remove: ${error instanceof Error ? error.message : String(error)}`,
                            timestamp: new Date(),
                        },
                    });
                }
                dispatch({ type: 'PROCESSING_END' });
            },
            [dispatch, agent]
        );

        // Handle MCP custom type selection
        const handleMcpCustomTypeSelect = useCallback(
            (serverType: McpServerType) => {
                // Store the selected type and show wizard
                dispatch({ type: 'SET_MCP_WIZARD_SERVER_TYPE', serverType });
                dispatch({ type: 'SHOW_OVERLAY', overlay: 'mcp-custom-wizard' });
            },
            [dispatch]
        );

        // Handle MCP custom wizard completion
        const handleMcpCustomWizardComplete = useCallback(
            async (config: McpCustomConfig) => {
                dispatch({ type: 'CLOSE_OVERLAY' });
                dispatch({ type: 'INPUT_CLEAR' });
                dispatch({ type: 'PROCESSING_START' });

                dispatch({
                    type: 'MESSAGE_ADD',
                    message: {
                        id: generateMessageId('system'),
                        role: 'system',
                        content: `🔌 Connecting to ${config.name}...`,
                        timestamp: new Date(),
                    },
                });

                try {
                    // Build the appropriate config based on server type
                    let serverConfig: any;
                    if (config.serverType === 'stdio') {
                        serverConfig = {
                            transport: 'stdio',
                            command: config.command,
                            args: config.args || [],
                        };
                    } else if (config.serverType === 'http') {
                        serverConfig = {
                            transport: 'http',
                            url: config.url,
                        };
                    } else if (config.serverType === 'sse') {
                        serverConfig = {
                            transport: 'sse',
                            url: config.url,
                        };
                    }

                    await agent.connectMcpServer(config.name, serverConfig);
                    dispatch({
                        type: 'MESSAGE_ADD',
                        message: {
                            id: generateMessageId('system'),
                            role: 'system',
                            content: `✅ Connected to ${config.name}`,
                            timestamp: new Date(),
                        },
                    });
                } catch (error) {
                    dispatch({
                        type: 'MESSAGE_ADD',
                        message: {
                            id: generateMessageId('system'),
                            role: 'system',
                            content: `❌ Failed to connect: ${error instanceof Error ? error.message : String(error)}`,
                            timestamp: new Date(),
                        },
                    });
                }
                dispatch({ type: 'PROCESSING_END' });
            },
            [dispatch, agent]
        );

        // Handle session subcommand selection
        const handleSessionSubcommandSelect = useCallback(
            async (action: SessionAction) => {
                if (action === 'switch') {
                    // Drill down to session selector
                    dispatch({ type: 'INPUT_CHANGE', value: '/session switch' });
                    dispatch({ type: 'SHOW_OVERLAY', overlay: 'session-selector' });
                    return;
                }

                // Execute other session commands directly
                dispatch({ type: 'CLOSE_OVERLAY' });
                dispatch({ type: 'INPUT_CLEAR' });
                dispatch({ type: 'PROCESSING_START' });

                try {
                    const { CommandService } = await import('../services/CommandService.js');
                    const commandService = new CommandService();
                    const result = await commandService.executeCommand(
                        'session',
                        [action],
                        agent,
                        state.session.id || undefined
                    );

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
                    if (result.type === 'styled' && result.styled) {
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

                {/* Log level selector */}
                {ui.activeOverlay === 'log-level-selector' && (
                    <Box marginTop={1}>
                        <LogLevelSelector
                            ref={logLevelSelectorRef}
                            isVisible={true}
                            onSelect={handleLogLevelSelect}
                            onClose={handleClose}
                        />
                    </Box>
                )}

                {/* MCP selector */}
                {ui.activeOverlay === 'mcp-selector' && (
                    <Box marginTop={1}>
                        <McpSelector
                            ref={mcpSelectorRef}
                            isVisible={true}
                            onSelect={handleMcpAction}
                            onClose={handleClose}
                        />
                    </Box>
                )}

                {/* MCP add selector */}
                {ui.activeOverlay === 'mcp-add-selector' && (
                    <Box marginTop={1}>
                        <McpAddSelector
                            ref={mcpAddSelectorRef}
                            isVisible={true}
                            onSelect={handleMcpAddSelect}
                            onClose={handleClose}
                        />
                    </Box>
                )}

                {/* MCP remove selector */}
                {ui.activeOverlay === 'mcp-remove-selector' && (
                    <Box marginTop={1}>
                        <McpRemoveSelector
                            ref={mcpRemoveSelectorRef}
                            isVisible={true}
                            onSelect={handleMcpRemoveSelect}
                            onClose={handleClose}
                            agent={agent}
                        />
                    </Box>
                )}

                {/* MCP custom type selector */}
                {ui.activeOverlay === 'mcp-custom-type-selector' && (
                    <Box marginTop={1}>
                        <McpCustomTypeSelector
                            ref={mcpCustomTypeSelectorRef}
                            isVisible={true}
                            onSelect={handleMcpCustomTypeSelect}
                            onClose={handleClose}
                        />
                    </Box>
                )}

                {/* MCP custom wizard */}
                {ui.activeOverlay === 'mcp-custom-wizard' && ui.mcpWizardServerType && (
                    <McpCustomWizard
                        ref={mcpCustomWizardRef}
                        isVisible={true}
                        serverType={ui.mcpWizardServerType}
                        onComplete={handleMcpCustomWizardComplete}
                        onClose={handleClose}
                    />
                )}

                {/* Session subcommand selector */}
                {ui.activeOverlay === 'session-subcommand-selector' && (
                    <Box marginTop={1}>
                        <SessionSubcommandSelector
                            ref={sessionSubcommandSelectorRef}
                            isVisible={true}
                            onSelect={handleSessionSubcommandSelect}
                            onClose={handleClose}
                        />
                    </Box>
                )}
            </>
        );
    }
);

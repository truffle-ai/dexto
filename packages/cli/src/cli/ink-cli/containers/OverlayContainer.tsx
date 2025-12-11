/**
 * OverlayContainer Component
 * Smart container for managing all overlays (selectors, autocomplete, approval)
 */

import React, { useCallback, useRef, useImperativeHandle, forwardRef } from 'react';
import { Box } from 'ink';
import type { DextoAgent } from '@dexto/core';
import type { Key } from '../hooks/useInputOrchestrator.js';
import { ApprovalStatus, DenialReason } from '@dexto/core';
import type { Message, UIState, InputState, SessionState } from '../state/types.js';
import {
    ApprovalPrompt,
    type ApprovalPromptHandle,
    type ApprovalRequest,
} from '../components/ApprovalPrompt.js';
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
import McpServerList, {
    type McpServerListHandle,
    type McpServerListAction,
    type McpServerInfo,
} from '../components/overlays/McpServerList.js';
import McpServerActions, {
    type McpServerActionsHandle,
    type McpServerAction,
} from '../components/overlays/McpServerActions.js';
import McpAddChoice, {
    type McpAddChoiceHandle,
    type McpAddChoiceType,
} from '../components/overlays/McpAddChoice.js';
import McpAddSelector, {
    type McpAddSelectorHandle,
    type McpAddResult,
} from '../components/overlays/McpAddSelector.js';
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
import ApiKeyInput, { type ApiKeyInputHandle } from '../components/overlays/ApiKeyInput.js';
import SearchOverlay, { type SearchOverlayHandle } from '../components/overlays/SearchOverlay.js';
import type { PromptInfo, ResourceMetadata, LLMProvider, SearchResult } from '@dexto/core';
import type { LogLevel } from '@dexto/core';
import { DextoValidationError, LLMErrorCode } from '@dexto/core';
import { InputService } from '../services/InputService.js';
import { createUserMessage, convertHistoryToUIMessages } from '../utils/messageFormatting.js';
import { generateMessageId } from '../utils/idGenerator.js';

export interface OverlayContainerHandle {
    handleInput: (input: string, key: Key) => boolean;
}

interface OverlayContainerProps {
    ui: UIState;
    input: InputState;
    session: SessionState;
    approval: ApprovalRequest | null;
    setInput: React.Dispatch<React.SetStateAction<InputState>>;
    setUi: React.Dispatch<React.SetStateAction<UIState>>;
    setSession: React.Dispatch<React.SetStateAction<SessionState>>;
    setMessages: React.Dispatch<React.SetStateAction<Message[]>>;
    setApproval: React.Dispatch<React.SetStateAction<ApprovalRequest | null>>;
    setApprovalQueue: React.Dispatch<React.SetStateAction<ApprovalRequest[]>>;
    agent: DextoAgent;
    inputService: InputService;
}

/**
 * Smart container for managing overlays
 * Handles all modal interactions (selectors, autocomplete, approval)
 */
export const OverlayContainer = forwardRef<OverlayContainerHandle, OverlayContainerProps>(
    function OverlayContainer(
        {
            ui,
            input,
            session,
            approval,
            setInput,
            setUi,
            setSession,
            setMessages,
            setApproval,
            setApprovalQueue,
            agent,
            inputService,
        },
        ref
    ) {
        const eventBus = agent.agentEventBus;

        // Refs to overlay components for input handling
        const approvalRef = useRef<ApprovalPromptHandle>(null);
        const slashAutocompleteRef = useRef<SlashCommandAutocompleteHandle>(null);
        const resourceAutocompleteRef = useRef<ResourceAutocompleteHandle>(null);
        const modelSelectorRef = useRef<ModelSelectorHandle>(null);
        const sessionSelectorRef = useRef<SessionSelectorHandle>(null);
        const logLevelSelectorRef = useRef<LogLevelSelectorHandle>(null);
        const mcpServerListRef = useRef<McpServerListHandle>(null);
        const mcpServerActionsRef = useRef<McpServerActionsHandle>(null);
        const mcpAddChoiceRef = useRef<McpAddChoiceHandle>(null);
        const mcpAddSelectorRef = useRef<McpAddSelectorHandle>(null);
        const mcpCustomTypeSelectorRef = useRef<McpCustomTypeSelectorHandle>(null);
        const mcpCustomWizardRef = useRef<McpCustomWizardHandle>(null);
        const sessionSubcommandSelectorRef = useRef<SessionSubcommandSelectorHandle>(null);
        const apiKeyInputRef = useRef<ApiKeyInputHandle>(null);
        const searchOverlayRef = useRef<SearchOverlayHandle>(null);

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
                        case 'mcp-server-list':
                            return mcpServerListRef.current?.handleInput(inputStr, key) ?? false;
                        case 'mcp-server-actions':
                            return mcpServerActionsRef.current?.handleInput(inputStr, key) ?? false;
                        case 'mcp-add-choice':
                            return mcpAddChoiceRef.current?.handleInput(inputStr, key) ?? false;
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
                        case 'api-key-input':
                            return apiKeyInputRef.current?.handleInput(inputStr, key) ?? false;
                        case 'search':
                            return searchOverlayRef.current?.handleInput(inputStr, key) ?? false;
                        default:
                            return false;
                    }
                },
            }),
            [approval, ui.activeOverlay]
        );

        // NOTE: Automatic overlay detection removed to prevent infinite loop
        // Overlays are now shown explicitly via setUi from InputContainer
        // or from the main component's input detection logic

        // Helper: Complete approval and process queue
        const completeApproval = useCallback(() => {
            setApprovalQueue((queue) => {
                if (queue.length > 0) {
                    // Show next approval from queue
                    const [next, ...rest] = queue;
                    setApproval(next!);
                    setUi((prev) => ({ ...prev, activeOverlay: 'approval' }));
                    return rest;
                } else {
                    // No more approvals
                    setApproval(null);
                    setUi((prev) => ({ ...prev, activeOverlay: 'none' }));
                    return [];
                }
            });
        }, [setApproval, setApprovalQueue, setUi]);

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

                completeApproval();
            },
            [approval, eventBus, completeApproval]
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

            completeApproval();
        }, [approval, eventBus, completeApproval]);

        const handleCancelApproval = useCallback(() => {
            if (!approval || !eventBus) return;

            eventBus.emit('approval:response', {
                approvalId: approval.approvalId,
                status: ApprovalStatus.CANCELLED,
                sessionId: approval.sessionId,
                reason: DenialReason.USER_CANCELLED,
                message: 'User cancelled the approval request',
            });

            completeApproval();
        }, [approval, eventBus, completeApproval]);

        // Helper: Check if error is due to missing API key
        const isApiKeyMissingError = (error: unknown): LLMProvider | null => {
            if (error instanceof DextoValidationError) {
                const apiKeyIssue = error.issues.find(
                    (issue) => issue.code === LLMErrorCode.API_KEY_MISSING
                );
                if (apiKeyIssue && apiKeyIssue.context) {
                    // Extract provider from context
                    const context = apiKeyIssue.context as { provider?: string };
                    if (context.provider) {
                        return context.provider as LLMProvider;
                    }
                }
            }
            return null;
        };

        // Handle model selection
        const handleModelSelect = useCallback(
            async (provider: string, model: string) => {
                setUi((prev) => ({ ...prev, activeOverlay: 'none', mcpWizardServerType: null }));
                setInput((prev) => ({ ...prev, value: '', historyIndex: -1 }));

                try {
                    setMessages((prev) => [
                        ...prev,
                        {
                            id: generateMessageId('system'),
                            role: 'system',
                            content: `🔄 Switching to ${model} (${provider})...`,
                            timestamp: new Date(),
                        },
                    ]);

                    await agent.switchLLM(
                        { provider: provider as LLMProvider, model },
                        session.id || undefined
                    );

                    // Update session state with new model name
                    setSession((prev) => ({ ...prev, modelName: model }));

                    setMessages((prev) => [
                        ...prev,
                        {
                            id: generateMessageId('system'),
                            role: 'system',
                            content: `✅ Successfully switched to ${model} (${provider})`,
                            timestamp: new Date(),
                        },
                    ]);
                } catch (error) {
                    // Check if error is due to missing API key
                    const missingProvider = isApiKeyMissingError(error);
                    if (missingProvider) {
                        // Store pending model switch and show API key input
                        setUi((prev) => ({
                            ...prev,
                            activeOverlay: 'api-key-input',
                            pendingModelSwitch: { provider, model },
                        }));
                        setMessages((prev) => [
                            ...prev,
                            {
                                id: generateMessageId('system'),
                                role: 'system',
                                content: `🔑 API key required for ${provider}`,
                                timestamp: new Date(),
                            },
                        ]);
                        return;
                    }

                    setMessages((prev) => [
                        ...prev,
                        {
                            id: generateMessageId('error'),
                            role: 'system',
                            content: `❌ Failed to switch model: ${error instanceof Error ? error.message : String(error)}`,
                            timestamp: new Date(),
                        },
                    ]);
                }
            },
            [setUi, setInput, setMessages, setSession, agent, session.id]
        );

        // Handle API key saved - retry the model switch
        const handleApiKeySaved = useCallback(
            async (meta: { provider: LLMProvider; envVar: string }) => {
                const pending = ui.pendingModelSwitch;
                if (!pending) {
                    // No pending switch, just close
                    setUi((prev) => ({
                        ...prev,
                        activeOverlay: 'none',
                        pendingModelSwitch: null,
                    }));
                    return;
                }

                setUi((prev) => ({
                    ...prev,
                    activeOverlay: 'none',
                    pendingModelSwitch: null,
                }));

                setMessages((prev) => [
                    ...prev,
                    {
                        id: generateMessageId('system'),
                        role: 'system',
                        content: `✅ API key saved for ${meta.provider}`,
                        timestamp: new Date(),
                    },
                ]);

                // Retry the model switch
                try {
                    setMessages((prev) => [
                        ...prev,
                        {
                            id: generateMessageId('system'),
                            role: 'system',
                            content: `🔄 Retrying switch to ${pending.model} (${pending.provider})...`,
                            timestamp: new Date(),
                        },
                    ]);

                    await agent.switchLLM(
                        { provider: pending.provider as LLMProvider, model: pending.model },
                        session.id || undefined
                    );

                    // Update session state with new model name
                    setSession((prev) => ({ ...prev, modelName: pending.model }));

                    setMessages((prev) => [
                        ...prev,
                        {
                            id: generateMessageId('system'),
                            role: 'system',
                            content: `✅ Successfully switched to ${pending.model} (${pending.provider})`,
                            timestamp: new Date(),
                        },
                    ]);
                } catch (error) {
                    setMessages((prev) => [
                        ...prev,
                        {
                            id: generateMessageId('error'),
                            role: 'system',
                            content: `❌ Failed to switch model: ${error instanceof Error ? error.message : String(error)}`,
                            timestamp: new Date(),
                        },
                    ]);
                }
            },
            [ui.pendingModelSwitch, setUi, setMessages, setSession, agent, session.id]
        );

        // Handle API key input close (without saving)
        const handleApiKeyClose = useCallback(() => {
            setUi((prev) => ({
                ...prev,
                activeOverlay: 'none',
                pendingModelSwitch: null,
            }));
        }, [setUi]);

        // Handle search result selection - display the result context
        const handleSearchResultSelect = useCallback(
            (result: SearchResult) => {
                setUi((prev) => ({ ...prev, activeOverlay: 'none' }));
                setInput((prev) => ({ ...prev, value: '', historyIndex: -1 }));

                // Display the selected search result as a system message
                const roleLabel =
                    result.message.role === 'user'
                        ? '👤 User'
                        : result.message.role === 'assistant'
                          ? '🤖 Assistant'
                          : `📋 ${result.message.role}`;

                setMessages((prev) => [
                    ...prev,
                    {
                        id: generateMessageId('system'),
                        role: 'system',
                        content: `🔍 Search Result from session ${result.sessionId.slice(0, 8)}:\n\n${roleLabel}:\n${result.context}`,
                        timestamp: new Date(),
                    },
                ]);
            },
            [setUi, setInput, setMessages]
        );

        // Handle session selection
        const handleSessionSelect = useCallback(
            async (newSessionId: string) => {
                setUi((prev) => ({ ...prev, activeOverlay: 'none', mcpWizardServerType: null }));
                setInput((prev) => ({ ...prev, value: '', historyIndex: -1 }));

                try {
                    // Check if already on this session
                    if (newSessionId === session.id) {
                        setMessages((prev) => [
                            ...prev,
                            {
                                id: generateMessageId('system'),
                                role: 'system',
                                content: `ℹ️  Already using session ${newSessionId.slice(0, 8)}`,
                                timestamp: new Date(),
                            },
                        ]);
                        return;
                    }

                    // Clear messages and session state before switching
                    setMessages([]);
                    setApproval(null);
                    setApprovalQueue([]);
                    setSession({
                        id: newSessionId,
                        hasActiveSession: true,
                        modelName: session.modelName,
                    });

                    // Verify session exists
                    const sessionData = await agent.getSession(newSessionId);
                    if (!sessionData) {
                        throw new Error(`Session ${newSessionId} not found`);
                    }

                    // Load session history
                    const history = await agent.getSessionHistory(newSessionId);
                    if (history && history.length > 0) {
                        const historyMessages = convertHistoryToUIMessages(history, newSessionId);
                        setMessages(historyMessages);
                    }

                    setMessages((prev) => [
                        ...prev,
                        {
                            id: generateMessageId('system'),
                            role: 'system',
                            content: `✅ Switched to session ${newSessionId.slice(0, 8)}`,
                            timestamp: new Date(),
                        },
                    ]);
                } catch (error) {
                    setMessages((prev) => [
                        ...prev,
                        {
                            id: generateMessageId('error'),
                            role: 'system',
                            content: `❌ Failed to switch session: ${error instanceof Error ? error.message : String(error)}`,
                            timestamp: new Date(),
                        },
                    ]);
                }
            },
            [
                setUi,
                setInput,
                setMessages,
                setApproval,
                setApprovalQueue,
                setSession,
                agent,
                session.id,
                session.modelName,
            ]
        );

        // Handle slash command/prompt selection
        const handlePromptSelect = useCallback(
            async (prompt: PromptInfo) => {
                const commandText = `/${prompt.name}`;
                setUi((prev) => ({ ...prev, activeOverlay: 'none', mcpWizardServerType: null }));
                setInput((prev) => ({ ...prev, value: '', historyIndex: -1 }));

                // Show user message for the executed command
                const userMessage = createUserMessage(commandText);
                setMessages((prev) => [...prev, userMessage]);

                setUi((prev) => ({ ...prev, isProcessing: true, isCancelling: false }));

                const { CommandService } = await import('../services/CommandService.js');
                const commandService = new CommandService();

                try {
                    const result = await commandService.executeCommand(
                        prompt.name,
                        [],
                        agent,
                        session.id || undefined
                    );

                    if (result.type === 'prompt') {
                        // Prompt execution continues via event bus
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
                            content: `❌ ${error instanceof Error ? error.message : String(error)}`,
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
            },
            [setUi, setInput, setMessages, agent, session.id]
        );

        // Handle loading command/prompt into input for editing (Tab key)

        const handleSystemCommandSelect = useCallback(
            async (command: string) => {
                // Check if this command has an interactive overlay
                const { getCommandOverlayForSelect } = await import('../utils/commandOverlays.js');
                const overlay = getCommandOverlayForSelect(command);
                if (overlay) {
                    setInput((prev) => ({ ...prev, value: '', historyIndex: -1 }));
                    setUi((prev) => ({
                        ...prev,
                        activeOverlay: overlay,
                        mcpWizardServerType: null,
                    }));
                    return;
                }

                const commandText = `/${command}`;
                setUi((prev) => ({ ...prev, activeOverlay: 'none', mcpWizardServerType: null }));
                setInput((prev) => ({ ...prev, value: '', historyIndex: -1 }));

                // Show user message for the executed command
                const userMessage = createUserMessage(commandText);
                setMessages((prev) => [...prev, userMessage]);

                setUi((prev) => ({ ...prev, isProcessing: true, isCancelling: false }));

                const { CommandService } = await import('../services/CommandService.js');
                const commandService = new CommandService();

                try {
                    const result = await commandService.executeCommand(
                        command,
                        [],
                        agent,
                        session.id || undefined
                    );

                    if (result.type === 'prompt') {
                        // Prompt execution continues via event bus
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
                            content: `❌ ${error instanceof Error ? error.message : String(error)}`,
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
            },
            [setInput, setUi, setMessages, agent, session.id]
        );

        const handleLoadIntoInput = useCallback(
            (text: string) => {
                setInput((prev) => ({ ...prev, value: text }));
                setUi((prev) => ({ ...prev, activeOverlay: 'none', mcpWizardServerType: null }));
            },
            [setInput, setUi]
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
                    setInput((prev) => ({ ...prev, value: `${before}${reference} ` }));
                }
                setUi((prev) => ({ ...prev, activeOverlay: 'none', mcpWizardServerType: null }));
            },
            [input.value, setInput, setUi]
        );

        const handleClose = useCallback(() => {
            setUi((prev) => ({ ...prev, activeOverlay: 'none', mcpWizardServerType: null }));
        }, [setUi]);

        // Handle log level selection
        const handleLogLevelSelect = useCallback(
            (level: string) => {
                setUi((prev) => ({ ...prev, activeOverlay: 'none', mcpWizardServerType: null }));
                setInput((prev) => ({ ...prev, value: '', historyIndex: -1 }));

                // Set level on agent's logger (propagates to all child loggers via shared ref)
                agent.logger.setLevel(level as LogLevel);

                setMessages((prev) => [
                    ...prev,
                    {
                        id: generateMessageId('system'),
                        role: 'system',
                        content: `📊 Log level set to: ${level}`,
                        timestamp: new Date(),
                    },
                ]);
            },
            [setUi, setInput, setMessages, agent]
        );

        // Handle MCP server list actions (select server or add new)
        const handleMcpServerListAction = useCallback(
            (action: McpServerListAction) => {
                if (action.type === 'select-server') {
                    // Show server actions overlay
                    setUi((prev) => ({
                        ...prev,
                        activeOverlay: 'mcp-server-actions',
                        selectedMcpServer: action.server,
                    }));
                } else if (action.type === 'add-new') {
                    // Show add choice overlay
                    setUi((prev) => ({
                        ...prev,
                        activeOverlay: 'mcp-add-choice',
                    }));
                }
            },
            [setUi]
        );

        // Handle MCP server actions (enable/disable/delete/back)
        const handleMcpServerAction = useCallback(
            async (action: McpServerAction) => {
                const { server } = action;

                if (action.type === 'back') {
                    // Go back to server list
                    setUi((prev) => ({
                        ...prev,
                        activeOverlay: 'mcp-server-list',
                        selectedMcpServer: null,
                    }));
                    return;
                }

                // Close overlay and reset input for actual actions
                setUi((prev) => ({
                    ...prev,
                    activeOverlay: 'none',
                    selectedMcpServer: null,
                    mcpWizardServerType: null,
                }));
                setInput((prev) => ({ ...prev, value: '', historyIndex: -1 }));

                if (action.type === 'enable' || action.type === 'disable') {
                    const newEnabled = action.type === 'enable';
                    setMessages((prev) => [
                        ...prev,
                        {
                            id: generateMessageId('system'),
                            role: 'system',
                            content: `${newEnabled ? '▶️' : '⏸️'} ${newEnabled ? 'Enabling' : 'Disabling'} ${server.name}...`,
                            timestamp: new Date(),
                        },
                    ]);

                    try {
                        // Import persistence utilities
                        const { updateAgentConfigFile } = await import('@dexto/agent-management');

                        // Get current config and update the enabled field
                        const currentConfig = agent.getEffectiveConfig();
                        const serverConfig = currentConfig.mcpServers?.[server.name];

                        if (!serverConfig) {
                            throw new Error(`Server ${server.name} not found in config`);
                        }

                        const updates = {
                            mcpServers: {
                                ...(currentConfig.mcpServers || {}),
                                [server.name]: {
                                    ...serverConfig,
                                    enabled: newEnabled,
                                },
                            },
                        };

                        // Persist to config file
                        await updateAgentConfigFile(agent.getAgentFilePath(), updates);

                        // If enabling, try to connect
                        if (newEnabled) {
                            try {
                                await agent.connectMcpServer(server.name, serverConfig as any);
                            } catch (connectError) {
                                // Connection failed but server is enabled - will retry on next reload
                                setMessages((prev) => [
                                    ...prev,
                                    {
                                        id: generateMessageId('system'),
                                        role: 'system',
                                        content: `⚠️ Server enabled but connection failed: ${connectError instanceof Error ? connectError.message : String(connectError)}`,
                                        timestamp: new Date(),
                                    },
                                ]);
                                return;
                            }
                        } else {
                            // If disabling, disconnect (but keep in runtime state)
                            await agent.disconnectMcpServer(server.name);
                        }

                        setMessages((prev) => [
                            ...prev,
                            {
                                id: generateMessageId('system'),
                                role: 'system',
                                content: `✅ ${server.name} ${newEnabled ? 'enabled' : 'disabled'}`,
                                timestamp: new Date(),
                            },
                        ]);
                    } catch (error) {
                        // Format error message with details if available
                        let errorMessage = error instanceof Error ? error.message : String(error);
                        if (error instanceof DextoValidationError && error.issues.length > 0) {
                            const issueDetails = error.issues
                                .map((i) => {
                                    const path = i.path?.length ? `[${i.path.join('.')}] ` : '';
                                    return `  - ${path}${i.message}`;
                                })
                                .join('\n');
                            errorMessage = `Validation failed:\n${issueDetails}`;
                        }
                        setMessages((prev) => [
                            ...prev,
                            {
                                id: generateMessageId('error'),
                                role: 'system',
                                content: `❌ Failed to ${action.type} server: ${errorMessage}`,
                                timestamp: new Date(),
                            },
                        ]);
                    }
                } else if (action.type === 'delete') {
                    setMessages((prev) => [
                        ...prev,
                        {
                            id: generateMessageId('system'),
                            role: 'system',
                            content: `🗑️ Deleting ${server.name}...`,
                            timestamp: new Date(),
                        },
                    ]);

                    try {
                        // Import persistence utilities
                        const { updateAgentConfigFile } = await import('@dexto/agent-management');

                        // Get current config and remove the server
                        const currentConfig = agent.getEffectiveConfig();
                        const mcpServers = { ...(currentConfig.mcpServers || {}) };
                        delete mcpServers[server.name];

                        const updates = {
                            mcpServers,
                        };

                        // Persist to config file
                        await updateAgentConfigFile(agent.getAgentFilePath(), updates);

                        // Also disconnect if connected
                        try {
                            await agent.removeMcpServer(server.name);
                        } catch {
                            // Ignore - server might not be connected
                        }

                        setMessages((prev) => [
                            ...prev,
                            {
                                id: generateMessageId('system'),
                                role: 'system',
                                content: `✅ Deleted ${server.name}`,
                                timestamp: new Date(),
                            },
                        ]);
                    } catch (error) {
                        setMessages((prev) => [
                            ...prev,
                            {
                                id: generateMessageId('error'),
                                role: 'system',
                                content: `❌ Failed to delete server: ${error instanceof Error ? error.message : String(error)}`,
                                timestamp: new Date(),
                            },
                        ]);
                    }
                }
            },
            [setUi, setInput, setMessages, agent]
        );

        // Handle MCP add choice (registry/custom/back)
        const handleMcpAddChoice = useCallback(
            (choice: McpAddChoiceType) => {
                if (choice === 'back') {
                    // Go back to server list
                    setUi((prev) => ({
                        ...prev,
                        activeOverlay: 'mcp-server-list',
                    }));
                } else if (choice === 'registry') {
                    // Show registry selector (McpAddSelector)
                    setUi((prev) => ({
                        ...prev,
                        activeOverlay: 'mcp-add-selector',
                    }));
                } else if (choice === 'custom') {
                    // Show custom type selector
                    setUi((prev) => ({
                        ...prev,
                        activeOverlay: 'mcp-custom-type-selector',
                    }));
                }
            },
            [setUi]
        );

        // Handle MCP add selection (presets only)
        const handleMcpAddSelect = useCallback(
            async (result: McpAddResult) => {
                setUi((prev) => ({ ...prev, activeOverlay: 'none', mcpWizardServerType: null }));
                setInput((prev) => ({ ...prev, value: '', historyIndex: -1 }));
                setUi((prev) => ({ ...prev, isProcessing: true, isCancelling: false }));

                setMessages((prev) => [
                    ...prev,
                    {
                        id: generateMessageId('system'),
                        role: 'system',
                        content: `🔌 Connecting to ${result.entry.name}...`,
                        timestamp: new Date(),
                    },
                ]);

                try {
                    await agent.connectMcpServer(result.entry.id, result.entry.config as any);
                    setMessages((prev) => [
                        ...prev,
                        {
                            id: generateMessageId('system'),
                            role: 'system',
                            content: `✅ Connected to ${result.entry.name}`,
                            timestamp: new Date(),
                        },
                    ]);
                } catch (error) {
                    setMessages((prev) => [
                        ...prev,
                        {
                            id: generateMessageId('system'),
                            role: 'system',
                            content: `❌ Failed to connect: ${error instanceof Error ? error.message : String(error)}`,
                            timestamp: new Date(),
                        },
                    ]);
                }
                setUi((prev) => ({
                    ...prev,
                    isProcessing: false,
                    isCancelling: false,
                    isThinking: false,
                }));
            },
            [setUi, setInput, setMessages, agent]
        );

        // Handle MCP custom type selection
        const handleMcpCustomTypeSelect = useCallback(
            (serverType: McpServerType) => {
                setUi((prev) => ({
                    ...prev,
                    mcpWizardServerType: serverType,
                    activeOverlay: 'mcp-custom-wizard',
                }));
            },
            [setUi]
        );

        // Handle MCP custom wizard completion
        const handleMcpCustomWizardComplete = useCallback(
            async (config: McpCustomConfig) => {
                setUi((prev) => ({ ...prev, activeOverlay: 'none', mcpWizardServerType: null }));
                setInput((prev) => ({ ...prev, value: '', historyIndex: -1 }));
                setUi((prev) => ({ ...prev, isProcessing: true, isCancelling: false }));

                setMessages((prev) => [
                    ...prev,
                    {
                        id: generateMessageId('system'),
                        role: 'system',
                        content: `🔌 Connecting to ${config.name}...`,
                        timestamp: new Date(),
                    },
                ]);

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
                    setMessages((prev) => [
                        ...prev,
                        {
                            id: generateMessageId('system'),
                            role: 'system',
                            content: `✅ Connected to ${config.name}`,
                            timestamp: new Date(),
                        },
                    ]);
                } catch (error) {
                    setMessages((prev) => [
                        ...prev,
                        {
                            id: generateMessageId('system'),
                            role: 'system',
                            content: `❌ Failed to connect: ${error instanceof Error ? error.message : String(error)}`,
                            timestamp: new Date(),
                        },
                    ]);
                }
                setUi((prev) => ({
                    ...prev,
                    isProcessing: false,
                    isCancelling: false,
                    isThinking: false,
                }));
            },
            [setUi, setInput, setMessages, agent]
        );

        // Handle session subcommand selection
        const handleSessionSubcommandSelect = useCallback(
            async (action: SessionAction) => {
                if (action === 'switch') {
                    setInput((prev) => ({ ...prev, value: '/session switch' }));
                    setUi((prev) => ({ ...prev, activeOverlay: 'session-selector' }));
                    return;
                }

                setUi((prev) => ({ ...prev, activeOverlay: 'none', mcpWizardServerType: null }));
                setInput((prev) => ({ ...prev, value: '', historyIndex: -1 }));
                setUi((prev) => ({ ...prev, isProcessing: true, isCancelling: false }));

                try {
                    const { CommandService } = await import('../services/CommandService.js');
                    const commandService = new CommandService();
                    const result = await commandService.executeCommand(
                        'session',
                        [action],
                        agent,
                        session.id || undefined
                    );

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
                            content: `❌ ${error instanceof Error ? error.message : String(error)}`,
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
            },
            [setInput, setUi, setMessages, agent, session.id]
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
                            currentSessionId={session.id || undefined}
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
                            agent={agent}
                        />
                    </Box>
                )}

                {/* MCP server list (first screen) */}
                {ui.activeOverlay === 'mcp-server-list' && (
                    <Box marginTop={1}>
                        <McpServerList
                            ref={mcpServerListRef}
                            isVisible={true}
                            onAction={handleMcpServerListAction}
                            onClose={handleClose}
                            agent={agent}
                        />
                    </Box>
                )}

                {/* MCP server actions (enable/disable/delete) */}
                {ui.activeOverlay === 'mcp-server-actions' && ui.selectedMcpServer && (
                    <Box marginTop={1}>
                        <McpServerActions
                            ref={mcpServerActionsRef}
                            isVisible={true}
                            server={ui.selectedMcpServer}
                            onAction={handleMcpServerAction}
                            onClose={handleClose}
                        />
                    </Box>
                )}

                {/* MCP add choice (registry vs custom) */}
                {ui.activeOverlay === 'mcp-add-choice' && (
                    <Box marginTop={1}>
                        <McpAddChoice
                            ref={mcpAddChoiceRef}
                            isVisible={true}
                            onSelect={handleMcpAddChoice}
                            onClose={handleClose}
                        />
                    </Box>
                )}

                {/* MCP add selector (registry presets) */}
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

                {/* API key input */}
                {ui.activeOverlay === 'api-key-input' && ui.pendingModelSwitch && (
                    <ApiKeyInput
                        ref={apiKeyInputRef}
                        isVisible={true}
                        provider={ui.pendingModelSwitch.provider as LLMProvider}
                        onSaved={handleApiKeySaved}
                        onClose={handleApiKeyClose}
                    />
                )}

                {/* Search overlay */}
                {ui.activeOverlay === 'search' && (
                    <SearchOverlay
                        ref={searchOverlayRef}
                        isVisible={true}
                        agent={agent}
                        onClose={handleClose}
                        onSelectResult={handleSearchResultSelect}
                    />
                )}
            </>
        );
    }
);

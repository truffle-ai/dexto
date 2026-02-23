/**
 * Shared CLI State Hook
 *
 * Contains all common state and logic shared between rendering modes.
 * Both AlternateBufferCLI and StaticCLI use this hook.
 */

import React, { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { useStdout } from 'ink';
import {
    getModelDisplayName,
    isUserMessage,
    type DextoAgent,
    type QueuedMessage,
} from '@dexto/core';
import type {
    Message,
    StartupInfo,
    UIState,
    InputState,
    SessionState,
    TodoItem,
} from '../state/types.js';
import type { ApprovalRequest } from '../components/ApprovalPrompt.js';
import { useAgentEvents } from './useAgentEvents.js';
import { useInputOrchestrator, type Key } from './useInputOrchestrator.js';
import { InputService, MessageService } from '../services/index.js';
import { convertHistoryToUIMessages } from '../utils/messageFormatting.js';
import type { OverlayContainerHandle } from '../containers/OverlayContainer.js';
import { useTextBuffer, type TextBuffer } from '../components/shared/text-buffer.js';

// Re-export types for backwards compatibility
export type { UIState, InputState, SessionState, TodoItem } from '../state/types.js';

export interface UseCLIStateProps {
    agent: DextoAgent;
    initialSessionId: string | null;
    startupInfo: StartupInfo;
    initialBypassPermissions?: boolean;
    /** Optional keyboard scroll handler for alternate buffer mode */
    onKeyboardScroll?: (direction: 'up' | 'down') => void;
}

export interface CLIStateReturn {
    // State - finalized messages (rendered in <Static>)
    messages: Message[];
    setMessages: React.Dispatch<React.SetStateAction<Message[]>>;
    // Pending messages (streaming/in-progress, rendered dynamically)
    pendingMessages: Message[];
    setPendingMessages: React.Dispatch<React.SetStateAction<Message[]>>;
    // Dequeued buffer - user messages waiting to render after pending
    // (ensures correct visual order regardless of React batching)
    dequeuedBuffer: Message[];
    setDequeuedBuffer: React.Dispatch<React.SetStateAction<Message[]>>;
    // Queued messages (messages waiting to be processed)
    queuedMessages: QueuedMessage[];
    setQueuedMessages: React.Dispatch<React.SetStateAction<QueuedMessage[]>>;
    // Todo items for workflow tracking
    todos: TodoItem[];
    setTodos: React.Dispatch<React.SetStateAction<TodoItem[]>>;
    ui: UIState;
    setUi: React.Dispatch<React.SetStateAction<UIState>>;
    input: InputState;
    setInput: React.Dispatch<React.SetStateAction<InputState>>;
    session: SessionState;
    setSession: React.Dispatch<React.SetStateAction<SessionState>>;
    approval: ApprovalRequest | null;
    setApproval: React.Dispatch<React.SetStateAction<ApprovalRequest | null>>;
    approvalQueue: ApprovalRequest[];
    setApprovalQueue: React.Dispatch<React.SetStateAction<ApprovalRequest[]>>;

    // Text buffer (source of truth for input)
    buffer: TextBuffer;

    // Services
    inputService: InputService;
    messageService: MessageService;

    // Ref for overlay container
    overlayContainerRef: React.RefObject<OverlayContainerHandle | null>;

    // Computed data
    visibleMessages: Message[];

    // Agent reference
    agent: DextoAgent;
    startupInfo: StartupInfo;
}

export function useCLIState({
    agent,
    initialSessionId,
    startupInfo,
    initialBypassPermissions = false,
    onKeyboardScroll: _onKeyboardScroll,
}: UseCLIStateProps): CLIStateReturn {
    // Messages state - finalized messages (rendered in <Static>)
    const [messages, setMessages] = useState<Message[]>([]);
    // Pending messages - streaming/in-progress (rendered dynamically outside <Static>)
    const [pendingMessages, setPendingMessages] = useState<Message[]>([]);
    // Dequeued buffer - user messages rendered after pending (guarantees visual order)
    const [dequeuedBuffer, setDequeuedBuffer] = useState<Message[]>([]);
    // Queued messages - messages waiting to be processed (uses core type)
    const [queuedMessages, setQueuedMessages] = useState<QueuedMessage[]>([]);
    // Todo items for workflow tracking (populated via service:event from todo tools)
    const [todos, setTodos] = useState<TodoItem[]>([]);

    // UI state
    const [ui, setUi] = useState<UIState>({
        isProcessing: false,
        isCancelling: false,
        isThinking: false,
        isCompacting: false,
        activeOverlay: 'none',
        exitWarningShown: false,
        exitWarningTimestamp: null,
        mcpWizardServerType: null,
        copyModeEnabled: false,
        pendingModelSwitch: null,
        selectedMcpServer: null,
        historySearch: {
            isActive: false,
            query: '',
            matchIndex: 0,
            originalInput: '',
            lastMatch: '',
        },
        promptAddWizard: null,
        autoApproveEdits: false,
        bypassPermissions: initialBypassPermissions,
        todoExpanded: true, // Default to expanded to show full todo list
        backgroundTasksRunning: 0,
        backgroundTasksExpanded: false,
        backgroundTasks: [],
        planModeActive: false,
        planModeInitialized: false,
        commandOutput: null,
    });

    // Input state
    const [input, setInput] = useState<InputState>({
        value: '',
        history: [],
        historyIndex: -1,
        draftBeforeHistory: '',
        images: [],
        pastedBlocks: [],
        pasteCounter: 0,
    });

    // Session state - use display name for built-in models at startup
    const initialConfig = agent.getCurrentLLMConfig();
    const [session, setSession] = useState<SessionState>({
        id: initialSessionId,
        hasActiveSession: initialSessionId !== null,
        modelName: getModelDisplayName(initialConfig.model, initialConfig.provider),
    });

    // Approval state
    const [approval, setApproval] = useState<ApprovalRequest | null>(null);
    const [approvalQueue, setApprovalQueue] = useState<ApprovalRequest[]>([]);

    // Initialize services (memoized)
    const inputService = useMemo(() => new InputService(), []);
    const messageService = useMemo(() => new MessageService(), []);

    // Get terminal dimensions for buffer
    const { stdout } = useStdout();
    const terminalWidth = stdout?.columns || 80;
    const inputWidth = Math.max(20, terminalWidth - 4);

    // Memoize onChange to prevent infinite loops (useTextBuffer has onChange in deps)
    const handleBufferChange = useCallback((text: string) => {
        setInput((prev) => ({ ...prev, value: text }));
    }, []);

    // Create text buffer (source of truth for input)
    const buffer = useTextBuffer({
        initialText: '',
        viewport: { width: inputWidth, height: 10 },
        onChange: handleBufferChange,
    });

    // Update viewport on terminal resize
    useEffect(() => {
        buffer.setViewport(inputWidth, 10);
    }, [inputWidth, buffer.setViewport]);

    // Ref for overlay container (input no longer needs ref)
    const overlayContainerRef = useRef<OverlayContainerHandle>(null);

    // Setup event bus subscriptions for non-streaming events
    // (streaming events are handled directly via agent.stream() iterator in InputContainer)
    // Also handles external triggers (run:invoke) from scheduler, A2A, API
    useAgentEvents({
        agent,
        setMessages,
        setPendingMessages,
        setUi,
        setSession,
        setInput,
        setApproval,
        setApprovalQueue,
        setQueuedMessages,
        currentSessionId: session.id,
        buffer,
    });

    // Create input handlers for the orchestrator
    // Note: Main input is NOT routed through orchestrator - TextBufferInput handles it directly
    const approvalHandler = useCallback((inputStr: string, key: Key): boolean => {
        return overlayContainerRef.current?.handleInput(inputStr, key) ?? false;
    }, []);

    const overlayHandler = useCallback((inputStr: string, key: Key): boolean => {
        return overlayContainerRef.current?.handleInput(inputStr, key) ?? false;
    }, []);

    // Setup unified input orchestrator (handles global shortcuts, approval, overlay only)
    useInputOrchestrator({
        ui,
        approval,
        input,
        session,
        queuedMessages,
        buffer,
        setUi,
        setInput,
        setMessages,
        setPendingMessages,
        setQueuedMessages,
        agent,
        handlers: {
            approval: approvalHandler,
            overlay: overlayHandler,
        },
    });

    // Clear todos when session changes (todos are per-session)
    useEffect(() => {
        setTodos([]);
    }, [session.id]);

    // Hydrate conversation history when resuming a session
    useEffect(() => {
        if (!initialSessionId || !session.hasActiveSession || messages.length > 0) {
            return;
        }

        let cancelled = false;

        (async () => {
            try {
                const history = await agent.getSessionHistory(initialSessionId);
                if (!history?.length || cancelled) return;
                const historyMessages = convertHistoryToUIMessages(history, initialSessionId);
                setMessages(historyMessages);

                // Extract user messages for input history (arrow up navigation)
                const userInputHistory = history
                    .filter(isUserMessage)
                    .map((msg) =>
                        msg.content
                            .filter(
                                (part): part is { type: 'text'; text: string } =>
                                    part.type === 'text'
                            )
                            .map((part) => part.text)
                            .join('\n')
                    )
                    .filter((text) => text.trim().length > 0);

                setInput((prev) => ({
                    ...prev,
                    history: userInputHistory,
                    historyIndex: -1,
                }));
            } catch (error) {
                if (cancelled) return;
                setMessages((prev) => [
                    ...prev,
                    {
                        id: `error-${Date.now()}`,
                        role: 'system',
                        content: `Error: ${error instanceof Error ? error.message : String(error)}`,
                        timestamp: new Date(),
                    },
                ]);
            }
        })();

        return () => {
            cancelled = true;
        };
    }, [agent, initialSessionId, messages.length, session.hasActiveSession]);

    // Get visible messages - no limit needed
    // Static mode: items are permanent in terminal scrollback, Ink only renders NEW keys
    // AlternateBuffer mode: VirtualizedList handles its own virtualization
    const visibleMessages = messages;

    return {
        messages,
        setMessages,
        pendingMessages,
        setPendingMessages,
        dequeuedBuffer,
        setDequeuedBuffer,
        queuedMessages,
        setQueuedMessages,
        todos,
        setTodos,
        ui,
        setUi,
        input,
        setInput,
        session,
        setSession,
        approval,
        setApproval,
        approvalQueue,
        setApprovalQueue,
        buffer,
        inputService,
        messageService,
        overlayContainerRef,
        visibleMessages,
        agent,
        startupInfo,
    };
}

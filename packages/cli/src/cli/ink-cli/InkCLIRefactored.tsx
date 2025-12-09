/**
 * InkCLI Component (Refactored)
 *
 * Main orchestrator component - dramatically simplified from 1150 lines to ~150 lines
 *
 * Architecture:
 * - State managed by useReducer with typed actions
 * - Business logic in services
 * - Event handling via custom hooks
 * - UI in presentational components
 * - Smart containers orchestrate interactions
 *
 * Before: 50+ useState hooks, 15+ useEffect hooks, complex state management
 * After: 1 useReducer, 5 custom hooks, clear separation of concerns
 */

import React, { useReducer, useMemo, useEffect, useRef, useCallback } from 'react';
import { Box, render, useStdout } from 'ink';
import type { Key } from 'ink';
import type { DextoAgent } from '@dexto/core';
import { registerGracefulShutdown } from '../../utils/graceful-shutdown.js';

// State management
import { cliReducer, createInitialState, type StartupInfo } from './state/index.js';

// Custom hooks
import { useAgentEvents, useInputOrchestrator, useMouseScroll } from './hooks/index.js';

// Services
import { InputService, MessageService } from './services/index.js';

// Utils
import { getStartupInfo, convertHistoryToUIMessages } from './utils/messageFormatting.js';

// Components
import { Header } from './components/chat/Header.js';
import { MessageItem } from './components/chat/MessageItem.js';
import { ErrorBoundary } from './components/ErrorBoundary.js';
import { StatusBar } from './components/StatusBar.js';
import { Footer } from './components/Footer.js';
import {
    VirtualizedList,
    SCROLL_TO_ITEM_END,
    type VirtualizedListRef,
} from './components/shared/VirtualizedList.js';
import type { Message } from './state/types.js';

// Union type for virtualized list items: header or message
type ListItem = { type: 'header' } | { type: 'message'; message: Message };

// Containers
import { InputContainer, type InputContainerHandle } from './containers/InputContainer.js';
import { OverlayContainer, type OverlayContainerHandle } from './containers/OverlayContainer.js';

interface InkCLIProps {
    agent: DextoAgent;
    initialSessionId: string | null;
    startupInfo: StartupInfo;
}

/**
 * Modern CLI interface using React Ink
 *
 * Refactored for:
 * - Clear separation of concerns
 * - Testability
 * - Maintainability
 * - Performance
 * - Type safety
 *
 * Uses explicit sessionId in state (like WebUI) instead of defaultSession pattern
 */
export function InkCLIRefactored({ agent, initialSessionId, startupInfo }: InkCLIProps) {
    // Initialize state with reducer and set initial sessionId (may be null for deferred creation)
    const [state, dispatch] = useReducer(cliReducer, undefined, () => {
        const initialModelName = agent.getCurrentLLMConfig().model;
        const initial = createInitialState([], initialModelName);
        initial.session.id = initialSessionId;
        initial.session.hasActiveSession = initialSessionId !== null;
        return initial;
    });

    // Initialize services (memoized)
    const inputService = useMemo(() => new InputService(), []);
    const messageService = useMemo(() => new MessageService(), []);

    // Refs to container components for unified input handling
    const inputContainerRef = useRef<InputContainerHandle>(null);
    const overlayContainerRef = useRef<OverlayContainerHandle>(null);
    const listRef = useRef<VirtualizedListRef<ListItem>>(null);

    // Setup event bus subscriptions
    useAgentEvents({ agent, dispatch, isCancelling: state.ui.isCancelling });

    // Session is now managed in state - no need for sync hook
    // useSessionSync removed - sessionId is in state from initialization or SESSION_SET actions

    // Input history navigation is now handled by MultiLineTextInput component

    // Create input handlers for the orchestrator
    // Approval handler - routes to OverlayContainer
    const approvalHandler = useCallback((input: string, key: Key): boolean => {
        return overlayContainerRef.current?.handleInput(input, key) ?? false;
    }, []);

    // Overlay handler - routes to OverlayContainer
    const overlayHandler = useCallback((input: string, key: Key): boolean => {
        return overlayContainerRef.current?.handleInput(input, key) ?? false;
    }, []);

    // Main input handler - routes to InputContainer with scroll support
    const inputHandler = useCallback((input: string, key: Key): boolean => {
        // Handle scroll: Page Up/Down or Shift+Up/Down
        if (key.pageUp || (key.shift && key.upArrow)) {
            listRef.current?.scrollBy(-10); // Scroll up 10 lines
            return true;
        }
        if (key.pageDown || (key.shift && key.downArrow)) {
            listRef.current?.scrollBy(10); // Scroll down 10 lines
            return true;
        }

        return inputContainerRef.current?.handleInput(input, key) ?? false;
    }, []);

    // Scroll handlers for mouse/trackpad
    const handleScrollUp = useCallback(() => {
        listRef.current?.scrollBy(-3); // Scroll up 3 lines
    }, []);
    const handleScrollDown = useCallback(() => {
        listRef.current?.scrollBy(3); // Scroll down 3 lines
    }, []);

    // Setup unified input orchestrator (replaces useKeyboardShortcuts)
    // Also handles mouse scroll events
    useInputOrchestrator({
        state,
        dispatch,
        agent,
        handlers: {
            approval: approvalHandler,
            overlay: overlayHandler,
            input: inputHandler,
            onScrollUp: handleScrollUp,
            onScrollDown: handleScrollDown,
        },
    });

    // Enable mouse events on the terminal (actual handling is in orchestrator)
    useMouseScroll({ isActive: true });

    // Hydrate conversation history when resuming a session
    useEffect(() => {
        if (!initialSessionId || !state.session.hasActiveSession || state.messages.length > 0) {
            return;
        }

        let cancelled = false;

        (async () => {
            try {
                const history = await agent.getSessionHistory(initialSessionId);
                if (!history?.length || cancelled) return;
                const historyMessages = convertHistoryToUIMessages(history, initialSessionId);
                dispatch({ type: 'MESSAGE_ADD_MULTIPLE', messages: historyMessages });
            } catch (error) {
                if (cancelled) return;
                dispatch({
                    type: 'ERROR',
                    errorMessage: error instanceof Error ? error.message : String(error),
                });
            }
        })();

        return () => {
            cancelled = true;
        };
    }, [agent, dispatch, initialSessionId, state.messages.length, state.session.hasActiveSession]);

    // Detect selector overlays based on exact command matches
    // Note: Autocomplete overlays (slash-autocomplete, resource-autocomplete) are now
    // handled via event-driven detection in MultiLineTextInput/InputContainer.
    // This useEffect ONLY handles selector detection for exact commands like /model, /resume.
    // This prevents flickering because we only run detection on specific command matches,
    // not on every keystroke.
    useEffect(() => {
        // Don't detect overlays if processing or approval is active
        if (state.ui.isProcessing || state.approval) return;

        // Early return for non-command input - no selector detection needed
        // This avoids calling parseInput() on every regular character typed
        if (!state.input.value.startsWith('/')) return;

        // Only check for selector commands, not autocomplete
        // These are detected while typing (unlike /mcp, /log, /session which are Enter-triggered)
        const selectorType = inputService.detectInteractiveSelector(state.input.value);

        // Determine what selector overlay should be shown
        let desiredOverlay: typeof state.ui.activeOverlay = 'none';
        switch (selectorType) {
            case 'model':
                desiredOverlay = 'model-selector';
                break;
            case 'session':
                desiredOverlay = 'session-selector';
                break;
        }

        // Overlays that should not be auto-closed (Enter-triggered or user-controlled)
        const protectedOverlays = [
            'slash-autocomplete', // Now event-driven
            'resource-autocomplete', // Now event-driven
            'log-level-selector',
            'mcp-selector',
            'mcp-add-selector',
            'mcp-remove-selector',
            'mcp-custom-type-selector',
            'mcp-custom-wizard',
            'session-subcommand-selector',
            'approval',
        ];
        const isProtectedOverlay = protectedOverlays.includes(state.ui.activeOverlay);

        // Only update overlay if:
        // 1. Desired overlay is different from current
        // 2. Current overlay is not protected
        if (desiredOverlay !== state.ui.activeOverlay && !isProtectedOverlay) {
            if (desiredOverlay === 'none') {
                // Don't close if already 'none'
                if (state.ui.activeOverlay !== 'none') {
                    dispatch({ type: 'CLOSE_OVERLAY' });
                }
            } else {
                dispatch({ type: 'SHOW_OVERLAY', overlay: desiredOverlay });
            }
        }
    }, [
        state.input.value,
        state.ui.isProcessing,
        state.approval,
        state.ui.activeOverlay,
        inputService,
        dispatch,
    ]);

    // Get visible messages
    const visibleMessages = useMemo(() => {
        return messageService.getVisibleMessages(state.messages, 50);
    }, [state.messages, messageService]);

    // Build list data: header as first item, then messages
    const listData = useMemo<ListItem[]>(() => {
        const items: ListItem[] = [{ type: 'header' }];
        for (const msg of visibleMessages) {
            items.push({ type: 'message', message: msg });
        }
        return items;
    }, [visibleMessages]);

    // Get terminal dimensions for alternate buffer mode
    const { stdout } = useStdout();
    const terminalHeight = stdout?.rows ?? 24;

    // Callbacks for VirtualizedList
    const renderListItem = useCallback(
        ({ item }: { item: ListItem }) => {
            if (item.type === 'header') {
                return (
                    <Header
                        modelName={state.session.modelName}
                        sessionId={state.session.id || undefined}
                        hasActiveSession={state.session.hasActiveSession}
                        startupInfo={startupInfo}
                    />
                );
            }
            return <MessageItem message={item.message} />;
        },
        [state.session.modelName, state.session.id, state.session.hasActiveSession, startupInfo]
    );

    // Smart height estimation based on item type and content
    // This prevents layout shifts when items are measured
    const estimateItemHeight = useCallback(
        (index: number) => {
            const item = listData[index];
            if (!item) return 3;

            // Header is approximately 10 lines (logo + info)
            if (item.type === 'header') {
                return 10;
            }

            const msg = item.message;

            // Tool messages with results are taller
            if (msg.role === 'tool') {
                if (msg.toolResult) {
                    // Estimate based on result length (roughly 80 chars per line)
                    const resultLines = Math.ceil(msg.toolResult.length / 80);
                    return Math.min(2 + resultLines, 10); // Cap at 10 lines
                }
                return 2; // Running tool without result
            }

            // User messages have margin and background
            if (msg.role === 'user') {
                const contentLines = Math.ceil(msg.content.length / 80);
                return Math.max(3, contentLines + 2); // +2 for margins
            }

            // Assistant messages - estimate based on content length
            if (msg.role === 'assistant') {
                if (msg.isStreaming) return 5; // Streaming can grow
                const contentLines = Math.ceil(msg.content.length / 80);
                return Math.max(2, contentLines + 1);
            }

            // System/styled messages
            if (msg.styledType) {
                // Styled boxes are typically taller
                return 8;
            }

            return 3; // Default
        },
        [listData]
    );

    const getItemKey = useCallback((item: ListItem) => {
        if (item.type === 'header') return 'header';
        return item.message.id;
    }, []);

    return (
        <ErrorBoundary>
            {/* Root container with explicit height for alternate buffer mode */}
            <Box flexDirection="column" height={terminalHeight}>
                {/* Scrollable content area - header + messages */}
                <Box flexGrow={1} flexShrink={1} minHeight={0}>
                    <VirtualizedList
                        ref={listRef}
                        data={listData}
                        renderItem={renderListItem}
                        estimatedItemHeight={estimateItemHeight}
                        keyExtractor={getItemKey}
                        initialScrollIndex={SCROLL_TO_ITEM_END}
                        initialScrollOffsetInIndex={SCROLL_TO_ITEM_END}
                    />
                </Box>

                {/* Controls area - fixed at bottom */}
                <Box flexDirection="column" flexShrink={0}>
                    <StatusBar
                        isProcessing={state.ui.isProcessing}
                        isThinking={state.ui.isThinking}
                        approvalQueueCount={state.approvalQueue.length}
                        exitWarningShown={state.ui.exitWarningShown}
                    />

                    <InputContainer
                        ref={inputContainerRef}
                        state={state}
                        dispatch={dispatch}
                        agent={agent}
                        inputService={inputService}
                    />

                    <OverlayContainer
                        ref={overlayContainerRef}
                        state={state}
                        dispatch={dispatch}
                        agent={agent}
                        inputService={inputService}
                    />

                    {/* Footer status line */}
                    <Footer modelName={state.session.modelName} cwd={process.cwd()} />
                </Box>
            </Box>
        </ErrorBoundary>
    );
}

/**
 * Start the modern Ink-based CLI
 * Entry point for the refactored CLI
 * @param agent - The DextoAgent instance
 * @param initialSessionId - The session ID to use for this CLI session
 */
export async function startInkCliRefactored(
    agent: DextoAgent,
    initialSessionId: string | null
): Promise<void> {
    // Use inkMode to let Ctrl+C be handled by the UI for exit warning
    registerGracefulShutdown(() => agent, { inkMode: true });

    // Note: Console suppression is done in index.ts before calling this function
    const startupInfo = await getStartupInfo(agent);

    const inkApp = render(
        <InkCLIRefactored
            agent={agent}
            initialSessionId={initialSessionId}
            startupInfo={startupInfo}
        />,
        {
            // Disable default Ctrl+C exit to handle it ourselves with double-press warning
            exitOnCtrlC: false,
            // Use alternate buffer + incremental rendering for flicker-free updates
            alternateBuffer: true,
            incrementalRendering: true,
        }
    );

    // Wait for the Ink app to exit before resolving
    // This ensures console suppression remains active until the UI is fully closed
    await inkApp.waitUntilExit();
}

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

import { useReducer, useMemo, useEffect, useRef, useCallback } from 'react';
import { Box, render } from 'ink';
import type { Key } from 'ink';
import type { DextoAgent } from '@dexto/core';
import { registerGracefulShutdown } from '../../utils/graceful-shutdown.js';

// State management
import { cliReducer, createInitialState, type StartupInfo } from './state/index.js';

// Custom hooks
import { useAgentEvents, useInputOrchestrator } from './hooks/index.js';

// Services
import { InputService, MessageService } from './services/index.js';

// Utils
import { getStartupInfo, convertHistoryToUIMessages } from './utils/messageFormatting.js';

// Components
import { ChatView } from './components/chat/ChatView.js';
import { ErrorBoundary } from './components/ErrorBoundary.js';
import { StatusBar } from './components/StatusBar.js';

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

    // Main input handler - routes to InputContainer
    const inputHandler = useCallback((input: string, key: Key): boolean => {
        return inputContainerRef.current?.handleInput(input, key) ?? false;
    }, []);

    // Setup unified input orchestrator (replaces useKeyboardShortcuts)
    useInputOrchestrator({
        state,
        dispatch,
        agent,
        handlers: {
            approval: approvalHandler,
            overlay: overlayHandler,
            input: inputHandler,
        },
    });

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

    // Detect overlays based on input (with guards to prevent infinite loop)
    // Debounced to prevent excessive re-renders during fast typing
    useEffect(() => {
        // Don't detect overlays if processing or approval is active
        if (state.ui.isProcessing || state.approval) return;

        // Debounce overlay detection to prevent flickering during fast typing
        const timeoutId = setTimeout(() => {
            const autocompleteType = inputService.detectAutocompleteType(state.input.value);
            const selectorType = inputService.detectInteractiveSelector(state.input.value);

            // Determine what overlay should be shown
            let desiredOverlay: typeof state.ui.activeOverlay = 'none';

            // Priority: selector > autocomplete
            // Map selector types to overlay types
            switch (selectorType) {
                case 'model':
                    desiredOverlay = 'model-selector';
                    break;
                case 'session':
                    desiredOverlay = 'session-selector';
                    break;
                case 'mcp':
                    desiredOverlay = 'mcp-selector';
                    break;
                case 'mcp-add':
                    desiredOverlay = 'mcp-add-selector';
                    break;
                case 'mcp-remove':
                    desiredOverlay = 'mcp-remove-selector';
                    break;
                case 'log':
                    desiredOverlay = 'log-level-selector';
                    break;
                case 'session-subcommand':
                    desiredOverlay = 'session-subcommand-selector';
                    break;
                case 'none':
                    // Fall through to autocomplete detection
                    switch (autocompleteType) {
                        case 'slash':
                            desiredOverlay = 'slash-autocomplete';
                            break;
                        case 'resource':
                            desiredOverlay = 'resource-autocomplete';
                            break;
                    }
                    break;
            }

            // Only dispatch if overlay needs to change
            if (
                desiredOverlay !== state.ui.activeOverlay &&
                state.ui.activeOverlay !== 'approval'
            ) {
                if (desiredOverlay === 'none') {
                    dispatch({ type: 'CLOSE_OVERLAY' });
                } else {
                    dispatch({ type: 'SHOW_OVERLAY', overlay: desiredOverlay });
                }
            }
        }, 50); // 50ms debounce - fast enough to feel responsive, slow enough to prevent flicker

        return () => clearTimeout(timeoutId);
    }, [
        state.input.value,
        state.ui.isProcessing,
        state.approval,
        state.ui.activeOverlay,
        inputService,
        dispatch,
    ]);

    // Get visible messages (performance optimization)
    // Limit to last 30 messages to prevent scrolling issues
    const visibleMessages = useMemo(() => {
        return messageService.getVisibleMessages(state.messages, 30);
    }, [state.messages, messageService]);

    return (
        <ErrorBoundary>
            <Box flexDirection="column" minHeight={0}>
                {/* Chat area (header + messages) - takes available space but can shrink */}
                <ChatView
                    messages={visibleMessages}
                    modelName={state.session.modelName}
                    sessionId={state.session.id || undefined}
                    hasActiveSession={state.session.hasActiveSession}
                    startupInfo={startupInfo}
                />

                {/* Status bar - shows processing state above input */}
                <StatusBar
                    isProcessing={state.ui.isProcessing}
                    isThinking={state.ui.isThinking}
                    approvalQueueCount={state.approvalQueue.length}
                    exitWarningShown={state.ui.exitWarningShown}
                />

                {/* Input area */}
                <InputContainer
                    ref={inputContainerRef}
                    state={state}
                    dispatch={dispatch}
                    agent={agent}
                    inputService={inputService}
                />

                {/* Overlays (approval, selectors, autocomplete) - displayed below input */}
                <OverlayContainer
                    ref={overlayContainerRef}
                    state={state}
                    dispatch={dispatch}
                    agent={agent}
                    inputService={inputService}
                />
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
        }
    );

    // Wait for the Ink app to exit before resolving
    // This ensures console suppression remains active until the UI is fully closed
    await inkApp.waitUntilExit();
}

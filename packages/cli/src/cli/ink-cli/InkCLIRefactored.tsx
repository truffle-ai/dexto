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

import { useReducer, useMemo, useEffect, useState } from 'react';
import { Box, render } from 'ink';
import type { DextoAgent } from '@dexto/core';
import { registerGracefulShutdown } from '../../utils/graceful-shutdown.js';

// State management
import { cliReducer, createInitialState, type StartupInfo } from './state/index.js';

// Custom hooks
import { useAgentEvents, useInputHistory, useKeyboardShortcuts } from './hooks/index.js';

// Services
import { InputService, MessageService } from './services/index.js';

// Utils
import { getStartupInfo, convertHistoryToUIMessages } from './utils/messageFormatting.js';

// Components
import { ChatView } from './components/chat/ChatView.js';
import { Footer } from './components/chat/Footer.js';
import { ErrorBoundary } from './components/ErrorBoundary.js';
import { StatusBar } from './components/StatusBar.js';

// Containers
import { InputContainer } from './containers/InputContainer.js';
import { OverlayContainer } from './containers/OverlayContainer.js';

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

    // Setup event bus subscriptions
    useAgentEvents({ agent, dispatch, isCancelling: state.ui.isCancelling });

    // Session is now managed in state - no need for sync hook
    // useSessionSync removed - sessionId is in state from initialization or SESSION_SET actions

    // Setup input history navigation
    useInputHistory({
        inputState: state.input,
        dispatch,
        isActive: !state.ui.isProcessing && !state.approval && state.ui.activeOverlay === 'none',
    });

    // Setup global keyboard shortcuts
    useKeyboardShortcuts({ state, dispatch, agent });

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
    useEffect(() => {
        // Don't detect overlays if processing or approval is active
        if (state.ui.isProcessing || state.approval) return;

        const autocompleteType = inputService.detectAutocompleteType(state.input.value);
        const selectorType = inputService.detectInteractiveSelector(state.input.value);

        // Determine what overlay should be shown
        let desiredOverlay: typeof state.ui.activeOverlay = 'none';

        // Priority: selector > autocomplete
        if (selectorType === 'model') {
            desiredOverlay = 'model-selector';
        } else if (selectorType === 'session') {
            desiredOverlay = 'session-selector';
        } else if (autocompleteType === 'slash') {
            desiredOverlay = 'slash-autocomplete';
        } else if (autocompleteType === 'resource') {
            desiredOverlay = 'resource-autocomplete';
        }

        // Only dispatch if overlay needs to change
        if (desiredOverlay !== state.ui.activeOverlay && state.ui.activeOverlay !== 'approval') {
            if (desiredOverlay === 'none') {
                dispatch({ type: 'CLOSE_OVERLAY' });
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

    // Get visible messages (performance optimization)
    // Limit to last 30 messages to prevent scrolling issues
    const visibleMessages = useMemo(() => {
        return messageService.getVisibleMessages(state.messages, 30);
    }, [state.messages, messageService]);

    return (
        <ErrorBoundary>
            <Box flexDirection="column" height="100%" width="100%">
                {/* Chat area (header + messages) */}
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
                />

                {/* Overlays (approval, selectors, autocomplete) */}
                <OverlayContainer
                    state={state}
                    dispatch={dispatch}
                    agent={agent}
                    inputService={inputService}
                />

                {/* Input area */}
                <InputContainer
                    state={state}
                    dispatch={dispatch}
                    agent={agent}
                    inputService={inputService}
                />

                {/* Footer */}
                <Footer />
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
    registerGracefulShutdown(() => agent);

    // Note: Console suppression is done in index.ts before calling this function
    const startupInfo = await getStartupInfo(agent);

    const inkApp = render(
        <InkCLIRefactored
            agent={agent}
            initialSessionId={initialSessionId}
            startupInfo={startupInfo}
        />
    );

    // Wait for the Ink app to exit before resolving
    // This ensures console suppression remains active until the UI is fully closed
    await inkApp.waitUntilExit();
}

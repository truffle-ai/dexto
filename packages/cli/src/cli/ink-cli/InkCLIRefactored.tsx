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

import { useReducer, useMemo, useEffect } from 'react';
import { Box } from 'ink';
import type { DextoAgent } from '@dexto/core';

// State management
import { cliReducer, createInitialState } from './state/index.js';

// Custom hooks
import {
    useAgentEvents,
    useInputHistory,
    useKeyboardShortcuts,
    useSessionSync,
} from './hooks/index.js';

// Services
import { InputService, MessageService } from './services/index.js';

// Components
import { ChatView } from './components/chat/ChatView.js';
import { Footer } from './components/chat/Footer.js';

// Containers
import { InputContainer } from './containers/InputContainer.js';
import { OverlayContainer } from './containers/OverlayContainer.js';

interface InkCLIProps {
    agent: DextoAgent;
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
 */
export function InkCLIRefactored({ agent }: InkCLIProps) {
    // Initialize state with reducer
    const [state, dispatch] = useReducer(cliReducer, undefined, createInitialState);

    // Initialize services (memoized)
    const inputService = useMemo(() => new InputService(), []);
    const messageService = useMemo(() => new MessageService(), []);

    // Setup event bus subscriptions
    useAgentEvents({ agent, dispatch });

    // Setup session synchronization
    useSessionSync({
        agent,
        dispatch,
        messageCount: state.messages.length,
    });

    // Setup input history navigation
    useInputHistory({
        inputState: state.input,
        dispatch,
        isActive: !state.ui.isProcessing && !state.approval && state.ui.activeOverlay === 'none',
    });

    // Setup global keyboard shortcuts
    useKeyboardShortcuts({ state, dispatch, agent });

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

    // Get current model name
    const modelName = agent.getCurrentLLMConfig().model;

    // Get visible messages (performance optimization)
    const visibleMessages = useMemo(() => {
        return messageService.getVisibleMessages(state.messages);
    }, [state.messages, messageService]);

    return (
        <Box flexDirection="column" height="100%" width="100%">
            {/* Chat area (header + messages) */}
            <ChatView
                messages={visibleMessages}
                modelName={modelName}
                sessionId={state.session.id || undefined}
                hasActiveSession={state.session.hasActiveSession}
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
    );
}

/**
 * Start the modern Ink-based CLI
 * Entry point for the refactored CLI
 */
export async function startInkCliRefactored(agent: DextoAgent): Promise<void> {
    const { render } = await import('ink');

    // Minimal initialization
    const { registerGracefulShutdown } = await import('../../utils/graceful-shutdown.js');
    registerGracefulShutdown(() => agent);

    // Suppress console output in ink-cli mode
    console.log = () => {};
    console.error = () => {};
    console.warn = () => {};

    // Render the refactored CLI
    render(<InkCLIRefactored agent={agent} />);
}

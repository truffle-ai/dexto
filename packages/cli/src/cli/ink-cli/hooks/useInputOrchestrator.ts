/**
 * Unified Input Orchestrator
 *
 * Single point of keyboard input handling for the entire ink-cli.
 * Routes keystrokes based on focus state to prevent conflicts.
 *
 * Focus Priority (highest to lowest):
 * 1. Approval prompt (when visible)
 * 2. Active overlay (selector/autocomplete)
 * 3. Global shortcuts (Ctrl+C, Escape - handled specially)
 * 4. Main text input (default)
 */

import type React from 'react';
import { useEffect, useRef, useCallback } from 'react';
import { useInput, useApp, type Key } from 'ink';
import type { CLIState } from '../state/types.js';
import type { CLIAction } from '../state/actions.js';
import type { DextoAgent } from '@dexto/core';

/** Time window for double Ctrl+C to exit (in milliseconds) */
const EXIT_WARNING_TIMEOUT = 3000;

/**
 * Input handler function signature
 * Returns true if the input was consumed, false to continue to next handler
 */
export type InputHandler = (input: string, key: Key) => boolean | void;

/**
 * Handler configuration for the orchestrator
 */
export interface InputHandlers {
    /** Handler for approval prompt (highest priority) */
    approval?: InputHandler;
    /** Handler for active overlay (selector/autocomplete) */
    overlay?: InputHandler;
    /** Handler for main text input (lowest priority) */
    input?: InputHandler;
}

export interface UseInputOrchestratorProps {
    state: CLIState;
    dispatch: React.Dispatch<CLIAction>;
    agent: DextoAgent;
    handlers: InputHandlers;
}

/**
 * Determines the current focus target based on state
 */
type FocusTarget = 'approval' | 'overlay' | 'input';

function getFocusTarget(state: CLIState): FocusTarget {
    // Approval has highest priority
    if (state.approval !== null) {
        return 'approval';
    }

    // Active overlay has next priority
    if (state.ui.activeOverlay !== 'none' && state.ui.activeOverlay !== 'approval') {
        return 'overlay';
    }

    // Default to main input
    return 'input';
}

/**
 * Unified input orchestrator hook
 *
 * This is the ONLY useInput hook in the entire ink-cli.
 * All keyboard handling is routed through this single point.
 */
export function useInputOrchestrator({
    state,
    dispatch,
    agent,
    handlers,
}: UseInputOrchestratorProps): void {
    const { exit } = useApp();

    // Use refs to avoid stale closures in the useInput callback
    const stateRef = useRef(state);
    const handlersRef = useRef(handlers);
    const sessionIdRef = useRef(state.session.id);

    // Keep refs in sync
    useEffect(() => {
        stateRef.current = state;
        handlersRef.current = handlers;
        sessionIdRef.current = state.session.id;
    }, [state, handlers]);

    // Auto-clear exit warning after timeout
    useEffect(() => {
        if (!state.ui.exitWarningShown || !state.ui.exitWarningTimestamp) return;

        const elapsed = Date.now() - state.ui.exitWarningTimestamp;
        const remaining = EXIT_WARNING_TIMEOUT - elapsed;

        if (remaining <= 0) {
            dispatch({ type: 'EXIT_WARNING_CLEAR' });
            return;
        }

        const timer = setTimeout(() => {
            dispatch({ type: 'EXIT_WARNING_CLEAR' });
        }, remaining);

        return () => clearTimeout(timer);
    }, [state.ui.exitWarningShown, state.ui.exitWarningTimestamp, dispatch]);

    // Handle Ctrl+C (special case - handled globally regardless of focus)
    const handleCtrlC = useCallback(() => {
        const currentState = stateRef.current;

        if (currentState.ui.isProcessing) {
            // Cancel the current operation
            const currentSessionId = sessionIdRef.current;
            if (!currentSessionId) {
                // No session - force exit as fallback
                exit();
                return;
            }
            void agent.cancel(currentSessionId).catch(() => {});
            dispatch({ type: 'CANCEL_START' });
            dispatch({ type: 'STREAMING_CANCEL' });
            // Clear exit warning if it was shown
            if (currentState.ui.exitWarningShown) {
                dispatch({ type: 'EXIT_WARNING_CLEAR' });
            }
        } else {
            // Not processing - handle exit with double-press safety
            if (currentState.ui.exitWarningShown) {
                // Second Ctrl+C within timeout - actually exit
                exit();
            } else {
                // First Ctrl+C - show warning
                dispatch({ type: 'EXIT_WARNING_SHOW' });
            }
        }
    }, [agent, dispatch, exit]);

    // Handle Escape (context-aware)
    const handleEscape = useCallback((): boolean => {
        const currentState = stateRef.current;

        // Clear exit warning if shown
        if (currentState.ui.exitWarningShown) {
            dispatch({ type: 'EXIT_WARNING_CLEAR' });
            return true;
        }

        // Cancel processing if active
        if (currentState.ui.isProcessing) {
            const currentSessionId = sessionIdRef.current;
            if (currentSessionId) {
                void agent.cancel(currentSessionId).catch(() => {});
                dispatch({ type: 'CANCEL_START' });
                dispatch({ type: 'STREAMING_CANCEL' });
            }
            return true;
        }

        // Close overlay if active (let the overlay handler deal with specifics)
        if (currentState.ui.activeOverlay !== 'none') {
            // Don't consume - let overlay handler close it with proper cleanup
            return false;
        }

        return false;
    }, [agent, dispatch]);

    // The single useInput hook for the entire application
    useInput((input, key) => {
        const currentState = stateRef.current;
        const currentHandlers = handlersRef.current;

        // === GLOBAL SHORTCUTS (always handled first) ===

        // Ctrl+C: Always handle globally for cancellation/exit
        if (key.ctrl && input === 'c') {
            handleCtrlC();
            return;
        }

        // Escape: Try global handling first
        if (key.escape) {
            if (handleEscape()) {
                return; // Consumed by global handler
            }
            // Fall through to focused component
        }

        // === ROUTE TO FOCUSED COMPONENT ===
        // Handlers return true if they consumed the input, false otherwise.
        // When overlay handlers don't consume input (e.g., backspace while autocomplete shown),
        // we fall through to the main input handler.

        const focusTarget = getFocusTarget(currentState);
        let consumed = false;

        switch (focusTarget) {
            case 'approval':
                if (currentHandlers.approval) {
                    consumed = currentHandlers.approval(input, key) ?? false;
                }
                // Approval always consumes - don't fall through
                break;

            case 'overlay':
                if (currentHandlers.overlay) {
                    consumed = currentHandlers.overlay(input, key) ?? false;
                }
                // If overlay didn't consume, fall through to input handler
                // This allows typing/deleting while autocomplete is shown
                if (!consumed && currentHandlers.input) {
                    // Clear exit warning on any typing (user changed their mind)
                    if (
                        currentState.ui.exitWarningShown &&
                        !key.ctrl &&
                        !key.meta &&
                        !key.escape &&
                        input.length > 0
                    ) {
                        dispatch({ type: 'EXIT_WARNING_CLEAR' });
                    }
                    currentHandlers.input(input, key);
                }
                break;

            case 'input':
                // Clear exit warning on any typing (user changed their mind)
                if (
                    currentState.ui.exitWarningShown &&
                    !key.ctrl &&
                    !key.meta &&
                    !key.escape &&
                    input.length > 0
                ) {
                    dispatch({ type: 'EXIT_WARNING_CLEAR' });
                }

                if (currentHandlers.input) {
                    currentHandlers.input(input, key);
                }
                break;
        }
    });
}

/**
 * Create an input handler for the approval prompt
 */
export interface ApprovalHandlerProps {
    onApprove: (rememberChoice: boolean) => void;
    onDeny: () => void;
    onCancel: () => void;
    selectedOption: 'yes' | 'yes-session' | 'no';
    setSelectedOption: (option: 'yes' | 'yes-session' | 'no') => void;
    isCommandConfirmation: boolean;
}

export function createApprovalInputHandler({
    onApprove,
    onDeny,
    onCancel,
    selectedOption,
    setSelectedOption,
    isCommandConfirmation,
}: ApprovalHandlerProps): InputHandler {
    return (_input: string, key: Key) => {
        if (key.upArrow) {
            // Move up (skip yes-session for command confirmations)
            if (selectedOption === 'yes') {
                setSelectedOption('no');
            } else if (selectedOption === 'yes-session') {
                setSelectedOption('yes');
            } else {
                // no -> yes-session (or yes for command confirmations)
                setSelectedOption(isCommandConfirmation ? 'yes' : 'yes-session');
            }
            return true;
        }

        if (key.downArrow) {
            // Move down (skip yes-session for command confirmations)
            if (selectedOption === 'yes') {
                setSelectedOption(isCommandConfirmation ? 'no' : 'yes-session');
            } else if (selectedOption === 'yes-session') {
                setSelectedOption('no');
            } else {
                setSelectedOption('yes'); // no -> yes (wrap)
            }
            return true;
        }

        if (key.return) {
            // Enter key - confirm selection
            if (selectedOption === 'yes') {
                onApprove(false);
            } else if (selectedOption === 'yes-session') {
                onApprove(true);
            } else {
                onDeny();
            }
            return true;
        }

        if (key.escape) {
            onCancel();
            return true;
        }

        return false;
    };
}

/**
 * Create an input handler for selector components (BaseSelector pattern)
 */
export interface SelectorHandlerProps {
    itemsLength: number;
    selectedIndexRef: React.RefObject<number>;
    onSelectIndex: (index: number) => void;
    onSelect: () => void;
    onClose: () => void;
}

export function createSelectorInputHandler({
    itemsLength,
    selectedIndexRef,
    onSelectIndex,
    onSelect,
    onClose,
}: SelectorHandlerProps): InputHandler {
    return (_input: string, key: Key) => {
        if (itemsLength === 0) return false;

        if (key.upArrow) {
            const currentIndex = selectedIndexRef.current ?? 0;
            const nextIndex = (currentIndex - 1 + itemsLength) % itemsLength;
            onSelectIndex(nextIndex);
            return true;
        }

        if (key.downArrow) {
            const currentIndex = selectedIndexRef.current ?? 0;
            const nextIndex = (currentIndex + 1) % itemsLength;
            onSelectIndex(nextIndex);
            return true;
        }

        if (key.escape) {
            onClose();
            return true;
        }

        if (key.return) {
            onSelect();
            return true;
        }

        return false;
    };
}

/**
 * Create an input handler for autocomplete components
 */
export interface AutocompleteHandlerProps extends SelectorHandlerProps {
    onTab?: () => void;
}

export function createAutocompleteInputHandler({
    itemsLength,
    selectedIndexRef,
    onSelectIndex,
    onSelect,
    onClose,
    onTab,
}: AutocompleteHandlerProps): InputHandler {
    const baseHandler = createSelectorInputHandler({
        itemsLength,
        selectedIndexRef,
        onSelectIndex,
        onSelect,
        onClose,
    });

    return (input: string, key: Key) => {
        // Handle Tab for "load into input" functionality
        if (key.tab && onTab) {
            onTab();
            return true;
        }

        return baseHandler(input, key);
    };
}

/**
 * Create an input handler for the main text input
 */
export interface MainInputHandlerProps {
    value: string;
    cursorPos: number;
    onChange: (value: string) => void;
    setCursorPos: (pos: number) => void;
    onSubmit: (value: string) => void;
    isDisabled: boolean;
    history: string[];
    historyIndex: number;
    onHistoryNavigate?: (direction: 'up' | 'down') => void;
    getLineInfo: (pos: number) => {
        lines: string[];
        lineIndex: number;
        colIndex: number;
        charCount: number;
    };
    getLineStart: (lineIndex: number) => number;
}

export function createMainInputHandler({
    value,
    cursorPos,
    onChange,
    setCursorPos,
    onSubmit,
    isDisabled,
    history,
    historyIndex,
    onHistoryNavigate,
    getLineInfo,
    getLineStart,
}: MainInputHandlerProps): InputHandler {
    return (input: string, key: Key) => {
        if (isDisabled) return false;

        const lines = value.split('\n');
        const isMultiLine = lines.length > 1;
        const { lineIndex, colIndex } = getLineInfo(cursorPos);

        // Newline detection based on actual terminal behavior
        const isCtrlJ = input === '\n';
        const isShiftEnter =
            input === '\\\r' ||
            (key.return && key.shift) ||
            input === '\x1b[13;2u' ||
            input === '\x1bOM';
        const wantsNewline = isCtrlJ || isShiftEnter || (key.return && key.meta);

        if (wantsNewline) {
            const newValue = value.slice(0, cursorPos) + '\n' + value.slice(cursorPos);
            onChange(newValue);
            setCursorPos(cursorPos + 1);
            return true;
        }

        // Enter = submit
        if (key.return) {
            if (value.trim()) {
                onSubmit(value);
            }
            return true;
        }

        // Backspace - delete character before cursor
        const isBackspace = key.backspace || input === '\x7f' || input === '\x08';
        if (isBackspace) {
            if (cursorPos > 0) {
                const newValue = value.slice(0, cursorPos - 1) + value.slice(cursorPos);
                onChange(newValue);
                setCursorPos(cursorPos - 1);
            }
            return true;
        }

        // Delete - delete character at cursor (forward delete)
        if (key.delete) {
            if (cursorPos < value.length) {
                const newValue = value.slice(0, cursorPos) + value.slice(cursorPos + 1);
                onChange(newValue);
            }
            return true;
        }

        // Left arrow
        if (key.leftArrow) {
            setCursorPos(Math.max(0, cursorPos - 1));
            return true;
        }

        // Right arrow
        if (key.rightArrow) {
            setCursorPos(Math.min(value.length, cursorPos + 1));
            return true;
        }

        // Up arrow
        if (key.upArrow) {
            if (isMultiLine && lineIndex > 0) {
                const prevLineStart = getLineStart(lineIndex - 1);
                const prevLineLength = lines[lineIndex - 1]!.length;
                const newCol = Math.min(colIndex, prevLineLength);
                setCursorPos(prevLineStart + newCol);
            } else if (onHistoryNavigate && history.length > 0) {
                onHistoryNavigate('up');
            }
            return true;
        }

        // Down arrow
        if (key.downArrow) {
            if (isMultiLine && lineIndex < lines.length - 1) {
                const nextLineStart = getLineStart(lineIndex + 1);
                const nextLineLength = lines[lineIndex + 1]!.length;
                const newCol = Math.min(colIndex, nextLineLength);
                setCursorPos(nextLineStart + newCol);
            } else if (onHistoryNavigate && historyIndex >= 0) {
                onHistoryNavigate('down');
            }
            return true;
        }

        // Ctrl+A - start of line
        if (key.ctrl && input === 'a') {
            setCursorPos(getLineStart(lineIndex));
            return true;
        }

        // Ctrl+E - end of line
        if (key.ctrl && input === 'e') {
            const lineStart = getLineStart(lineIndex);
            setCursorPos(lineStart + lines[lineIndex]!.length);
            return true;
        }

        // Ctrl+K - delete to end of line
        if (key.ctrl && input === 'k') {
            const lineStart = getLineStart(lineIndex);
            const lineEnd = lineStart + lines[lineIndex]!.length;
            if (cursorPos < lineEnd) {
                onChange(value.slice(0, cursorPos) + value.slice(lineEnd));
            } else if (cursorPos < value.length) {
                onChange(value.slice(0, cursorPos) + value.slice(cursorPos + 1));
            }
            return true;
        }

        // Ctrl+U - delete to start of line
        if (key.ctrl && input === 'u') {
            const lineStart = getLineStart(lineIndex);
            if (cursorPos > lineStart) {
                onChange(value.slice(0, lineStart) + value.slice(cursorPos));
                setCursorPos(lineStart);
            }
            return true;
        }

        // Ctrl+W - delete word
        if (key.ctrl && input === 'w') {
            if (cursorPos > 0) {
                let wordStart = cursorPos - 1;
                while (wordStart > 0 && value[wordStart] === ' ') wordStart--;
                while (
                    wordStart > 0 &&
                    value[wordStart - 1] !== ' ' &&
                    value[wordStart - 1] !== '\n'
                ) {
                    wordStart--;
                }
                onChange(value.slice(0, wordStart) + value.slice(cursorPos));
                setCursorPos(wordStart);
            }
            return true;
        }

        // Regular character input
        if (input && !key.ctrl && !key.meta) {
            const newValue = value.slice(0, cursorPos) + input + value.slice(cursorPos);
            onChange(newValue);
            setCursorPos(cursorPos + input.length);
            return true;
        }

        return false;
    };
}

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
 *
 * Mouse scroll events are handled separately by ScrollProvider.
 */

import type React from 'react';
import { useEffect, useRef, useCallback } from 'react';
import { useApp } from 'ink';
import type { UIState, InputState, SessionState, OverlayType, Message } from '../state/types.js';
import type { ApprovalRequest } from '../components/ApprovalPrompt.js';
import type { DextoAgent, QueuedMessage } from '@dexto/core';
import { useKeypress, type Key as RawKey } from './useKeypress.js';
import { enableMouseEvents, disableMouseEvents } from '../utils/mouse.js';
import type { TextBuffer } from '../components/shared/text-buffer.js';
import { generateMessageId } from '../utils/idGenerator.js';

/** Time window for double Ctrl+C to exit (in milliseconds) */
const EXIT_WARNING_TIMEOUT = 3000;

/**
 * Ink-compatible Key interface
 * Converted from our custom KeypressContext Key
 */
export interface Key {
    upArrow: boolean;
    downArrow: boolean;
    leftArrow: boolean;
    rightArrow: boolean;
    pageUp: boolean;
    pageDown: boolean;
    return: boolean;
    escape: boolean;
    ctrl: boolean;
    shift: boolean;
    meta: boolean;
    tab: boolean;
    backspace: boolean;
    delete: boolean;
    /** True if this input came from a paste operation (bracketed paste) */
    paste: boolean;
}

/**
 * Convert our KeypressContext Key to Ink-compatible Key
 */
function convertKey(rawKey: RawKey): { input: string; key: Key } {
    const key: Key = {
        upArrow: rawKey.name === 'up',
        downArrow: rawKey.name === 'down',
        leftArrow: rawKey.name === 'left',
        rightArrow: rawKey.name === 'right',
        pageUp: rawKey.name === 'pageup',
        pageDown: rawKey.name === 'pagedown',
        return: rawKey.name === 'return' || rawKey.name === 'enter',
        escape: rawKey.name === 'escape',
        ctrl: rawKey.ctrl,
        shift: rawKey.shift,
        meta: rawKey.meta,
        tab: rawKey.name === 'tab',
        backspace: rawKey.name === 'backspace',
        delete: rawKey.name === 'delete',
        paste: rawKey.paste,
    };

    // For insertable characters, use the sequence
    // For named keys like 'a', 'b', use the name
    let input = rawKey.sequence;

    // For Ctrl+letter combinations, use the name (e.g., 'c' for Ctrl+C)
    if (rawKey.ctrl && rawKey.name && rawKey.name.length === 1) {
        input = rawKey.name;
    }

    // For paste events, use the full sequence
    if (rawKey.paste) {
        input = rawKey.sequence;
    }

    return { input, key };
}

/**
 * Input handler function signature
 * Returns true if the input was consumed, false to continue to next handler
 */
export type InputHandler = (input: string, key: Key) => boolean | void;

/**
 * Handler configuration for the orchestrator
 *
 * Note: Main text input is NOT routed through the orchestrator.
 * TextBufferInput handles its own input directly via useKeypress.
 */
export interface InputHandlers {
    /** Handler for approval prompt (highest priority) */
    approval?: InputHandler;
    /** Handler for active overlay (selector/autocomplete) */
    overlay?: InputHandler;
}

export interface UseInputOrchestratorProps {
    ui: UIState;
    approval: ApprovalRequest | null;
    input: InputState;
    session: SessionState;
    /** Queued messages (for cancel handling) */
    queuedMessages: QueuedMessage[];
    /** Text buffer for clearing input on first Ctrl+C */
    buffer: TextBuffer;
    setUi: React.Dispatch<React.SetStateAction<UIState>>;
    setInput: React.Dispatch<React.SetStateAction<InputState>>;
    setMessages: React.Dispatch<React.SetStateAction<Message[]>>;
    setPendingMessages: React.Dispatch<React.SetStateAction<Message[]>>;
    setQueuedMessages: React.Dispatch<React.SetStateAction<QueuedMessage[]>>;
    agent: DextoAgent;
    handlers: InputHandlers;
}

/**
 * Determines the current focus target based on state
 */
type FocusTarget = 'approval' | 'overlay' | 'input';

function getFocusTarget(approval: ApprovalRequest | null, activeOverlay: OverlayType): FocusTarget {
    // Approval has highest priority
    if (approval !== null) {
        return 'approval';
    }

    // Active overlay has next priority
    if (activeOverlay !== 'none' && activeOverlay !== 'approval') {
        return 'overlay';
    }

    // Default to main input
    return 'input';
}

/**
 * Unified input orchestrator hook
 *
 * This is the ONLY keyboard input hook in the entire ink-cli.
 * All keyboard handling is routed through this single point.
 * Mouse events are handled separately by MouseProvider/ScrollProvider.
 */
export function useInputOrchestrator({
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
    handlers,
}: UseInputOrchestratorProps): void {
    const { exit } = useApp();

    // Use refs to avoid stale closures in the callback
    const uiRef = useRef(ui);
    const approvalRef = useRef(approval);
    const inputRef = useRef(input);
    const sessionRef = useRef(session);
    const queuedMessagesRef = useRef(queuedMessages);
    const bufferRef = useRef(buffer);
    const handlersRef = useRef(handlers);

    // Keep refs in sync
    useEffect(() => {
        uiRef.current = ui;
        approvalRef.current = approval;
        inputRef.current = input;
        sessionRef.current = session;
        queuedMessagesRef.current = queuedMessages;
        bufferRef.current = buffer;
        handlersRef.current = handlers;
    }, [ui, approval, input, session, queuedMessages, buffer, handlers]);

    // Auto-clear exit warning after timeout
    useEffect(() => {
        if (!ui.exitWarningShown || !ui.exitWarningTimestamp) return;

        const elapsed = Date.now() - ui.exitWarningTimestamp;
        const remaining = EXIT_WARNING_TIMEOUT - elapsed;

        if (remaining <= 0) {
            setUi((prev) => ({ ...prev, exitWarningShown: false, exitWarningTimestamp: null }));
            return;
        }

        const timer = setTimeout(() => {
            setUi((prev) => ({ ...prev, exitWarningShown: false, exitWarningTimestamp: null }));
        }, remaining);

        return () => clearTimeout(timer);
    }, [ui.exitWarningShown, ui.exitWarningTimestamp, setUi]);

    // Handle Ctrl+C (special case - handled globally regardless of focus)
    // Priority: 1) Clear input if has text, 2) Exit warning/exit
    // Note: Ctrl+C does NOT cancel processing - use Escape for that
    const handleCtrlC = useCallback(() => {
        const currentUi = uiRef.current;
        const currentBuffer = bufferRef.current;

        if (currentBuffer.text.length > 0) {
            // Has input text - clear it AND show exit warning
            // This way: first Ctrl+C clears, second Ctrl+C exits
            currentBuffer.setText('');
            setUi((prev) => ({
                ...prev,
                exitWarningShown: true,
                exitWarningTimestamp: Date.now(),
            }));
        } else {
            // No text - handle exit with double-press safety
            if (currentUi.exitWarningShown) {
                // Second Ctrl+C within timeout - actually exit
                exit();
            } else {
                // First Ctrl+C - show warning
                setUi((prev) => ({
                    ...prev,
                    exitWarningShown: true,
                    exitWarningTimestamp: Date.now(),
                }));
            }
        }
    }, [setUi, exit]);

    // Handle Escape (context-aware)
    const handleEscape = useCallback((): boolean => {
        const currentUi = uiRef.current;
        const currentApproval = approvalRef.current;
        const currentSession = sessionRef.current;
        const currentQueuedMessages = queuedMessagesRef.current;
        const currentBuffer = bufferRef.current;

        // If approval prompt is showing, let it handle escape (don't intercept)
        if (currentApproval !== null) {
            return false;
        }

        // Exit history search mode if active - restore original input
        if (currentUi.historySearch.isActive) {
            const originalInput = currentUi.historySearch.originalInput;
            currentBuffer.setText(originalInput);
            setInput((prev) => ({ ...prev, value: originalInput }));
            setUi((prev) => ({
                ...prev,
                historySearch: {
                    isActive: false,
                    query: '',
                    matchIndex: 0,
                    originalInput: '',
                    lastMatch: '',
                },
            }));
            return true;
        }

        // Clear exit warning if shown
        if (currentUi.exitWarningShown) {
            setUi((prev) => ({ ...prev, exitWarningShown: false, exitWarningTimestamp: null }));
            return true;
        }

        // Cancel processing if active
        if (currentUi.isProcessing) {
            if (currentSession.id) {
                // Cancel current run
                void agent.cancel(currentSession.id).catch(() => {});
                // Clear the queue on server (we'll bring messages to input for editing)
                void agent.clearMessageQueue(currentSession.id).catch(() => {});
            }

            // Finalize any pending messages first (move to messages)
            // Mark running tools as cancelled with error state
            setPendingMessages((pending) => {
                if (pending.length > 0) {
                    const updated = pending.map((msg) => {
                        // Mark running tools as cancelled
                        if (msg.role === 'tool' && msg.toolStatus === 'running') {
                            return {
                                ...msg,
                                toolStatus: 'finished' as const,
                                toolResult: 'Cancelled',
                                isError: true,
                            };
                        }
                        return msg;
                    });
                    setMessages((prev) => [...prev, ...updated]);
                }
                return [];
            });

            setUi((prev) => ({
                ...prev,
                isCancelling: true,
                isProcessing: false,
                isThinking: false,
            }));

            // Add interrupted message
            setMessages((prev) => [
                ...prev,
                {
                    id: generateMessageId('system'),
                    role: 'system',
                    content: 'Interrupted - what should Dexto do next?',
                    timestamp: new Date(),
                },
            ]);

            // If there were queued messages, bring them back to input for editing
            if (currentQueuedMessages.length > 0) {
                // Extract and coalesce text content from all queued messages
                const coalescedText = currentQueuedMessages
                    .map((msg) =>
                        msg.content
                            .filter(
                                (part): part is { type: 'text'; text: string } =>
                                    part.type === 'text'
                            )
                            .map((part) => part.text)
                            .join('\n')
                    )
                    .filter((text) => text.length > 0)
                    .join('\n\n');

                if (coalescedText) {
                    currentBuffer.setText(coalescedText);
                    setInput((prev) => ({ ...prev, value: coalescedText }));
                }

                // Clear the queue state immediately (don't wait for server events)
                setQueuedMessages([]);
            }

            return true;
        }

        // Close overlay if active (let the overlay handler deal with specifics)
        if (currentUi.activeOverlay !== 'none') {
            // Don't consume - let overlay handler close it with proper cleanup
            return false;
        }

        return false;
    }, [agent, setUi, setMessages, setPendingMessages, setInput, setQueuedMessages]);

    // The keypress handler for the entire application
    const handleKeypress = useCallback(
        (rawKey: RawKey) => {
            const currentUi = uiRef.current;
            const currentApproval = approvalRef.current;
            const currentHandlers = handlersRef.current;

            // Convert to Ink-compatible format
            const { input: inputStr, key } = convertKey(rawKey);

            // === COPY MODE HANDLING ===
            // When in copy mode, any key exits copy mode (mouse events re-enabled)
            if (currentUi.copyModeEnabled) {
                setUi((prev) => ({ ...prev, copyModeEnabled: false }));
                enableMouseEvents(); // Re-enable mouse events
                return; // Don't process any other keys while exiting copy mode
            }

            // === GLOBAL SHORTCUTS (always handled first) ===

            // === HISTORY SEARCH MODE HANDLING ===
            if (currentUi.historySearch.isActive) {
                const currentInput = inputRef.current;
                const currentBuffer = bufferRef.current;

                // Helper to find matches (reversed so newest is first)
                const findMatches = (query: string): string[] => {
                    if (!query) return [];
                    const lowerQuery = query.toLowerCase();
                    return currentInput.history
                        .filter((item) => item.toLowerCase().includes(lowerQuery))
                        .reverse();
                };

                // Helper to apply a match to the input buffer and track lastMatch
                const applyMatchAndUpdateState = (query: string, matchIdx: number) => {
                    if (!query) {
                        // No query - restore original
                        const orig = currentUi.historySearch.originalInput;
                        currentBuffer.setText(orig);
                        setInput((prev) => ({ ...prev, value: orig }));
                        return;
                    }

                    const matches = findMatches(query);
                    if (matches.length > 0) {
                        const idx = Math.min(matchIdx, matches.length - 1);
                        const match = matches[idx];
                        if (match) {
                            currentBuffer.setText(match);
                            setInput((prev) => ({ ...prev, value: match }));
                            // Update lastMatch in state
                            setUi((prev) => ({
                                ...prev,
                                historySearch: { ...prev.historySearch, lastMatch: match },
                            }));
                        }
                    }
                    // If no match, keep current buffer content (which has last valid match)
                };

                // Ctrl+E in search mode: cycle to previous (newer) match
                if (key.ctrl && inputStr === 'e') {
                    const matches = findMatches(currentUi.historySearch.query);
                    if (matches.length > 0) {
                        const newIdx = Math.max(0, currentUi.historySearch.matchIndex - 1);
                        setUi((prev) => ({
                            ...prev,
                            historySearch: { ...prev.historySearch, matchIndex: newIdx },
                        }));
                        applyMatchAndUpdateState(currentUi.historySearch.query, newIdx);
                    }
                    return;
                }

                // Ctrl+R in search mode: cycle to next (older) match
                if (key.ctrl && inputStr === 'r') {
                    const matches = findMatches(currentUi.historySearch.query);
                    if (matches.length > 0) {
                        const newIdx = Math.min(
                            currentUi.historySearch.matchIndex + 1,
                            matches.length - 1
                        );
                        setUi((prev) => ({
                            ...prev,
                            historySearch: { ...prev.historySearch, matchIndex: newIdx },
                        }));
                        applyMatchAndUpdateState(currentUi.historySearch.query, newIdx);
                    }
                    return;
                }

                // Enter: Accept current match and exit search mode (input already has match)
                if (key.return) {
                    setUi((prev) => ({
                        ...prev,
                        historySearch: {
                            isActive: false,
                            query: '',
                            matchIndex: 0,
                            originalInput: '',
                            lastMatch: '',
                        },
                    }));
                    return;
                }

                // Backspace: Remove last character from search query
                if (key.backspace || key.delete) {
                    const newQuery = currentUi.historySearch.query.slice(0, -1);
                    setUi((prev) => ({
                        ...prev,
                        historySearch: { ...prev.historySearch, query: newQuery, matchIndex: 0 },
                    }));
                    applyMatchAndUpdateState(newQuery, 0);
                    return;
                }

                // Regular typing: Add to search query
                if (inputStr && !key.ctrl && !key.meta && !key.escape) {
                    const newQuery = currentUi.historySearch.query + inputStr;
                    setUi((prev) => ({
                        ...prev,
                        historySearch: { ...prev.historySearch, query: newQuery, matchIndex: 0 },
                    }));
                    applyMatchAndUpdateState(newQuery, 0);
                    return;
                }

                // Escape is handled by handleEscape, so fall through
            }

            // Ctrl+R: Enter history search mode - save current input
            if (key.ctrl && inputStr === 'r') {
                const currentBuffer = bufferRef.current;
                const currentText = currentBuffer.text;
                setUi((prev) => ({
                    ...prev,
                    historySearch: {
                        isActive: true,
                        query: '',
                        matchIndex: 0,
                        originalInput: currentText,
                        lastMatch: '',
                    },
                }));
                return;
            }

            // Ctrl+S: Toggle copy mode (for text selection in alternate buffer)
            if (key.ctrl && inputStr === 's') {
                setUi((prev) => ({ ...prev, copyModeEnabled: true }));
                disableMouseEvents(); // Disable mouse events so terminal can handle selection
                return;
            }

            // Ctrl+T: Toggle todo list expansion (collapsed shows only current task)
            if (key.ctrl && inputStr === 't') {
                setUi((prev) => ({ ...prev, todoExpanded: !prev.todoExpanded }));
                return;
            }

            // Ctrl+B: Toggle background task panel
            if (key.ctrl && inputStr === 'b') {
                setUi((prev) => ({
                    ...prev,
                    backgroundTasksExpanded: !prev.backgroundTasksExpanded,
                }));
                return;
            }

            // Ctrl+C: Always handle globally for cancellation/exit
            if (key.ctrl && inputStr === 'c') {
                handleCtrlC();
                return;
            }

            // Shift+Tab: Cycle through modes (when not in approval modal)
            // Modes: Normal → Plan Mode → Accept All Edits → Bypass Permissions → Normal
            // Note: When in approval modal for edit/write tools, ApprovalPrompt handles Shift+Tab differently
            if (key.shift && key.tab && !key.ctrl && !key.meta && currentApproval === null) {
                setUi((prev) => {
                    const isNormal =
                        !prev.planModeActive && !prev.autoApproveEdits && !prev.bypassPermissions;

                    // Determine current mode and cycle to next
                    if (isNormal) {
                        // Normal → Plan Mode
                        return {
                            ...prev,
                            planModeActive: true,
                            planModeInitialized: false,
                            autoApproveEdits: false,
                            bypassPermissions: false,
                        };
                    } else if (prev.planModeActive) {
                        // Plan Mode → Accept All Edits
                        return {
                            ...prev,
                            planModeActive: false,
                            planModeInitialized: false,
                            autoApproveEdits: true,
                            bypassPermissions: false,
                        };
                    } else if (prev.autoApproveEdits) {
                        // Accept All Edits → Bypass Permissions
                        return {
                            ...prev,
                            autoApproveEdits: false,
                            bypassPermissions: true,
                        };
                    } else {
                        // Bypass Permissions → Normal
                        return {
                            ...prev,
                            bypassPermissions: false,
                        };
                    }
                });
                return;
            }

            // Determine focus once (used for routing + Escape priority)
            const focusTarget = getFocusTarget(currentApproval, currentUi.activeOverlay);

            // Escape: route to focused component first.
            // - If an approval is showing, Esc must cancel/deny the approval (NOT global interrupt).
            // - Otherwise, allow global Escape handling (cancel run, close overlays, etc.).
            if (key.escape) {
                if (focusTarget === 'approval') {
                    currentHandlers.approval?.(inputStr, key);
                    return;
                }

                if (handleEscape()) {
                    return; // Consumed by global handler
                }
                // Fall through to focused component
            }

            // === ROUTE TO FOCUSED COMPONENT ===
            // Only approval and overlay handlers are routed through the orchestrator.
            // Main text input handles its own keypress directly (via TextBufferInput).

            switch (focusTarget) {
                case 'approval':
                    if (currentHandlers.approval) {
                        currentHandlers.approval(inputStr, key);
                    }
                    // Approval always consumes - main input won't see it
                    break;

                case 'overlay':
                    if (currentHandlers.overlay) {
                        currentHandlers.overlay(inputStr, key);
                    }
                    // Overlay may or may not consume - main input handles independently
                    break;

                case 'input':
                    // No routing needed - TextBufferInput handles its own input
                    // Clear exit warning on any typing (user changed their mind)
                    if (
                        currentUi.exitWarningShown &&
                        !key.ctrl &&
                        !key.meta &&
                        !key.escape &&
                        inputStr.length > 0
                    ) {
                        setUi((prev) => ({
                            ...prev,
                            exitWarningShown: false,
                            exitWarningTimestamp: null,
                        }));
                    }
                    break;
            }
        },
        [handleCtrlC, handleEscape, setUi]
    );

    // Subscribe to keypress events
    useKeypress(handleKeypress, { isActive: true });
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

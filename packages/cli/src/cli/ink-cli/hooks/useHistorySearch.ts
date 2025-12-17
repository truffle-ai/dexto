/**
 * useHistorySearch - Hook for Ctrl+R reverse history search
 *
 * Manages search state and provides handlers for search operations.
 */

import { useCallback, useMemo, type Dispatch, type SetStateAction } from 'react';
import type { InputState, UIState } from '../state/types.js';
import type { TextBuffer } from '../components/shared/text-buffer.js';

interface UseHistorySearchProps {
    ui: UIState;
    input: InputState;
    buffer: TextBuffer;
    setUi: Dispatch<SetStateAction<UIState>>;
    setInput: Dispatch<SetStateAction<InputState>>;
}

interface UseHistorySearchReturn {
    /** Whether search mode is active */
    isActive: boolean;
    /** Current search query */
    query: string;
    /** Current match (or last valid match if no current results) */
    currentMatch: string | null;
    /** Whether there's a match for the current query */
    hasMatch: boolean;
    /** Original input to potentially restore */
    originalInput: string;
    /** Enter search mode */
    enter: () => void;
    /** Exit search mode (keep current input) */
    exit: (showRestoreHint?: boolean) => void;
    /** Cancel search mode (restore original - used by Escape) */
    cancel: () => void;
    /** Update search query */
    updateQuery: (query: string) => void;
    /** Add character to query */
    appendToQuery: (char: string) => void;
    /** Remove last character from query */
    backspace: () => void;
    /** Cycle to next (older) match - Ctrl+R */
    cycleNext: () => void;
    /** Cycle to previous (newer) match - Ctrl+Shift+R */
    cyclePrev: () => void;
    /** Accept current match (for Enter - also exits search mode) */
    accept: () => void;
    /** Handle a keypress - returns true if consumed */
    handleKey: (
        inputStr: string,
        key: {
            ctrl: boolean;
            shift: boolean;
            return: boolean;
            backspace: boolean;
            delete: boolean;
            escape: boolean;
            meta: boolean;
        }
    ) => boolean;
}

/**
 * Find matches in history for a query (reversed so newest is first)
 */
function findMatches(history: string[], query: string): string[] {
    if (!query) return [];
    const lowerQuery = query.toLowerCase();
    return history.filter((item) => item.toLowerCase().includes(lowerQuery)).reverse();
}

/**
 * Hook for managing reverse history search
 */
export function useHistorySearch({
    ui,
    input,
    buffer,
    setUi,
    setInput,
}: UseHistorySearchProps): UseHistorySearchReturn {
    const { historySearch } = ui;
    const { history } = input;

    // Compute current matches and whether we have a match
    const matches = useMemo(
        () => findMatches(history, historySearch.query),
        [history, historySearch.query]
    );

    const hasMatch = matches.length > 0;
    const currentMatch = hasMatch
        ? matches[Math.min(historySearch.matchIndex, matches.length - 1)] || null
        : historySearch.lastMatch || null;

    // Enter search mode
    const enter = useCallback(() => {
        const currentText = buffer.text;
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
    }, [buffer, setUi]);

    // Exit search mode (keep current input)
    const exit = useCallback(() => {
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
    }, [setUi]);

    // Cancel search mode (restore original) - kept for potential future use
    const cancel = useCallback(() => {
        const originalInput = historySearch.originalInput;
        buffer.setText(originalInput);
        setInput((prev) => ({ ...prev, value: originalInput }));
        exit();
    }, [historySearch.originalInput, buffer, setInput, exit]);

    // Apply a match to the input buffer
    const applyMatch = useCallback(
        (match: string | null) => {
            if (match) {
                buffer.setText(match);
                setInput((prev) => ({ ...prev, value: match }));
            }
        },
        [buffer, setInput]
    );

    // Update query and apply resulting match
    const updateQuery = useCallback(
        (newQuery: string) => {
            const newMatches = findMatches(history, newQuery);
            const newHasMatch = newMatches.length > 0;
            const newMatch = newHasMatch ? newMatches[0] : null;

            setUi((prev) => ({
                ...prev,
                historySearch: {
                    ...prev.historySearch,
                    query: newQuery,
                    matchIndex: 0,
                    // Update lastMatch only if we have a new match
                    lastMatch: newMatch || prev.historySearch.lastMatch,
                },
            }));

            // Apply match (or keep last match if no new match)
            if (newMatch) {
                applyMatch(newMatch);
            }
            // If no match, keep whatever is currently in input (the last match)
        },
        [history, setUi, applyMatch]
    );

    // Append character to query
    const appendToQuery = useCallback(
        (char: string) => {
            updateQuery(historySearch.query + char);
        },
        [historySearch.query, updateQuery]
    );

    // Backspace - remove last character
    const backspace = useCallback(() => {
        if (historySearch.query.length > 0) {
            updateQuery(historySearch.query.slice(0, -1));
        }
    }, [historySearch.query, updateQuery]);

    // Cycle to next (older) match - Ctrl+R
    const cycleNext = useCallback(() => {
        if (matches.length === 0) return;

        const newIndex = Math.min(historySearch.matchIndex + 1, matches.length - 1);
        const newMatch = matches[newIndex];

        setUi((prev) => ({
            ...prev,
            historySearch: {
                ...prev.historySearch,
                matchIndex: newIndex,
                lastMatch: newMatch || prev.historySearch.lastMatch,
            },
        }));

        if (newMatch) {
            applyMatch(newMatch);
        }
    }, [matches, historySearch.matchIndex, setUi, applyMatch]);

    // Cycle to previous (newer) match - Ctrl+Shift+R
    const cyclePrev = useCallback(() => {
        if (matches.length === 0) return;

        const newIndex = Math.max(0, historySearch.matchIndex - 1);
        const newMatch = matches[newIndex];

        setUi((prev) => ({
            ...prev,
            historySearch: {
                ...prev.historySearch,
                matchIndex: newIndex,
                lastMatch: newMatch || prev.historySearch.lastMatch,
            },
        }));

        if (newMatch) {
            applyMatch(newMatch);
        }
    }, [matches, historySearch.matchIndex, setUi, applyMatch]);

    // Accept current match and exit
    const accept = useCallback(() => {
        // Input already has the match, just exit
        exit();
    }, [exit]);

    // Handle keypress - returns true if consumed
    const handleKey = useCallback(
        (
            inputStr: string,
            key: {
                ctrl: boolean;
                shift: boolean;
                return: boolean;
                backspace: boolean;
                delete: boolean;
                escape: boolean;
                meta: boolean;
            }
        ): boolean => {
            if (!historySearch.isActive) {
                // Not in search mode - check if Ctrl+R to enter
                if (key.ctrl && inputStr === 'r') {
                    enter();
                    return true;
                }
                return false;
            }

            // In search mode - handle all keys

            // Ctrl+E: cycle to previous (newer) match
            if (key.ctrl && inputStr === 'e') {
                cyclePrev();
                return true;
            }

            // Ctrl+R: cycle to next (older) match
            if (key.ctrl && inputStr === 'r') {
                cycleNext();
                return true;
            }

            // Enter: accept match and exit (keep matched text, don't submit)
            if (key.return) {
                accept();
                return true; // Consume - don't submit
            }

            // Escape: restore original and exit
            if (key.escape) {
                cancel();
                return true;
            }

            // Backspace: remove character from query
            if (key.backspace || key.delete) {
                backspace();
                return true;
            }

            // Regular typing: add to query
            if (inputStr && !key.ctrl && !key.meta) {
                appendToQuery(inputStr);
                return true;
            }

            return true; // Consume other keys while in search mode
        },
        [
            historySearch.isActive,
            enter,
            cycleNext,
            cyclePrev,
            accept,
            cancel,
            backspace,
            appendToQuery,
        ]
    );

    return {
        isActive: historySearch.isActive,
        query: historySearch.query,
        currentMatch,
        hasMatch,
        originalInput: historySearch.originalInput,
        enter,
        exit,
        cancel,
        updateQuery,
        appendToQuery,
        backspace,
        cycleNext,
        cyclePrev,
        accept,
        handleKey,
    };
}

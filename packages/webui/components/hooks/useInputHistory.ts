import { useState, useCallback, useRef } from 'react';

const MAX_HISTORY_SIZE = 100;

/**
 * Hook for managing input history with shell-style navigation.
 *
 * - Up arrow: Navigate to older entries
 * - Down arrow: Navigate to newer entries
 * - History cursor resets when user types new input
 *
 * Similar to Codex CLI's chat_composer_history.rs
 */
export function useInputHistory() {
    // History entries (newest at end)
    const [history, setHistory] = useState<string[]>([]);
    // Current position in history (-1 means not browsing, 0 = newest, length-1 = oldest)
    const [cursor, setCursor] = useState<number>(-1);
    // Track the text that was in input before browsing started
    const savedInputRef = useRef<string>('');
    // Track last recalled text to prevent hijacking normal editing
    const lastRecalledRef = useRef<string | null>(null);

    /**
     * Add a message to history (call after sending)
     */
    const addToHistory = useCallback((text: string) => {
        const trimmed = text.trim();
        if (!trimmed) return;

        setHistory((prev) => {
            // Don't add duplicates of the most recent entry
            if (prev.length > 0 && prev[prev.length - 1] === trimmed) {
                return prev;
            }
            const next = [...prev, trimmed];
            // Limit history size
            if (next.length > MAX_HISTORY_SIZE) {
                next.shift();
            }
            return next;
        });
        // Reset cursor after adding
        setCursor(-1);
        lastRecalledRef.current = null;
    }, []);

    /**
     * Check if we should handle navigation (up/down) vs normal cursor movement.
     * Only handle navigation when:
     * 1. Input is empty, OR
     * 2. Cursor is at position 0 AND text matches last recalled history
     */
    const shouldHandleNavigation = useCallback(
        (currentText: string, cursorPosition: number): boolean => {
            // Empty input - always handle
            if (!currentText) return true;
            // At start of input AND text matches what we recalled
            if (cursorPosition === 0 && lastRecalledRef.current === currentText) {
                return true;
            }
            return false;
        },
        []
    );

    /**
     * Navigate up (older entries)
     * Returns the text to display, or null if at end of history
     */
    const navigateUp = useCallback(
        (currentText: string): string | null => {
            if (history.length === 0) return null;

            // If not currently browsing, save current input and start from newest
            if (cursor === -1) {
                savedInputRef.current = currentText;
                const idx = history.length - 1;
                setCursor(idx);
                const text = history[idx];
                lastRecalledRef.current = text ?? null;
                return text ?? null;
            }

            // Already at oldest entry
            if (cursor === 0) return null;

            // Move to older entry
            const newCursor = cursor - 1;
            setCursor(newCursor);
            const text = history[newCursor];
            lastRecalledRef.current = text ?? null;
            return text ?? null;
        },
        [history, cursor]
    );

    /**
     * Navigate down (newer entries)
     * Returns the text to display, or null if back to current input
     */
    const navigateDown = useCallback((): string | null => {
        // Not browsing
        if (cursor === -1) return null;

        // At newest entry - return to saved input
        if (cursor === history.length - 1) {
            setCursor(-1);
            lastRecalledRef.current = null;
            return savedInputRef.current;
        }

        // Move to newer entry
        const newCursor = cursor + 1;
        setCursor(newCursor);
        const text = history[newCursor];
        lastRecalledRef.current = text ?? null;
        return text ?? null;
    }, [history, cursor]);

    /**
     * Reset history browsing (call when user types)
     */
    const resetCursor = useCallback(() => {
        if (cursor !== -1) {
            setCursor(-1);
            lastRecalledRef.current = null;
        }
    }, [cursor]);

    return {
        history,
        cursor,
        addToHistory,
        navigateUp,
        navigateDown,
        resetCursor,
        shouldHandleNavigation,
        isBrowsing: cursor !== -1,
    };
}

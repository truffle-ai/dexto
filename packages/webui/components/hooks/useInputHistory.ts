import { useState, useCallback, useRef, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { client } from '@/lib/client';
import { queryKeys } from '@/lib/queryKeys';
import { isTextPart } from '../../types';
import type { TextPart } from '../../types';

const MAX_HISTORY_SIZE = 100;

/**
 * Hook to fetch user messages from session history
 */
function useSessionUserMessages(sessionId: string | null) {
    return useQuery({
        queryKey: queryKeys.sessions.history(sessionId ?? ''),
        queryFn: async () => {
            if (!sessionId) return [];
            const response = await client.api.sessions[':sessionId'].history.$get({
                param: { sessionId },
            });
            if (!response.ok) return [];

            const data = await response.json();
            const historyMessages = data.history || [];

            // Extract text content from user messages
            const userTexts: string[] = [];
            for (const msg of historyMessages) {
                if (msg.role !== 'user') continue;
                if (!msg.content || !Array.isArray(msg.content)) continue;

                const textParts = msg.content
                    .filter(isTextPart)
                    .map((part: TextPart) => part.text.trim())
                    .filter((t: string) => t.length > 0);

                if (textParts.length > 0) {
                    userTexts.push(textParts.join('\n'));
                }
            }

            // Deduplicate consecutive entries
            const deduplicated: string[] = [];
            for (const text of userTexts) {
                if (deduplicated.length === 0 || deduplicated[deduplicated.length - 1] !== text) {
                    deduplicated.push(text);
                }
            }

            return deduplicated.slice(-MAX_HISTORY_SIZE);
        },
        enabled: !!sessionId,
        staleTime: 30000, // Consider fresh for 30s
    });
}

/**
 * Hook for managing input history with shell-style navigation.
 *
 * - Up arrow: Navigate to older entries
 * - Down arrow: Navigate to newer entries
 * - History cursor resets when user types new input
 * - Loads previous user messages from session history via TanStack Query
 *
 */
export function useInputHistory(sessionId: string | null) {
    const queryClient = useQueryClient();

    // Fetch historical user messages from session
    const { data: history = [] } = useSessionUserMessages(sessionId);

    // Current position in history (-1 means not browsing, 0 = oldest, length-1 = newest)
    const [cursor, setCursor] = useState<number>(-1);
    // Track the text that was in input before browsing started
    const savedInputRef = useRef<string>('');
    // Track last recalled text to prevent hijacking normal editing
    const lastRecalledRef = useRef<string | null>(null);

    // Reset cursor when session changes
    useEffect(() => {
        setCursor(-1);
        lastRecalledRef.current = null;
        savedInputRef.current = '';
    }, [sessionId]);

    /**
     * Invalidate history cache after sending a message.
     * Call this after successfully sending to refresh the history.
     */
    const invalidateHistory = useCallback(() => {
        if (sessionId) {
            queryClient.invalidateQueries({
                queryKey: queryKeys.sessions.history(sessionId),
            });
        }
    }, [queryClient, sessionId]);

    /**
     * Check if we should handle navigation (up/down) vs normal cursor movement.
     * Only handle navigation when:
     * 1. Input is empty, OR
     * 2. Cursor is at position 0 AND text matches last recalled history
     */
    const shouldHandleNavigation = useCallback(
        (currentText: string, cursorPosition: number): boolean => {
            if (!currentText) return true;
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
        invalidateHistory,
        navigateUp,
        navigateDown,
        resetCursor,
        shouldHandleNavigation,
        isBrowsing: cursor !== -1,
    };
}

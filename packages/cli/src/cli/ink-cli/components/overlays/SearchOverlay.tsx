/**
 * SearchOverlay Component
 * Interactive search overlay with real-time results and navigation
 */

import React, {
    useState,
    useEffect,
    useRef,
    forwardRef,
    useImperativeHandle,
    useCallback,
} from 'react';
import { Box, Text } from 'ink';
import type { Key } from '../../hooks/useInputOrchestrator.js';
import type { DextoAgent } from '@dexto/core';
import type { SearchResult } from '@dexto/core';

export interface SearchOverlayProps {
    isVisible: boolean;
    onClose: () => void;
    onSelectResult?: (result: SearchResult) => void;
    agent: DextoAgent;
}

export interface SearchOverlayHandle {
    handleInput: (input: string, key: Key) => boolean;
}

interface SearchState {
    query: string;
    results: SearchResult[];
    isLoading: boolean;
    selectedIndex: number;
    total: number;
    hasMore: boolean;
    error: string | null;
}

const MAX_VISIBLE_RESULTS = 6;
const SEARCH_DEBOUNCE_MS = 300;

/**
 * Interactive search overlay - search messages across sessions
 */
const SearchOverlay = forwardRef<SearchOverlayHandle, SearchOverlayProps>(function SearchOverlay(
    { isVisible, onClose, onSelectResult, agent },
    ref
) {
    const [state, setState] = useState<SearchState>({
        query: '',
        results: [],
        isLoading: false,
        selectedIndex: 0,
        total: 0,
        hasMore: false,
        error: null,
    });

    const searchTimeoutRef = useRef<NodeJS.Timeout | null>(null);
    const scrollOffset = useRef(0);
    // Monotonic counter to prevent out-of-order async responses from overwriting newer results
    const searchSeqRef = useRef(0);

    // Reset state when becoming visible
    useEffect(() => {
        if (isVisible) {
            setState({
                query: '',
                results: [],
                isLoading: false,
                selectedIndex: 0,
                total: 0,
                hasMore: false,
                error: null,
            });
            scrollOffset.current = 0;
        }
    }, [isVisible]);

    // Debounced search
    const performSearch = useCallback(
        async (query: string) => {
            // Increment sequence to track this request
            const seq = ++searchSeqRef.current;

            if (!query.trim()) {
                setState((prev) => ({
                    ...prev,
                    results: [],
                    total: 0,
                    hasMore: false,
                    isLoading: false,
                    error: null,
                }));
                return;
            }

            setState((prev) => ({ ...prev, isLoading: true, error: null }));

            try {
                const response = await agent.searchMessages(query, { limit: 20 });
                // Only apply results if this is still the latest request
                if (seq !== searchSeqRef.current) return;
                setState((prev) => ({
                    ...prev,
                    results: response.results,
                    total: response.total,
                    hasMore: response.hasMore,
                    isLoading: false,
                    selectedIndex: 0,
                }));
                scrollOffset.current = 0;
            } catch (error) {
                // Only apply error if this is still the latest request
                if (seq !== searchSeqRef.current) return;
                setState((prev) => ({
                    ...prev,
                    results: [],
                    total: 0,
                    hasMore: false,
                    isLoading: false,
                    error: error instanceof Error ? error.message : 'Search failed',
                }));
            }
        },
        [agent]
    );

    // Handle input changes with debounce
    const updateQuery = useCallback(
        (newQuery: string) => {
            setState((prev) => ({ ...prev, query: newQuery }));

            // Clear existing timeout
            if (searchTimeoutRef.current) {
                clearTimeout(searchTimeoutRef.current);
            }

            // Debounce search
            searchTimeoutRef.current = setTimeout(() => {
                void performSearch(newQuery);
            }, SEARCH_DEBOUNCE_MS);
        },
        [performSearch]
    );

    // Cleanup timeout on unmount
    useEffect(() => {
        return () => {
            if (searchTimeoutRef.current) {
                clearTimeout(searchTimeoutRef.current);
            }
        };
    }, []);

    // Handle keyboard input
    useImperativeHandle(
        ref,
        () => ({
            handleInput: (input: string, key: Key): boolean => {
                if (!isVisible) return false;

                // Escape to close
                if (key.escape) {
                    onClose();
                    return true;
                }

                // Enter to select result
                if (key.return && state.results.length > 0) {
                    const selectedResult = state.results[state.selectedIndex];
                    if (selectedResult && onSelectResult) {
                        onSelectResult(selectedResult);
                    }
                    onClose();
                    return true;
                }

                // Arrow up
                if (key.upArrow) {
                    setState((prev) => {
                        const newIndex = Math.max(0, prev.selectedIndex - 1);
                        // Adjust scroll offset if needed
                        if (newIndex < scrollOffset.current) {
                            scrollOffset.current = newIndex;
                        }
                        return { ...prev, selectedIndex: newIndex };
                    });
                    return true;
                }

                // Arrow down
                if (key.downArrow) {
                    setState((prev) => {
                        const newIndex = Math.min(prev.results.length - 1, prev.selectedIndex + 1);
                        // Adjust scroll offset if needed
                        if (newIndex >= scrollOffset.current + MAX_VISIBLE_RESULTS) {
                            scrollOffset.current = newIndex - MAX_VISIBLE_RESULTS + 1;
                        }
                        return { ...prev, selectedIndex: newIndex };
                    });
                    return true;
                }

                // Backspace
                if (key.backspace || key.delete) {
                    updateQuery(state.query.slice(0, -1));
                    return true;
                }

                // Regular character input
                if (input && !key.ctrl && !key.meta) {
                    updateQuery(state.query + input);
                    return true;
                }

                return false;
            },
        }),
        [isVisible, onClose, onSelectResult, state, updateQuery]
    );

    if (!isVisible) return null;

    // Calculate visible results window
    const visibleResults = state.results.slice(
        scrollOffset.current,
        scrollOffset.current + MAX_VISIBLE_RESULTS
    );

    return (
        <Box flexDirection="column" borderStyle="round" borderColor="cyan" paddingX={1}>
            {/* Header */}
            <Box marginBottom={1}>
                <Text bold color="cyan">
                    Search Messages
                </Text>
                {state.total > 0 && (
                    <Text color="gray">
                        {' '}
                        ({state.total} result{state.total !== 1 ? 's' : ''})
                    </Text>
                )}
            </Box>

            {/* Search input */}
            <Box>
                <Text color="cyan">&gt; </Text>
                <Text>{state.query}</Text>
                <Text color="cyan">_</Text>
            </Box>

            {/* Loading indicator */}
            {state.isLoading && (
                <Box marginTop={1}>
                    <Text color="yellowBright">Searching...</Text>
                </Box>
            )}

            {/* Error message */}
            {state.error && (
                <Box marginTop={1}>
                    <Text color="red">{state.error}</Text>
                </Box>
            )}

            {/* Results */}
            {!state.isLoading && state.results.length > 0 && (
                <Box flexDirection="column" marginTop={1}>
                    {visibleResults.map((result, idx) => {
                        const actualIndex = scrollOffset.current + idx;
                        const isSelected = actualIndex === state.selectedIndex;
                        const roleColor =
                            result.message.role === 'user'
                                ? 'blue'
                                : result.message.role === 'assistant'
                                  ? 'green'
                                  : 'yellowBright';

                        return (
                            <Box
                                key={`${result.sessionId}-${result.messageIndex}`}
                                flexDirection="column"
                                paddingLeft={isSelected ? 0 : 2}
                            >
                                <Box>
                                    {isSelected && (
                                        <Text color="cyan" bold>
                                            {'> '}
                                        </Text>
                                    )}
                                    <Text color="gray">{result.sessionId.slice(0, 8)}</Text>
                                    <Text> </Text>
                                    <Text color={roleColor} bold={isSelected}>
                                        [{result.message.role}]
                                    </Text>
                                </Box>
                                <Box paddingLeft={isSelected ? 2 : 0}>
                                    <Text color={isSelected ? 'white' : 'gray'}>
                                        {'  '}
                                        {truncateContext(result.context, 60)}
                                    </Text>
                                </Box>
                            </Box>
                        );
                    })}

                    {/* Scroll indicator */}
                    {state.results.length > MAX_VISIBLE_RESULTS && (
                        <Box marginTop={1}>
                            <Text color="gray">
                                Showing {scrollOffset.current + 1}-
                                {Math.min(
                                    scrollOffset.current + MAX_VISIBLE_RESULTS,
                                    state.results.length
                                )}{' '}
                                of {state.results.length}
                                {state.hasMore ? '+' : ''}
                            </Text>
                        </Box>
                    )}
                </Box>
            )}

            {/* No results message */}
            {!state.isLoading && state.query && state.results.length === 0 && !state.error && (
                <Box marginTop={1}>
                    <Text color="gray">No results found for "{state.query}"</Text>
                </Box>
            )}

            {/* Help text */}
            <Box marginTop={1}>
                <Text color="gray">↑↓ navigate • Enter select • Esc close</Text>
            </Box>
        </Box>
    );
});

/**
 * Truncate context text for display
 */
function truncateContext(context: string, maxLength: number): string {
    // Clean up whitespace
    const cleaned = context.replace(/\s+/g, ' ').trim();
    if (cleaned.length <= maxLength) {
        return cleaned;
    }
    return cleaned.slice(0, maxLength - 3) + '...';
}

export default SearchOverlay;

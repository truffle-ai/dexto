/**
 * Base Selector Component
 * Reusable selector with keyboard navigation for lists
 * Used by ModelSelector and SessionSelector
 */

import {
    useState,
    useEffect,
    useRef,
    useMemo,
    useCallback,
    forwardRef,
    useImperativeHandle,
    type ReactNode,
} from 'react';
import { Box, Text } from 'ink';
import type { Key } from '../../hooks/useInputOrchestrator.js';

export interface BaseSelectorProps<T> {
    items: T[];
    isVisible: boolean;
    isLoading?: boolean;
    selectedIndex: number;
    onSelectIndex: (index: number) => void;
    onSelect: (item: T) => void;
    onClose: () => void;
    formatItem: (item: T, isSelected: boolean) => ReactNode;
    title: string;
    maxVisibleItems?: number;
    loadingMessage?: string;
    emptyMessage?: string;
    borderColor?: string;
    onTab?: (item: T) => void; // Optional Tab key handler
    supportsTab?: boolean; // Whether to show Tab in instructions
    instructionsOverride?: string; // Optional instruction text override
}

export interface BaseSelectorHandle {
    handleInput: (input: string, key: Key) => boolean;
}

/**
 * Generic selector component with keyboard navigation and scrolling
 */
function BaseSelectorInner<T>(
    {
        items,
        isVisible,
        isLoading = false,
        selectedIndex,
        onSelectIndex,
        onSelect,
        onClose,
        formatItem,
        title,
        maxVisibleItems = 8,
        loadingMessage = 'Loading...',
        emptyMessage = 'No items found',
        borderColor = 'cyan',
        onTab,
        supportsTab = false,
        instructionsOverride,
    }: BaseSelectorProps<T>,
    ref: React.Ref<BaseSelectorHandle>
) {
    // Track scroll offset as state, but derive during render when needed
    const [scrollOffsetState, setScrollOffset] = useState(0);
    const selectedIndexRef = useRef(selectedIndex);
    const prevItemsLengthRef = useRef(items.length);

    // Keep ref in sync
    selectedIndexRef.current = selectedIndex;

    // Derive the correct scroll offset during render (no second render needed)
    // This handles both selectedIndex changes from parent AND items length changes
    const scrollOffset = useMemo(() => {
        const itemsChanged = items.length !== prevItemsLengthRef.current;

        // Reset scroll if items changed significantly
        if (itemsChanged && items.length <= maxVisibleItems) {
            return 0;
        }

        let offset = scrollOffsetState;

        // Adjust offset to keep selectedIndex visible
        if (selectedIndex < offset) {
            offset = selectedIndex;
        } else if (selectedIndex >= offset + maxVisibleItems) {
            offset = Math.max(0, selectedIndex - maxVisibleItems + 1);
        }

        // Clamp to valid range
        const maxOffset = Math.max(0, items.length - maxVisibleItems);
        return Math.min(maxOffset, Math.max(0, offset));
    }, [selectedIndex, items.length, maxVisibleItems, scrollOffsetState]);

    // Update refs after render (not during useMemo which can run multiple times)
    useEffect(() => {
        prevItemsLengthRef.current = items.length;
    }, [items.length]);

    // Sync scroll offset state after render if it changed
    // This ensures the stored state is correct for next navigation
    useEffect(() => {
        if (scrollOffset !== scrollOffsetState) {
            setScrollOffset(scrollOffset);
        }
    }, [scrollOffset, scrollOffsetState]);

    // Handle selection change - only updates parent state
    const handleSelectIndex = useCallback(
        (newIndex: number) => {
            selectedIndexRef.current = newIndex;
            onSelectIndex(newIndex);
        },
        [onSelectIndex]
    );

    // Calculate visible items
    const visibleItems = useMemo(() => {
        return items.slice(scrollOffset, scrollOffset + maxVisibleItems);
    }, [items, scrollOffset, maxVisibleItems]);

    // Expose handleInput method via ref
    useImperativeHandle(
        ref,
        () => ({
            handleInput: (_input: string, key: Key): boolean => {
                if (!isVisible) return false;

                // Escape always works, regardless of item count
                if (key.escape) {
                    onClose();
                    return true;
                }

                const itemsLength = items.length;
                if (itemsLength === 0) return false;

                if (key.upArrow) {
                    const nextIndex = (selectedIndexRef.current - 1 + itemsLength) % itemsLength;
                    handleSelectIndex(nextIndex);
                    return true;
                }

                if (key.downArrow) {
                    const nextIndex = (selectedIndexRef.current + 1) % itemsLength;
                    handleSelectIndex(nextIndex);
                    return true;
                }

                if (key.tab && onTab) {
                    const item = items[selectedIndexRef.current];
                    if (item !== undefined) {
                        onTab(item);
                        return true;
                    }
                }

                if (key.return && itemsLength > 0) {
                    const item = items[selectedIndexRef.current];
                    if (item !== undefined) {
                        onSelect(item);
                        return true;
                    }
                }

                return false;
            },
        }),
        [isVisible, items, handleSelectIndex, onClose, onSelect, onTab]
    );

    if (!isVisible) return null;

    if (isLoading) {
        return (
            <Box paddingX={0} paddingY={0}>
                <Text color="gray">{loadingMessage}</Text>
            </Box>
        );
    }

    if (items.length === 0) {
        return (
            <Box paddingX={0} paddingY={0}>
                <Text color="gray">{emptyMessage}</Text>
            </Box>
        );
    }

    // Build instruction text based on features
    const instructions =
        instructionsOverride ??
        (supportsTab
            ? '↑↓ navigate, Tab load, Enter select, Esc close'
            : '↑↓ navigate, Enter select, Esc close');

    return (
        <Box flexDirection="column">
            <Box paddingX={0} paddingY={0}>
                <Text color={borderColor} bold>
                    {title} ({selectedIndex + 1}/{items.length}) - {instructions}
                </Text>
            </Box>
            {visibleItems.map((item, visibleIndex) => {
                const actualIndex = scrollOffset + visibleIndex;
                const isSelected = actualIndex === selectedIndex;

                return (
                    <Box key={actualIndex} paddingX={0} paddingY={0}>
                        {formatItem(item, isSelected)}
                    </Box>
                );
            })}
        </Box>
    );
}

// Export with proper generic type support
export const BaseSelector = forwardRef(BaseSelectorInner) as <T>(
    props: BaseSelectorProps<T> & { ref?: React.Ref<BaseSelectorHandle> }
) => ReturnType<typeof BaseSelectorInner>;

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
import { Box, Text, type Key } from 'ink';

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
        maxVisibleItems = 10,
        loadingMessage = 'Loading...',
        emptyMessage = 'No items found',
        borderColor = 'cyan',
        onTab,
        supportsTab = false,
    }: BaseSelectorProps<T>,
    ref: React.Ref<BaseSelectorHandle>
) {
    const [scrollOffset, setScrollOffset] = useState(0);
    const selectedIndexRef = useRef(selectedIndex);

    // Wrapper to update both parent state and ref synchronously to prevent race conditions
    const handleSelectIndex = useCallback(
        (newIndex: number) => {
            selectedIndexRef.current = newIndex;
            onSelectIndex(newIndex);
        },
        [onSelectIndex]
    );

    // Keep ref in sync with prop changes (e.g., when parent resets selection)
    useEffect(() => {
        selectedIndexRef.current = selectedIndex;
    }, [selectedIndex]);

    // Auto-scroll to keep selected item visible
    useEffect(() => {
        if (selectedIndex < scrollOffset) {
            setScrollOffset(selectedIndex);
        } else if (selectedIndex >= scrollOffset + maxVisibleItems) {
            setScrollOffset(Math.max(0, selectedIndex - maxVisibleItems + 1));
        }
    }, [selectedIndex, scrollOffset, maxVisibleItems]);

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
                <Text dimColor>{loadingMessage}</Text>
            </Box>
        );
    }

    if (items.length === 0) {
        return (
            <Box paddingX={0} paddingY={0}>
                <Text dimColor>{emptyMessage}</Text>
            </Box>
        );
    }

    // Build instruction text based on features
    const instructions = supportsTab
        ? '↑↓ navigate, Tab load, Enter select, Esc close'
        : '↑↓ navigate, Enter select, Esc close';

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

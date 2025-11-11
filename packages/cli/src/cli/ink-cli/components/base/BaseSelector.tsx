/**
 * Base Selector Component
 * Reusable selector with keyboard navigation for lists
 * Used by ModelSelector and SessionSelector
 */

import { useState, useEffect, useRef, useMemo, type ReactNode } from 'react';
import { Box, Text, useInput } from 'ink';

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
}

/**
 * Generic selector component with keyboard navigation and scrolling
 */
export function BaseSelector<T>({
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
}: BaseSelectorProps<T>) {
    const [scrollOffset, setScrollOffset] = useState(0);
    const selectedIndexRef = useRef(0);

    // Keep ref in sync
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

    // Handle keyboard navigation
    useInput(
        (_inputChar, key) => {
            if (!isVisible) return;

            const itemsLength = items.length;
            if (itemsLength === 0) return;

            if (key.upArrow) {
                const nextIndex = (selectedIndexRef.current - 1 + itemsLength) % itemsLength;
                selectedIndexRef.current = nextIndex;
                onSelectIndex(nextIndex);
            }

            if (key.downArrow) {
                const nextIndex = (selectedIndexRef.current + 1) % itemsLength;
                selectedIndexRef.current = nextIndex;
                onSelectIndex(nextIndex);
            }

            if (key.escape) {
                onClose();
            }

            if (key.return && itemsLength > 0) {
                const item = items[selectedIndexRef.current];
                if (item !== undefined) {
                    onSelect(item);
                }
            }
        },
        { isActive: isVisible }
    );

    if (!isVisible) return null;

    if (isLoading) {
        return (
            <Box borderStyle="single" borderColor="gray" paddingX={1} paddingY={1}>
                <Text dimColor>{loadingMessage}</Text>
            </Box>
        );
    }

    if (items.length === 0) {
        return (
            <Box borderStyle="single" borderColor="gray" paddingX={1} paddingY={1}>
                <Text dimColor>{emptyMessage}</Text>
            </Box>
        );
    }

    const hasMoreAbove = scrollOffset > 0;
    const hasMoreBelow = scrollOffset + maxVisibleItems < items.length;

    return (
        <Box
            borderStyle="single"
            borderColor={borderColor}
            flexDirection="column"
            height={Math.min(maxVisibleItems + 3, items.length + 3)}
        >
            <Box paddingX={1} paddingY={0}>
                <Text dimColor>
                    {title} ({selectedIndex + 1}/{items.length}) - ↑↓ to navigate, Enter to select,
                    Esc to close
                </Text>
            </Box>
            {hasMoreAbove && (
                <Box paddingX={1} paddingY={0}>
                    <Text dimColor>... ↑ ({scrollOffset} more above)</Text>
                </Box>
            )}
            {visibleItems.map((item, visibleIndex) => {
                const actualIndex = scrollOffset + visibleIndex;
                const isSelected = actualIndex === selectedIndex;

                return (
                    <Box
                        key={actualIndex}
                        paddingX={1}
                        paddingY={0}
                        backgroundColor={isSelected ? 'yellow' : undefined}
                    >
                        {formatItem(item, isSelected)}
                    </Box>
                );
            })}
            {hasMoreBelow && (
                <Box paddingX={1} paddingY={0}>
                    <Text dimColor>
                        ... ↓ ({items.length - scrollOffset - maxVisibleItems} more below)
                    </Text>
                </Box>
            )}
        </Box>
    );
}

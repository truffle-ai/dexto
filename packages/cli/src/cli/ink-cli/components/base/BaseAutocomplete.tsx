/**
 * Base Autocomplete Component
 * Reusable autocomplete with filtering, scoring, and keyboard navigation
 * Used by SlashCommandAutocomplete and ResourceAutocomplete
 */

import React, { useState, useEffect, useRef, useMemo, type ReactNode } from 'react';
import { Box, Text, useInput } from 'ink';

export interface BaseAutocompleteProps<T> {
    items: T[];
    query: string;
    isVisible: boolean;
    isLoading?: boolean;
    onSelect: (item: T) => void;
    onLoadIntoInput?: (text: string) => void;
    onClose: () => void;
    filterFn: (item: T, query: string) => boolean;
    scoreFn: (item: T, query: string) => number;
    formatItem: (item: T, isSelected: boolean) => ReactNode;
    formatLoadText?: (item: T) => string;
    title: string;
    maxVisibleItems?: number;
    loadingMessage?: string;
    emptyMessage?: string;
    borderColor?: string;
}

/**
 * Generic autocomplete component with filtering, scoring, and keyboard navigation
 */
export function BaseAutocomplete<T>({
    items,
    query,
    isVisible,
    isLoading = false,
    onSelect,
    onLoadIntoInput,
    onClose,
    filterFn,
    scoreFn,
    formatItem,
    formatLoadText,
    title,
    maxVisibleItems = 10,
    loadingMessage = 'Loading...',
    emptyMessage = 'No matches found',
    borderColor = 'cyan',
}: BaseAutocompleteProps<T>) {
    const [selectedIndex, setSelectedIndex] = useState(0);
    const [scrollOffset, setScrollOffset] = useState(0);
    const selectedIndexRef = useRef(0);

    // Keep ref in sync
    useEffect(() => {
        selectedIndexRef.current = selectedIndex;
    }, [selectedIndex]);

    // Filter and sort items
    const filteredItems = useMemo(() => {
        if (!query) return items;
        return items
            .filter((item) => filterFn(item, query))
            .sort((a, b) => {
                const scoreA = scoreFn(a, query);
                const scoreB = scoreFn(b, query);
                return scoreB - scoreA; // Higher score first
            });
    }, [items, query, filterFn, scoreFn]);

    // Reset selection when items change
    useEffect(() => {
        setSelectedIndex(0);
        setScrollOffset(0);
    }, [filteredItems.length]);

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
        return filteredItems.slice(scrollOffset, scrollOffset + maxVisibleItems);
    }, [filteredItems, scrollOffset, maxVisibleItems]);

    // Handle keyboard navigation
    useInput(
        (input, key) => {
            if (!isVisible) return;

            const itemsLength = filteredItems.length;
            if (itemsLength === 0) return;

            if (key.upArrow) {
                setSelectedIndex((prev) => (prev - 1 + itemsLength) % itemsLength);
            }

            if (key.downArrow) {
                setSelectedIndex((prev) => (prev + 1) % itemsLength);
            }

            if (key.escape) {
                onClose();
            }

            // Tab: Load into input for editing
            if (key.tab && onLoadIntoInput && formatLoadText && itemsLength > 0) {
                const item = filteredItems[selectedIndexRef.current];
                if (item) {
                    onLoadIntoInput(formatLoadText(item));
                }
                return;
            }

            // Enter: Select item
            if (key.return && itemsLength > 0) {
                const item = filteredItems[selectedIndexRef.current];
                if (item) {
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
                <Text color="gray">{loadingMessage}</Text>
            </Box>
        );
    }

    if (filteredItems.length === 0) {
        return (
            <Box borderStyle="single" borderColor="gray" paddingX={1} paddingY={1}>
                <Text color="gray">{emptyMessage}</Text>
            </Box>
        );
    }

    const hasMoreAbove = scrollOffset > 0;
    const hasMoreBelow = scrollOffset + maxVisibleItems < filteredItems.length;
    const totalItems = filteredItems.length;

    return (
        <Box
            borderStyle="single"
            borderColor={borderColor}
            flexDirection="column"
            height={Math.min(maxVisibleItems + 3, totalItems + 3)}
        >
            <Box paddingX={1} paddingY={0}>
                <Text color="gray">
                    {title} ({selectedIndex + 1}/{totalItems}) - ↑↓ navigate
                    {onLoadIntoInput && ', Tab load'}
                    {', Enter select, Esc close'}
                </Text>
            </Box>
            {hasMoreAbove && (
                <Box paddingX={1} paddingY={0}>
                    <Text color="gray">... ↑ ({scrollOffset} more above)</Text>
                </Box>
            )}
            {visibleItems.map((item, visibleIndex) => {
                const actualIndex = scrollOffset + visibleIndex;
                const isSelected = actualIndex === selectedIndex;

                return (
                    <Box key={actualIndex} paddingX={1} paddingY={0}>
                        {formatItem(item, isSelected)}
                    </Box>
                );
            })}
            {hasMoreBelow && (
                <Box paddingX={1} paddingY={0}>
                    <Text color="gray">
                        ... ↓ ({totalItems - scrollOffset - maxVisibleItems} more below)
                    </Text>
                </Box>
            )}
        </Box>
    );
}

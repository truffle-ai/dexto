import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Box, Text, useInput } from 'ink';
import type { PromptInfo } from '@dexto/core';
import type { DextoAgent } from '@dexto/core';

interface SlashCommandAutocompleteProps {
    isVisible: boolean;
    searchQuery: string;
    onSelectPrompt: (prompt: PromptInfo) => void;
    onClose: () => void;
    onCreatePrompt?: () => void;
    agent: DextoAgent;
}

interface PromptItem extends PromptInfo {
    // Extended for UI purposes
}

/**
 * Simple fuzzy match - checks if query matches prompt name or description
 */
function matchesQuery(prompt: PromptInfo, query: string): boolean {
    if (!query) return true;
    const lowerQuery = query.toLowerCase();
    const name = prompt.name.toLowerCase();
    const description = (prompt.description || '').toLowerCase();
    const title = (prompt.title || '').toLowerCase();

    return (
        name.includes(lowerQuery) ||
        description.includes(lowerQuery) ||
        title.includes(lowerQuery) ||
        name.startsWith(lowerQuery) // Prioritize prefix matches
    );
}

export default function SlashCommandAutocomplete({
    isVisible,
    searchQuery,
    onSelectPrompt,
    onClose,
    onCreatePrompt,
    agent,
}: SlashCommandAutocompleteProps) {
    const [prompts, setPrompts] = useState<PromptItem[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [selectedIndex, setSelectedIndex] = useState(0);
    const [scrollOffset, setScrollOffset] = useState(0);
    const selectedIndexRef = useRef(0);
    const MAX_VISIBLE_ITEMS = 8; // Number of items visible at once

    // Keep ref in sync
    useEffect(() => {
        selectedIndexRef.current = selectedIndex;
    }, [selectedIndex]);

    // Fetch prompts from agent
    useEffect(() => {
        if (!isVisible) return;

        let cancelled = false;
        setIsLoading(true);

        const fetchPrompts = async () => {
            try {
                const promptSet = await agent.listPrompts();
                const promptList: PromptItem[] = Object.values(promptSet);
                if (!cancelled) {
                    setPrompts(promptList);
                    setIsLoading(false);
                }
            } catch (error) {
                if (!cancelled) {
                    console.error('Failed to fetch prompts:', error);
                    setPrompts([]);
                    setIsLoading(false);
                }
            }
        };

        void fetchPrompts();

        return () => {
            cancelled = true;
        };
    }, [isVisible, agent]);

    // Extract command name from search query (everything after /)
    const commandQuery = useMemo(() => {
        if (!searchQuery.startsWith('/')) return '';
        return searchQuery.slice(1).trim();
    }, [searchQuery]);

    // Filter prompts based on query (no limit - scrolling handles it)
    const filteredPrompts = useMemo(() => {
        if (!commandQuery) {
            // Show all prompts when just "/" is typed
            return prompts;
        }
        return prompts.filter((p) => matchesQuery(p, commandQuery));
    }, [prompts, commandQuery]);

    // Show create option if query doesn't match any prompts
    const showCreateOption = useMemo(() => {
        if (!commandQuery) return true; // Show when just "/"
        return filteredPrompts.length === 0 && commandQuery.length > 0;
    }, [commandQuery, filteredPrompts.length]);

    // Combine items (create option + prompts)
    const combinedItems = useMemo(() => {
        const items: Array<{ kind: 'create' } | { kind: 'prompt'; prompt: PromptItem }> = [];
        if (showCreateOption) {
            items.push({ kind: 'create' });
        }
        filteredPrompts.forEach((prompt) => items.push({ kind: 'prompt', prompt }));
        return items;
    }, [showCreateOption, filteredPrompts]);

    // Reset selected index and scroll when items change
    useEffect(() => {
        setSelectedIndex(0);
        setScrollOffset(0);
    }, [combinedItems.length]);

    // Auto-scroll to keep selected item visible
    useEffect(() => {
        if (selectedIndex < scrollOffset) {
            // Selected item is above visible area, scroll up
            setScrollOffset(selectedIndex);
        } else if (selectedIndex >= scrollOffset + MAX_VISIBLE_ITEMS) {
            // Selected item is below visible area, scroll down
            setScrollOffset(Math.max(0, selectedIndex - MAX_VISIBLE_ITEMS + 1));
        }
    }, [selectedIndex, scrollOffset]);

    // Calculate visible items based on scroll offset
    const visibleItems = useMemo(() => {
        return combinedItems.slice(scrollOffset, scrollOffset + MAX_VISIBLE_ITEMS);
    }, [combinedItems, scrollOffset]);

    // Handle keyboard navigation
    useInput(
        (input, key) => {
            if (!isVisible) return;

            const itemsLength = combinedItems.length;
            if (itemsLength === 0) return;

            switch (key.upArrow) {
                case true:
                    setSelectedIndex((prev) => (prev - 1 + itemsLength) % itemsLength);
                    break;
            }

            switch (key.downArrow) {
                case true:
                    setSelectedIndex((prev) => (prev + 1) % itemsLength);
                    break;
            }

            switch (key.escape) {
                case true:
                    onClose();
                    break;
            }

            // Tab or Enter to select (but only if no arguments typed)
            const hasArguments = commandQuery.includes(' ');
            if ((key.tab || (key.return && !hasArguments)) && itemsLength > 0) {
                const item = combinedItems[selectedIndexRef.current];
                if (!item) return;
                if (item.kind === 'create') {
                    onCreatePrompt?.();
                } else {
                    onSelectPrompt(item.prompt);
                }
            }
        },
        { isActive: isVisible }
    );

    if (!isVisible) return null;

    if (isLoading) {
        return (
            <Box borderStyle="single" borderColor="gray" paddingX={1} paddingY={1}>
                <Text dimColor>Loading commands...</Text>
            </Box>
        );
    }

    if (combinedItems.length === 0) {
        return (
            <Box borderStyle="single" borderColor="gray" paddingX={1} paddingY={1}>
                <Text dimColor>No commands found</Text>
            </Box>
        );
    }

    const hasMoreAbove = scrollOffset > 0;
    const hasMoreBelow = scrollOffset + MAX_VISIBLE_ITEMS < combinedItems.length;
    const totalItems = combinedItems.length;

    return (
        <Box
            borderStyle="single"
            borderColor="cyan"
            flexDirection="column"
            height={MAX_VISIBLE_ITEMS + 3}
        >
            <Box paddingX={1} paddingY={0}>
                <Text dimColor>
                    Commands ({selectedIndex + 1}/{totalItems}) - ↑↓ to navigate, Tab/Enter to
                    select, Esc to close
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

                if (item.kind === 'create') {
                    return (
                        <Box
                            key="create"
                            paddingX={1}
                            paddingY={0}
                            backgroundColor={isSelected ? 'cyan' : undefined}
                        >
                            <Text color={isSelected ? 'black' : 'cyan'} bold>
                                + Create new prompt: /{commandQuery || 'name'}
                            </Text>
                        </Box>
                    );
                }

                const prompt = item.prompt;
                const description = prompt.title || prompt.description || '';
                const argsString =
                    prompt.arguments && prompt.arguments.length > 0
                        ? prompt.arguments
                              .map((arg) => `<${arg.name}${arg.required ? '' : '?'}>`)
                              .join(' ')
                        : '';

                return (
                    <Box
                        key={prompt.name}
                        paddingX={1}
                        paddingY={0}
                        backgroundColor={isSelected ? 'cyan' : undefined}
                        flexDirection="row"
                    >
                        <Text color={isSelected ? 'black' : 'green'} bold>
                            /{prompt.name}
                        </Text>
                        {argsString && (
                            <Text color={isSelected ? 'black' : 'gray'} dimColor={!isSelected}>
                                {' '}
                                {argsString}
                            </Text>
                        )}
                        {description && (
                            <Text color={isSelected ? 'black' : 'gray'} dimColor={!isSelected}>
                                {'    '}
                                {description}
                            </Text>
                        )}
                    </Box>
                );
            })}
            {hasMoreBelow && (
                <Box paddingX={1} paddingY={0}>
                    <Text dimColor>
                        ... ↓ ({totalItems - scrollOffset - MAX_VISIBLE_ITEMS} more below)
                    </Text>
                </Box>
            )}
        </Box>
    );
}

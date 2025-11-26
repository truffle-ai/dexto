import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { Box, Text, useInput } from 'ink';
import type { PromptInfo } from '@dexto/core';
import type { DextoAgent } from '@dexto/core';
import { getAllCommands } from '../../commands/interactive-commands/commands.js';
import type { CommandDefinition } from '../../commands/interactive-commands/command-parser.js';

interface SlashCommandAutocompleteProps {
    isVisible: boolean;
    searchQuery: string;
    onSelectPrompt: (prompt: PromptInfo) => void;
    onSelectSystemCommand?: (command: string) => void;
    onLoadIntoInput?: (command: string) => void; // For Tab - loads command into input
    onClose: () => void;
    onCreatePrompt?: () => void;
    agent: DextoAgent;
}

interface PromptItem extends PromptInfo {
    kind: 'prompt';
}

interface SystemCommandItem {
    kind: 'system';
    name: string;
    description: string;
    category?: string;
    aliases?: string[];
}

/**
 * Get match score for prompt: 0 = no match, 1 = description/title match, 2 = name includes, 3 = name starts with
 */
function getPromptMatchScore(prompt: PromptInfo, query: string): number {
    if (!query) return 3; // Show all when no query
    const lowerQuery = query.toLowerCase();
    const name = prompt.name.toLowerCase();
    const description = (prompt.description || '').toLowerCase();
    const title = (prompt.title || '').toLowerCase();

    // Highest priority: name starts with query
    if (name.startsWith(lowerQuery)) {
        return 3;
    }

    // Second priority: name includes query
    if (name.includes(lowerQuery)) {
        return 2;
    }

    // Lowest priority: description or title includes query
    if (description.includes(lowerQuery) || title.includes(lowerQuery)) {
        return 1;
    }

    return 0; // No match
}

/**
 * Check if prompt matches query (for filtering)
 */
function matchesPromptQuery(prompt: PromptInfo, query: string): boolean {
    return getPromptMatchScore(prompt, query) > 0;
}

type CommandMatchCandidate = Pick<CommandDefinition, 'name' | 'description' | 'aliases'>;

/**
 * Simple fuzzy match - checks if query matches system command name or description
 * Returns a score: 0 = no match, 1 = description match, 2 = alias match, 3 = name includes, 4 = name starts with
 */
function getSystemCommandMatchScore(cmd: CommandMatchCandidate, query: string): number {
    if (!query) return 4; // Show all when no query
    const lowerQuery = query.toLowerCase();
    const name = cmd.name.toLowerCase();
    const description = (cmd.description || '').toLowerCase();

    // Highest priority: name starts with query
    if (name.startsWith(lowerQuery)) {
        return 4;
    }

    // Second priority: name includes query
    if (name.includes(lowerQuery)) {
        return 3;
    }

    // Third priority: aliases match
    if (cmd.aliases) {
        for (const alias of cmd.aliases) {
            const lowerAlias = alias.toLowerCase();
            if (lowerAlias.startsWith(lowerQuery)) {
                return 2;
            }
            if (lowerAlias.includes(lowerQuery)) {
                return 2;
            }
        }
    }

    // Lowest priority: description includes query
    if (description.includes(lowerQuery)) {
        return 1;
    }

    return 0; // No match
}

/**
 * Check if command matches query (for filtering)
 */
function matchesSystemCommandQuery(cmd: CommandMatchCandidate, query: string): boolean {
    return getSystemCommandMatchScore(cmd, query) > 0;
}

export default function SlashCommandAutocomplete({
    isVisible,
    searchQuery,
    onSelectPrompt,
    onSelectSystemCommand,
    onLoadIntoInput,
    onClose,
    onCreatePrompt,
    agent,
}: SlashCommandAutocompleteProps) {
    const [prompts, setPrompts] = useState<PromptItem[]>([]);
    const [systemCommands, setSystemCommands] = useState<SystemCommandItem[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [selectedIndex, setSelectedIndex] = useState(0);
    const [scrollOffset, setScrollOffset] = useState(0);
    const selectedIndexRef = useRef(0);
    const MAX_VISIBLE_ITEMS = 10; // Increased to show more items

    // Wrapper to set both state and ref synchronously to prevent race conditions
    const setSelectedIndexSync = useCallback((newIndex: number | ((prev: number) => number)) => {
        setSelectedIndex((prev) => {
            const resolved = typeof newIndex === 'function' ? newIndex(prev) : newIndex;
            selectedIndexRef.current = resolved;
            return resolved;
        });
    }, []);

    // Fetch prompts and system commands from agent
    useEffect(() => {
        if (!isVisible) return;

        let cancelled = false;
        setIsLoading(true);

        const fetchCommands = async () => {
            try {
                // Fetch prompts
                const promptSet = await agent.listPrompts();
                const promptList: PromptItem[] = Object.values(promptSet).map((p) => ({
                    ...p,
                    kind: 'prompt' as const,
                }));

                // Fetch system commands
                const allCommands = getAllCommands();
                const commandList: SystemCommandItem[] = allCommands.map((cmd) => ({
                    kind: 'system' as const,
                    name: cmd.name,
                    description: cmd.description,
                    ...(cmd.category && { category: cmd.category }),
                    ...(cmd.aliases && { aliases: cmd.aliases }),
                }));

                if (!cancelled) {
                    setPrompts(promptList);
                    setSystemCommands(commandList);
                    setIsLoading(false);
                }
            } catch (error) {
                if (!cancelled) {
                    console.error(
                        `Error in fetchCommands: ${error instanceof Error ? error.message : String(error)}`
                    );
                    setPrompts([]);
                    setSystemCommands([]);
                    setIsLoading(false);
                }
            }
        };

        void fetchCommands();

        return () => {
            cancelled = true;
        };
    }, [isVisible, agent]);

    // Extract command name from search query (only the first word after /)
    const commandQuery = useMemo(() => {
        if (!searchQuery.startsWith('/')) return '';
        const afterSlash = searchQuery.slice(1).trim();
        // Only take the first word (command name), not the arguments
        const spaceIndex = afterSlash.indexOf(' ');
        return spaceIndex > 0 ? afterSlash.slice(0, spaceIndex) : afterSlash;
    }, [searchQuery]);

    // Filter prompts and system commands based on query
    const filteredPrompts = useMemo(() => {
        if (!commandQuery) {
            return prompts;
        }
        // Filter and sort by match score (highest first)
        return prompts
            .filter((p) => matchesPromptQuery(p, commandQuery))
            .sort((a, b) => {
                const scoreA = getPromptMatchScore(a, commandQuery);
                const scoreB = getPromptMatchScore(b, commandQuery);
                return scoreB - scoreA; // Higher score first
            });
    }, [prompts, commandQuery]);

    const filteredSystemCommands = useMemo(() => {
        if (!commandQuery) {
            return systemCommands;
        }
        // Filter and sort by match score (highest first)
        return systemCommands
            .filter((cmd) => matchesSystemCommandQuery(cmd, commandQuery))
            .sort((a, b) => {
                const scoreA = getSystemCommandMatchScore(a, commandQuery);
                const scoreB = getSystemCommandMatchScore(b, commandQuery);
                return scoreB - scoreA; // Higher score first
            });
    }, [systemCommands, commandQuery]);

    // Check if user has started typing arguments (hide autocomplete if so)
    const hasArguments = useMemo(() => {
        if (!searchQuery.startsWith('/')) return false;
        const afterSlash = searchQuery.slice(1).trim();
        return afterSlash.includes(' ');
    }, [searchQuery]);

    // Show create option only if query doesn't match any commands and is a valid prompt name
    const showCreateOption = useMemo(() => {
        if (!commandQuery) return false; // Don't show create when just "/"
        if (hasArguments) return false; // Don't show create when typing arguments
        // Only show create if no matches and query looks like a prompt name (no spaces, valid chars)
        return (
            filteredPrompts.length === 0 &&
            filteredSystemCommands.length === 0 &&
            commandQuery.length > 0
        );
    }, [commandQuery, hasArguments, filteredPrompts.length, filteredSystemCommands.length]);

    // Combine items: system commands first, then prompts, then create option
    // Hide autocomplete if user has started typing arguments
    const combinedItems = useMemo(() => {
        if (hasArguments) {
            return []; // Hide autocomplete when typing arguments
        }

        const items: Array<
            | { kind: 'system'; command: SystemCommandItem }
            | { kind: 'prompt'; prompt: PromptItem }
            | { kind: 'create' }
        > = [];

        // System commands first (they're more commonly used)
        filteredSystemCommands.forEach((cmd) => items.push({ kind: 'system', command: cmd }));

        // Then prompts
        filteredPrompts.forEach((prompt) => items.push({ kind: 'prompt', prompt }));

        // Create option last
        if (showCreateOption) {
            items.push({ kind: 'create' });
        }

        return items;
    }, [hasArguments, showCreateOption, filteredPrompts, filteredSystemCommands]);

    // Reset selected index and scroll when items change
    useEffect(() => {
        setSelectedIndexSync(0);
        setScrollOffset(0);
    }, [combinedItems.length, setSelectedIndexSync]);

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

            if (key.upArrow) {
                setSelectedIndexSync((prev) => (prev - 1 + itemsLength) % itemsLength);
            }

            if (key.downArrow) {
                setSelectedIndexSync((prev) => (prev + 1) % itemsLength);
            }

            if (key.escape) {
                onClose();
            }

            // Tab: Load command into input (for editing before execution)
            if (key.tab && itemsLength > 0) {
                const item = combinedItems[selectedIndexRef.current];
                if (!item) return;
                if (item.kind === 'create') {
                    // For create, load the command name into input
                    onLoadIntoInput?.(`/${commandQuery || 'name'}`);
                } else if (item.kind === 'system') {
                    // Load system command into input
                    onLoadIntoInput?.(`/${item.command.name}`);
                } else {
                    // Load prompt command into input
                    const argsString =
                        item.prompt.arguments && item.prompt.arguments.length > 0
                            ? ' ' +
                              item.prompt.arguments
                                  .map((arg) => `<${arg.name}${arg.required ? '' : '?'}>`)
                                  .join(' ')
                            : '';
                    onLoadIntoInput?.(`/${item.prompt.name}${argsString}`);
                }
                return;
            }

            // Enter: Always execute the highlighted command/prompt
            if (key.return && itemsLength > 0) {
                const item = combinedItems[selectedIndexRef.current];
                if (!item) return;
                if (item.kind === 'create') {
                    onCreatePrompt?.();
                } else if (item.kind === 'system') {
                    onSelectSystemCommand?.(item.command.name);
                } else {
                    onSelectPrompt(item.prompt);
                }
            }
        },
        { isActive: isVisible }
    );

    if (!isVisible) return null;

    // Hide autocomplete when user is typing arguments
    if (hasArguments) return null;

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
            height={Math.min(MAX_VISIBLE_ITEMS + 3, totalItems + 3)}
        >
            <Box paddingX={1} paddingY={0}>
                <Text dimColor>
                    Commands ({selectedIndex + 1}/{totalItems}) - ↑↓ to navigate, Tab to load, Enter
                    to execute, Esc to close
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
                            backgroundColor={isSelected ? 'yellow' : undefined}
                        >
                            <Text color={isSelected ? 'black' : 'gray'} bold={isSelected}>
                                + Create new prompt: /{commandQuery || 'name'}
                            </Text>
                        </Box>
                    );
                }

                if (item.kind === 'system') {
                    const cmd = item.command;
                    return (
                        <Box
                            key={`system-${cmd.name}`}
                            paddingX={1}
                            paddingY={0}
                            backgroundColor={isSelected ? 'yellow' : undefined}
                            flexDirection="row"
                        >
                            <Text color={isSelected ? 'black' : 'gray'} bold={isSelected}>
                                /{cmd.name}
                            </Text>
                            {cmd.description && (
                                <Text color={isSelected ? 'black' : 'gray'} dimColor={!isSelected}>
                                    {'    '}
                                    {cmd.description}
                                </Text>
                            )}
                            {cmd.category && (
                                <Text color={isSelected ? 'black' : 'gray'} dimColor={!isSelected}>
                                    {' '}
                                    ({cmd.category})
                                </Text>
                            )}
                        </Box>
                    );
                }

                // Prompt command
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
                        key={`prompt-${prompt.name}`}
                        paddingX={1}
                        paddingY={0}
                        backgroundColor={isSelected ? 'yellow' : undefined}
                        flexDirection="row"
                    >
                        <Text color={isSelected ? 'black' : 'gray'} bold={isSelected}>
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

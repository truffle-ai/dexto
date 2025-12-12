import React, {
    useState,
    useEffect,
    useRef,
    useMemo,
    useCallback,
    forwardRef,
    useImperativeHandle,
} from 'react';
import { Box, Text, useStdout } from 'ink';
import type { Key } from '../hooks/useInputOrchestrator.js';
import type { PromptInfo } from '@dexto/core';
import type { DextoAgent } from '@dexto/core';
import { getAllCommands } from '../../commands/interactive-commands/commands.js';
import type { CommandDefinition } from '../../commands/interactive-commands/command-parser.js';

export interface SlashCommandAutocompleteHandle {
    handleInput: (input: string, key: Key) => boolean;
}

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

/**
 * Truncate text to fit within maxLength, adding ellipsis if truncated
 */
function truncateText(text: string, maxLength: number): string {
    if (text.length <= maxLength) return text;
    if (maxLength <= 3) return text.slice(0, maxLength);
    return text.slice(0, maxLength - 1) + '…';
}

/**
 * Inner component - wrapped with React.memo below
 */
const SlashCommandAutocompleteInner = forwardRef<
    SlashCommandAutocompleteHandle,
    SlashCommandAutocompleteProps
>(function SlashCommandAutocomplete(
    {
        isVisible,
        searchQuery,
        onSelectPrompt,
        onSelectSystemCommand,
        onLoadIntoInput,
        onClose,
        onCreatePrompt,
        agent,
    },
    ref
) {
    const [prompts, setPrompts] = useState<PromptItem[]>([]);
    const [systemCommands, setSystemCommands] = useState<SystemCommandItem[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    // Combined state to guarantee single render on navigation
    const [selection, setSelection] = useState({ index: 0, offset: 0 });
    const selectedIndexRef = useRef(0);
    const { stdout } = useStdout();
    const terminalWidth = stdout?.columns || 80;
    const MAX_VISIBLE_ITEMS = 8;

    // Update selection AND scroll offset in a single state update
    // This guarantees exactly one render per navigation action
    const updateSelection = useCallback(
        (indexUpdater: number | ((prev: number) => number)) => {
            setSelection((prev) => {
                const newIndex =
                    typeof indexUpdater === 'function' ? indexUpdater(prev.index) : indexUpdater;
                selectedIndexRef.current = newIndex;

                // Calculate new scroll offset
                let newOffset = prev.offset;
                if (newIndex < prev.offset) {
                    newOffset = newIndex;
                } else if (newIndex >= prev.offset + MAX_VISIBLE_ITEMS) {
                    newOffset = Math.max(0, newIndex - MAX_VISIBLE_ITEMS + 1);
                }

                return { index: newIndex, offset: newOffset };
            });
        },
        [MAX_VISIBLE_ITEMS]
    );

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
            } catch {
                if (!cancelled) {
                    // Silently fail - don't use console.error as it interferes with Ink rendering
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

    // Get stable identity for first item (used to detect content changes)
    const getFirstItemId = (): string | null => {
        const first = combinedItems[0];
        if (!first) return null;
        if (first.kind === 'system') return `sys:${first.command.name}`;
        if (first.kind === 'prompt') return `prompt:${first.prompt.name}`;
        return 'create';
    };

    // Track items for reset detection (length + first item identity)
    const currentFirstId = getFirstItemId();
    const prevItemsRef = useRef({ length: combinedItems.length, firstId: currentFirstId });
    const itemsChanged =
        combinedItems.length !== prevItemsRef.current.length ||
        currentFirstId !== prevItemsRef.current.firstId;

    // Derive clamped selection values during render (always valid, no setState needed)
    // This prevents the double-render that was causing flickering
    const selectedIndex = itemsChanged
        ? 0
        : Math.min(selection.index, Math.max(0, combinedItems.length - 1));
    const scrollOffset = itemsChanged
        ? 0
        : Math.min(selection.offset, Math.max(0, combinedItems.length - MAX_VISIBLE_ITEMS));

    // Sync state only when items actually changed AND state differs
    // This effect runs AFTER render, updating state for next user interaction
    useEffect(() => {
        if (itemsChanged) {
            prevItemsRef.current = { length: combinedItems.length, firstId: currentFirstId };
            // Only setState if values actually differ (prevents unnecessary re-render)
            if (selection.index !== 0 || selection.offset !== 0) {
                selectedIndexRef.current = 0;
                setSelection({ index: 0, offset: 0 });
            } else {
                selectedIndexRef.current = 0;
            }
        }
    }, [itemsChanged, combinedItems.length, currentFirstId, selection.index, selection.offset]);

    // Calculate visible items based on scroll offset
    const visibleItems = useMemo(() => {
        return combinedItems.slice(scrollOffset, scrollOffset + MAX_VISIBLE_ITEMS);
    }, [combinedItems, scrollOffset, MAX_VISIBLE_ITEMS]);

    // Expose handleInput method via ref
    useImperativeHandle(
        ref,
        () => ({
            handleInput: (input: string, key: Key): boolean => {
                if (!isVisible) return false;

                // Escape always closes, regardless of item count
                if (key.escape) {
                    onClose();
                    return true;
                }

                const itemsLength = combinedItems.length;

                // If no items or arguments being typed, don't consume input
                // Let it fall through to the main input handler
                if (itemsLength === 0 || hasArguments) {
                    return false;
                }

                if (key.upArrow) {
                    updateSelection((prev) => (prev - 1 + itemsLength) % itemsLength);
                    return true;
                }

                if (key.downArrow) {
                    updateSelection((prev) => (prev + 1) % itemsLength);
                    return true;
                }

                // Tab: For interactive commands (model, resume, switch), execute them like Enter
                // For other commands, load into input for editing
                if (key.tab) {
                    const item = combinedItems[selectedIndexRef.current];
                    if (!item) return false;

                    // Check if this is an interactive command that should be executed
                    const interactiveCommands = ['model', 'resume', 'switch'];
                    const isInteractiveCommand =
                        item.kind === 'system' && interactiveCommands.includes(item.command.name);

                    if (isInteractiveCommand && item.kind === 'system') {
                        // Execute interactive command (same as Enter)
                        onSelectSystemCommand?.(item.command.name);
                    } else if (item.kind === 'create') {
                        // For create, load the command name into input
                        onLoadIntoInput?.(`/${commandQuery || 'name'}`);
                    } else if (item.kind === 'system') {
                        // Load system command into input
                        onLoadIntoInput?.(`/${item.command.name}`);
                    } else {
                        // Load prompt command into input (use displayName for user-friendly display)
                        const promptDisplayName = item.prompt.displayName || item.prompt.name;
                        const argsString =
                            item.prompt.arguments && item.prompt.arguments.length > 0
                                ? ' ' +
                                  item.prompt.arguments
                                      .map((arg) => `<${arg.name}${arg.required ? '' : '?'}>`)
                                      .join(' ')
                                : '';
                        onLoadIntoInput?.(`/${promptDisplayName}${argsString}`);
                    }
                    return true;
                }

                // Enter: Always execute the highlighted command/prompt
                if (key.return) {
                    const item = combinedItems[selectedIndexRef.current];
                    if (!item) return false;
                    if (item.kind === 'create') {
                        onCreatePrompt?.();
                    } else if (item.kind === 'system') {
                        onSelectSystemCommand?.(item.command.name);
                    } else {
                        onSelectPrompt(item.prompt);
                    }
                    return true;
                }

                // Don't consume other keys (typing, backspace, etc.)
                // Let them fall through to the input handler
                return false;
            },
        }),
        [
            isVisible,
            combinedItems,
            hasArguments,
            selectedIndexRef,
            commandQuery,
            onClose,
            onLoadIntoInput,
            onSelectPrompt,
            onSelectSystemCommand,
            onCreatePrompt,
            updateSelection,
        ]
    );

    if (!isVisible) return null;

    // Hide autocomplete when user is typing arguments
    if (hasArguments) return null;

    if (isLoading) {
        return (
            <Box width={terminalWidth} paddingX={0} paddingY={0}>
                <Text dimColor>Loading commands...</Text>
            </Box>
        );
    }

    if (combinedItems.length === 0) {
        return (
            <Box width={terminalWidth} paddingX={0} paddingY={0}>
                <Text dimColor>No commands found</Text>
            </Box>
        );
    }

    const totalItems = combinedItems.length;

    return (
        <Box flexDirection="column" width={terminalWidth}>
            <Box paddingX={0} paddingY={0}>
                <Text color="purple" bold>
                    Commands ({selectedIndex + 1}/{totalItems}) - ↑↓ navigate, Tab load, Enter
                    execute, Esc close
                </Text>
            </Box>
            {visibleItems.map((item, visibleIndex) => {
                const actualIndex = scrollOffset + visibleIndex;
                const isSelected = actualIndex === selectedIndex;

                if (item.kind === 'create') {
                    const createText = `+ Create new prompt: /${commandQuery || 'name'}`;
                    return (
                        <Box key="create" width={terminalWidth} paddingX={0} paddingY={0}>
                            <Text color={isSelected ? 'green' : 'gray'} bold={isSelected}>
                                {truncateText(createText, terminalWidth)}
                            </Text>
                        </Box>
                    );
                }

                if (item.kind === 'system') {
                    const cmd = item.command;
                    const nameText = `/${cmd.name}`;
                    const categoryText = cmd.category ? ` (${cmd.category})` : '';
                    const descText = cmd.description || '';

                    // Two-line layout like Claude Code:
                    // Line 1: /command-name
                    // Line 2:     Description text (category)
                    return (
                        <Box key={`system-${cmd.name}`} flexDirection="column" paddingX={0}>
                            <Text color={isSelected ? 'cyan' : 'gray'} bold={isSelected}>
                                {nameText}
                            </Text>
                            <Text color={isSelected ? 'white' : 'gray'} dimColor={!isSelected}>
                                {'    '}
                                {descText}
                                {categoryText}
                            </Text>
                        </Box>
                    );
                }

                // Prompt command (MCP prompts)
                const prompt = item.prompt;
                // Use displayName for user-friendly display, fall back to full name
                const displayName = prompt.displayName || prompt.name;
                const nameText = `/${displayName}`;
                const argsString =
                    prompt.arguments && prompt.arguments.length > 0
                        ? ' ' +
                          prompt.arguments
                              .map((arg) => `<${arg.name}${arg.required ? '' : '?'}>`)
                              .join(' ')
                        : '';
                const description = prompt.title || prompt.description || '';

                // Two-line layout like Claude Code:
                // Line 1: /command-name <args>
                // Line 2:     Description text (mcp)
                const commandText = nameText + argsString;

                return (
                    <Box key={`prompt-${prompt.name}`} flexDirection="column" paddingX={0}>
                        <Text color={isSelected ? 'cyan' : 'gray'} bold={isSelected}>
                            {commandText}
                        </Text>
                        <Text color={isSelected ? 'white' : 'gray'} dimColor={!isSelected}>
                            {'    '}
                            {description}
                            {' (mcp)'}
                        </Text>
                    </Box>
                );
            })}
        </Box>
    );
});

/**
 * Export with React.memo to prevent unnecessary re-renders from parent
 * Only re-renders when props actually change (shallow comparison)
 */
export const SlashCommandAutocomplete = React.memo(
    SlashCommandAutocompleteInner
) as typeof SlashCommandAutocompleteInner;

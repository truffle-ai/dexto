import React, {
    useState,
    useEffect,
    useRef,
    useMemo,
    useCallback,
    forwardRef,
    useImperativeHandle,
} from 'react';
import { Box, Text } from 'ink';
import type { Key } from '../hooks/useInputOrchestrator.js';
import type { PromptInfo } from '@dexto/core';
import type { DextoAgent } from '@dexto/core';
import { getAllCommands } from '../../commands/interactive-commands/commands.js';
import type { CommandDefinition } from '../../commands/interactive-commands/command-parser.js';
import { useTerminalSize } from '../hooks/useTerminalSize.js';
import { getMaxVisibleItemsForTerminalRows } from '../utils/overlaySizing.js';

export interface SlashCommandAutocompleteHandle {
    handleInput: (input: string, key: Key) => boolean;
}

interface SlashCommandAutocompleteProps {
    isVisible: boolean;
    searchQuery: string;
    onSelectPrompt: (prompt: PromptInfo) => void;
    onSelectSystemCommand?: (command: string) => void;
    onLoadIntoInput?: (command: string) => void; // For Tab - loads command into input
    onSubmitRaw?: ((text: string) => Promise<void> | void) | undefined; // For Enter with no matches - submit raw text
    onClose: () => void;
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
        onSubmitRaw,
        onClose,
        agent,
    },
    ref
) {
    const [prompts, setPrompts] = useState<PromptItem[]>([]);
    const [systemCommands, setSystemCommands] = useState<SystemCommandItem[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const { columns: terminalWidth, rows: terminalRows } = useTerminalSize();
    const maxVisibleItems = useMemo(() => {
        return getMaxVisibleItemsForTerminalRows({
            rows: terminalRows,
            hardCap: 8,
            reservedRows: 8,
        });
    }, [terminalRows]);

    // Combined state to guarantee single render on navigation
    const [selection, setSelection] = useState({ index: 0, offset: 0 });
    const selectedIndexRef = useRef(0);

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
                } else if (newIndex >= prev.offset + maxVisibleItems) {
                    newOffset = Math.max(0, newIndex - maxVisibleItems + 1);
                }

                return { index: newIndex, offset: newOffset };
            });
        },
        [maxVisibleItems]
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

    // Check if user has started typing arguments (hide autocomplete)
    const hasArguments = useMemo(() => {
        if (!searchQuery.startsWith('/')) return false;
        const afterSlash = searchQuery.slice(1).trim();
        return afterSlash.includes(' ');
    }, [searchQuery]);

    // Combine items: system commands first, then prompts
    // When typing arguments, show only exact matches (for argument hints)
    const combinedItems = useMemo(() => {
        const items: Array<
            { kind: 'system'; command: SystemCommandItem } | { kind: 'prompt'; prompt: PromptItem }
        > = [];

        if (hasArguments) {
            // When typing arguments, only show exact match for the command
            const exactSystemCmd = systemCommands.find(
                (cmd) => cmd.name.toLowerCase() === commandQuery.toLowerCase()
            );
            if (exactSystemCmd) {
                items.push({ kind: 'system', command: exactSystemCmd });
            }
            const exactPrompt = prompts.find(
                (p) =>
                    p.name.toLowerCase() === commandQuery.toLowerCase() ||
                    (p.displayName && p.displayName.toLowerCase() === commandQuery.toLowerCase())
            );
            if (exactPrompt) {
                items.push({ kind: 'prompt', prompt: exactPrompt });
            }
            return items;
        }

        // System commands first (they're more commonly used)
        filteredSystemCommands.forEach((cmd) => items.push({ kind: 'system', command: cmd }));

        // Then prompts
        filteredPrompts.forEach((prompt) => items.push({ kind: 'prompt', prompt }));

        return items;
    }, [
        hasArguments,
        filteredPrompts,
        filteredSystemCommands,
        systemCommands,
        prompts,
        commandQuery,
    ]);

    // Get stable identity for first item (used to detect content changes)
    const getFirstItemId = (): string | null => {
        const first = combinedItems[0];
        if (!first) return null;
        if (first.kind === 'system') return `sys:${first.command.name}`;
        return `prompt:${first.prompt.name}`;
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
        : Math.min(selection.offset, Math.max(0, combinedItems.length - maxVisibleItems));

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
        return combinedItems.slice(scrollOffset, scrollOffset + maxVisibleItems);
    }, [combinedItems, scrollOffset, maxVisibleItems]);

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

                // Handle Enter when no matches or typing arguments
                // Submit raw text directly (main input won't handle it since overlay is active)
                if (itemsLength === 0 || hasArguments) {
                    if (key.return) {
                        void Promise.resolve(onSubmitRaw?.(searchQuery)).catch((err) => {
                            const message = err instanceof Error ? err.message : String(err);
                            agent.logger.error(
                                `SlashCommandAutocomplete: Failed to submit raw command: ${message}`
                            );
                        });
                        onClose();
                        return true;
                    }
                    // Let other keys (typing, backspace) fall through
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
                    } else if (item.kind === 'system') {
                        // Load system command into input
                        onLoadIntoInput?.(`/${item.command.name}`);
                    } else {
                        // Load prompt command into input using pre-computed commandName
                        // commandName is collision-resolved by PromptManager (e.g., "plan" or "config:plan")
                        const cmdName =
                            item.prompt.commandName || item.prompt.displayName || item.prompt.name;
                        const argsString =
                            item.prompt.arguments && item.prompt.arguments.length > 0
                                ? ' ' +
                                  item.prompt.arguments
                                      .map((arg) => `<${arg.name}${arg.required ? '' : '?'}>`)
                                      .join(' ')
                                : '';
                        onLoadIntoInput?.(`/${cmdName}${argsString}`);
                    }
                    return true;
                }

                // Enter: Execute the highlighted command/prompt and close overlay
                if (key.return) {
                    const item = combinedItems[selectedIndexRef.current];
                    if (!item) return false;
                    if (item.kind === 'system') {
                        onSelectSystemCommand?.(item.command.name);
                    } else {
                        onSelectPrompt(item.prompt);
                    }
                    onClose();
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
            searchQuery,
            onClose,
            onLoadIntoInput,
            onSubmitRaw,
            onSelectPrompt,
            onSelectSystemCommand,
            updateSelection,
            agent,
        ]
    );

    if (!isVisible) return null;

    // Show loading state while fetching commands
    if (isLoading) {
        return (
            <Box width={terminalWidth} paddingX={0} paddingY={0}>
                <Text color="gray">Loading commands...</Text>
            </Box>
        );
    }

    // If no items after loading, don't render
    if (combinedItems.length === 0) {
        return null;
    }

    const nameColumnWidth = Math.max(16, Math.min(28, Math.floor(terminalWidth * 0.32)));
    const descriptionColor = (isSelected: boolean) => (isSelected ? 'white' : 'gray');
    const commandColor = (isSelected: boolean) => (isSelected ? 'cyan' : 'gray');

    return (
        <Box flexDirection="column" width={terminalWidth}>
            {visibleItems.map((item, visibleIndex) => {
                const actualIndex = scrollOffset + visibleIndex;
                const isSelected = actualIndex === selectedIndex;

                if (item.kind === 'system') {
                    const cmd = item.command;
                    const nameText = `/${cmd.name}`;
                    const descText = cmd.description || '';

                    return (
                        <Box key={`system-${cmd.name}`} flexDirection="row">
                            <Box marginRight={1}>
                                <Text color={commandColor(isSelected)}>
                                    {isSelected ? '❯' : ' '}
                                </Text>
                            </Box>
                            <Box width={nameColumnWidth}>
                                <Text
                                    wrap="truncate-end"
                                    color={commandColor(isSelected)}
                                    bold={isSelected}
                                >
                                    {nameText}
                                </Text>
                            </Box>
                            <Box flexGrow={1} minWidth={0}>
                                <Text wrap="truncate-end" color={descriptionColor(isSelected)}>
                                    {descText}
                                </Text>
                            </Box>
                        </Box>
                    );
                }

                // Prompt command (MCP prompts)
                const prompt = item.prompt;
                // Use displayName for user-friendly display, fall back to full name
                const displayName = prompt.displayName || prompt.name;
                // Check if there's a collision (commandName includes source prefix)
                const hasCollision = prompt.commandName && prompt.commandName !== displayName;
                const nameText = `/${displayName}`;
                const argsString =
                    prompt.arguments && prompt.arguments.length > 0
                        ? ' ' +
                          prompt.arguments
                              .map((arg) => `<${arg.name}${arg.required ? '' : '?'}>`)
                              .join(' ')
                        : '';
                const description = prompt.title || prompt.description || '';

                const commandText = nameText + argsString;
                const collisionSuffix = hasCollision ? ` (use /${prompt.commandName})` : '';

                return (
                    <Box key={`prompt-${prompt.name}`} flexDirection="row">
                        <Box marginRight={1}>
                            <Text color={commandColor(isSelected)}>{isSelected ? '❯' : ' '}</Text>
                        </Box>
                        <Box width={nameColumnWidth}>
                            <Text
                                wrap="truncate-end"
                                color={commandColor(isSelected)}
                                bold={isSelected}
                            >
                                {commandText}
                            </Text>
                        </Box>
                        <Box flexGrow={1} minWidth={0}>
                            <Text wrap="truncate-end" color={descriptionColor(isSelected)}>
                                {description}
                                {collisionSuffix}
                            </Text>
                        </Box>
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

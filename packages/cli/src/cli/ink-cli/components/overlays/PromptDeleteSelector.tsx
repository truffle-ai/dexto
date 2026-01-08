/**
 * PromptDeleteSelector Component
 * Shows list of deletable prompts (config and shared only, not MCP)
 */

import React, {
    useState,
    useEffect,
    forwardRef,
    useRef,
    useImperativeHandle,
    useMemo,
} from 'react';
import { Box, Text } from 'ink';
import type { Key } from '../../hooks/useInputOrchestrator.js';
import type { DextoAgent, PromptInfo } from '@dexto/core';
import { BaseSelector, type BaseSelectorHandle } from '../base/BaseSelector.js';

export interface DeletablePrompt {
    prompt: PromptInfo;
    sourceType: 'config' | 'shared';
    filePath?: string | undefined;
}

interface PromptDeleteSelectorProps {
    isVisible: boolean;
    onDelete: (prompt: DeletablePrompt) => void;
    onClose: () => void;
    agent: DextoAgent;
}

export interface PromptDeleteSelectorHandle {
    handleInput: (input: string, key: Key) => boolean;
}

/**
 * Check if a prompt is from commands directory (shared)
 */
function isSharedPrompt(prompt: PromptInfo): boolean {
    const metadata = prompt.metadata as { filePath?: string } | undefined;
    if (metadata?.filePath) {
        return (
            metadata.filePath.includes('/commands/') ||
            metadata.filePath.includes('/.dexto/commands/')
        );
    }
    return false;
}

/**
 * Get file path from prompt metadata
 */
function getFilePath(prompt: PromptInfo): string | undefined {
    const metadata = prompt.metadata as { filePath?: string } | undefined;
    return metadata?.filePath;
}

/**
 * PromptDeleteSelector - shows deletable prompts
 */
const PromptDeleteSelector = forwardRef<PromptDeleteSelectorHandle, PromptDeleteSelectorProps>(
    function PromptDeleteSelector({ isVisible, onDelete, onClose, agent }, ref) {
        const baseSelectorRef = useRef<BaseSelectorHandle>(null);
        const [selectedIndex, setSelectedIndex] = useState(0);
        const [deletablePrompts, setDeletablePrompts] = useState<DeletablePrompt[]>([]);
        const [isLoading, setIsLoading] = useState(true);

        // Forward handleInput to BaseSelector
        useImperativeHandle(
            ref,
            () => ({
                handleInput: (input: string, key: Key): boolean => {
                    return baseSelectorRef.current?.handleInput(input, key) ?? false;
                },
            }),
            []
        );

        // Load deletable prompts when becoming visible
        useEffect(() => {
            if (isVisible) {
                setIsLoading(true);
                setSelectedIndex(0);

                agent
                    .listPrompts()
                    .then((promptSet) => {
                        // Filter to only deletable prompts (config and shared, not MCP)
                        const prompts = Object.values(promptSet);
                        const deletable: DeletablePrompt[] = [];

                        for (const prompt of prompts) {
                            // Skip MCP prompts - they can't be deleted
                            if (prompt.source === 'mcp') continue;

                            const filePath = getFilePath(prompt);
                            const isShared = isSharedPrompt(prompt);

                            // Config prompts (inline or file-based in agent dir)
                            if (prompt.source === 'config' && !isShared) {
                                deletable.push({
                                    prompt,
                                    sourceType: 'config',
                                    filePath,
                                });
                            }
                            // Shared prompts (from commands directory)
                            else if (prompt.source === 'config' && isShared) {
                                deletable.push({
                                    prompt,
                                    sourceType: 'shared',
                                    filePath,
                                });
                            }
                            // Custom prompts (DB-stored)
                            else if (prompt.source === 'custom') {
                                deletable.push({
                                    prompt,
                                    sourceType: 'config', // Treat as config for deletion purposes
                                });
                            }
                        }

                        // Sort: config first, then shared
                        deletable.sort((a, b) => {
                            if (a.sourceType !== b.sourceType) {
                                return a.sourceType === 'config' ? -1 : 1;
                            }
                            const aName = a.prompt.displayName || a.prompt.name;
                            const bName = b.prompt.displayName || b.prompt.name;
                            return aName.localeCompare(bName);
                        });

                        setDeletablePrompts(deletable);
                        setIsLoading(false);
                    })
                    .catch(() => {
                        setDeletablePrompts([]);
                        setIsLoading(false);
                    });
            }
        }, [isVisible, agent]);

        // Format item for display
        const formatItem = (item: DeletablePrompt, isSelected: boolean) => {
            const displayName = item.prompt.displayName || item.prompt.name;
            const sourceLabel = item.sourceType === 'shared' ? 'shared' : 'config';
            const sourceColor = item.sourceType === 'shared' ? 'magenta' : 'blue';

            return (
                <Box>
                    <Text color={isSelected ? 'red' : 'white'} bold={isSelected}>
                        {displayName}
                    </Text>
                    {item.prompt.title && <Text color="gray"> - {item.prompt.title}</Text>}
                    <Text color={sourceColor}> ({sourceLabel})</Text>
                </Box>
            );
        };

        // Handle selection
        const handleSelect = (item: DeletablePrompt) => {
            onDelete(item);
        };

        // Build items with info message if empty
        const items = useMemo(() => {
            return deletablePrompts;
        }, [deletablePrompts]);

        // Custom empty message
        const emptyMessage = 'No deletable prompts found.\nMCP prompts cannot be deleted.';

        return (
            <Box flexDirection="column">
                <BaseSelector
                    ref={baseSelectorRef}
                    items={items}
                    isVisible={isVisible}
                    isLoading={isLoading}
                    selectedIndex={selectedIndex}
                    onSelectIndex={setSelectedIndex}
                    onSelect={handleSelect}
                    onClose={onClose}
                    formatItem={formatItem}
                    title="Delete Prompt"
                    borderColor="red"
                    emptyMessage={emptyMessage}
                    maxVisibleItems={10}
                />
                {isVisible && !isLoading && items.length > 0 && (
                    <Box marginTop={1}>
                        <Text color="gray" italic>
                            Note: MCP prompts cannot be deleted (they come from servers)
                        </Text>
                    </Box>
                )}
            </Box>
        );
    }
);

export default PromptDeleteSelector;

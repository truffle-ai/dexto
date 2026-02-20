/**
 * PromptList Component
 * Shows list of all prompts with Add/Delete actions
 * Main screen of /prompts command
 */

import React, {
    useState,
    useEffect,
    forwardRef,
    useRef,
    useImperativeHandle,
    useMemo,
    useCallback,
} from 'react';
import { Box, Text } from 'ink';
import type { Key } from '../../hooks/useInputOrchestrator.js';
import type { DextoAgent, PromptInfo } from '@dexto/core';
import { BaseSelector, type BaseSelectorHandle } from '../base/BaseSelector.js';

export type PromptListAction =
    | { type: 'select-prompt'; prompt: PromptInfo }
    | { type: 'add-prompt' }
    | { type: 'delete-prompt' };

interface PromptListProps {
    isVisible: boolean;
    onAction: (action: PromptListAction) => void;
    onLoadIntoInput: (text: string) => void;
    onClose: () => void;
    agent: DextoAgent;
}

export interface PromptListHandle {
    handleInput: (input: string, key: Key) => boolean;
    refresh: () => void;
}

interface ListItem {
    id: string;
    type: 'prompt' | 'add' | 'delete';
    prompt?: PromptInfo;
}

/**
 * Get source indicator for display
 */
function getSourceIndicator(source: string): { icon: string; label: string; color: string } {
    switch (source) {
        case 'config':
            return { icon: '📄', label: 'config', color: 'blue' };
        case 'custom':
            return { icon: '✨', label: 'custom', color: 'magenta' };
        case 'mcp':
            return { icon: '🔌', label: 'mcp', color: 'green' };
        default:
            return { icon: '📝', label: source, color: 'gray' };
    }
}

/**
 * Check if a prompt is from commands directory (shared)
 */
function isSharedPrompt(prompt: PromptInfo): boolean {
    const metadata = prompt.metadata as { filePath?: string } | undefined;
    if (metadata?.filePath) {
        // Normalize path separators for cross-platform compatibility (Windows uses \)
        const normalizedPath = metadata.filePath.replaceAll('\\', '/');
        return (
            normalizedPath.includes('/commands/') || normalizedPath.includes('/.dexto/commands/')
        );
    }
    return false;
}

/**
 * PromptList - shows all prompts with Add/Delete actions
 */
const PromptList = forwardRef<PromptListHandle, PromptListProps>(function PromptList(
    { isVisible, onAction, onLoadIntoInput, onClose, agent },
    ref
) {
    const baseSelectorRef = useRef<BaseSelectorHandle>(null);
    const [selectedIndex, setSelectedIndex] = useState(0);
    const [prompts, setPrompts] = useState<PromptInfo[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [refreshKey, setRefreshKey] = useState(0);

    // Load prompts function
    const loadPrompts = useCallback(() => {
        setIsLoading(true);
        setSelectedIndex(0);

        agent
            .listPrompts()
            .then((promptSet) => {
                // Convert PromptSet to array and sort
                const promptList = Object.values(promptSet);

                // Sort: config first, then custom, then mcp
                promptList.sort((a, b) => {
                    const order = { config: 0, custom: 1, mcp: 2 };
                    const aOrder = order[a.source] ?? 3;
                    const bOrder = order[b.source] ?? 3;
                    if (aOrder !== bOrder) return aOrder - bOrder;
                    // Within same source, sort alphabetically
                    return (a.displayName || a.name).localeCompare(b.displayName || b.name);
                });

                setPrompts(promptList);
                setIsLoading(false);
            })
            .catch((err) => {
                agent.logger.error(
                    `PromptList: Failed to load prompts: ${err instanceof Error ? err.message : String(err)}`
                );
                setPrompts([]);
                setIsLoading(false);
            });
    }, [agent]);

    // Forward handleInput and refresh to ref
    useImperativeHandle(
        ref,
        () => ({
            handleInput: (input: string, key: Key): boolean => {
                return baseSelectorRef.current?.handleInput(input, key) ?? false;
            },
            refresh: () => {
                setRefreshKey((k) => k + 1);
            },
        }),
        []
    );

    // Load prompts when becoming visible or refreshKey changes
    useEffect(() => {
        if (isVisible) {
            loadPrompts();
        }
    }, [isVisible, refreshKey, loadPrompts]);

    // Build list items: prompts + Add/Delete actions
    const items = useMemo<ListItem[]>(() => {
        return [
            // Action items at the top
            { id: '__add__', type: 'add' as const },
            { id: '__delete__', type: 'delete' as const },
            // Prompts list
            ...prompts.map((prompt) => ({
                id: prompt.name,
                type: 'prompt' as const,
                prompt,
            })),
        ];
    }, [prompts]);

    // Format item for display
    const formatItem = (item: ListItem, isSelected: boolean) => {
        if (item.type === 'add') {
            return (
                <Box>
                    <Text color={isSelected ? 'green' : 'gray'} bold={isSelected}>
                        + Add new prompt
                    </Text>
                </Box>
            );
        }

        if (item.type === 'delete') {
            return (
                <Box>
                    <Text color={isSelected ? 'red' : 'gray'} bold={isSelected}>
                        - Delete a prompt
                    </Text>
                </Box>
            );
        }

        // Prompt item
        const prompt = item.prompt!;
        const displayName = prompt.displayName || prompt.name;
        // For plugin skills, use namespace (plugin name) as source
        const metadata = prompt.metadata as Record<string, unknown> | undefined;
        const effectiveSource = metadata?.namespace ? String(metadata.namespace) : prompt.source;
        const sourceInfo = getSourceIndicator(effectiveSource);
        const isShared = isSharedPrompt(prompt);
        const sourceLabel = isShared ? 'shared' : sourceInfo.label;

        return (
            <Box>
                <Text color={isSelected ? 'cyan' : 'white'} bold={isSelected}>
                    {displayName}
                </Text>
                {prompt.title && <Text color="gray"> - {prompt.title}</Text>}
                <Text color={sourceInfo.color}> ({sourceLabel})</Text>
            </Box>
        );
    };

    // Handle selection
    const handleSelect = (item: ListItem) => {
        if (item.type === 'add') {
            onAction({ type: 'add-prompt' });
        } else if (item.type === 'delete') {
            onAction({ type: 'delete-prompt' });
        } else if (item.prompt) {
            onAction({ type: 'select-prompt', prompt: item.prompt });
        }
    };

    // Handle Tab to load into input
    const handleTab = (item: ListItem) => {
        if (item.type === 'prompt' && item.prompt) {
            const displayName = item.prompt.displayName || item.prompt.name;
            onLoadIntoInput(`/${displayName} `);
        }
    };

    return (
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
            onTab={handleTab}
            supportsTab={true}
            title="Prompts"
            borderColor="yellowBright"
            emptyMessage="No prompts configured"
            maxVisibleItems={12}
        />
    );
});

export default PromptList;

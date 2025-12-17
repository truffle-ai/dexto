/**
 * ModelSelector Component (Refactored)
 * Features:
 * - Search filtering
 * - Custom models support (add/delete)
 * - Keyboard shortcuts: Shift+D to delete custom model
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
import { logger, type DextoAgent, type LLMProvider } from '@dexto/core';
import { loadCustomModels, deleteCustomModel, type CustomModel } from '@dexto/agent-management';

interface ModelSelectorProps {
    isVisible: boolean;
    onSelectModel: (provider: LLMProvider, model: string, baseURL?: string) => void;
    onClose: () => void;
    onAddCustomModel: () => void;
    agent: DextoAgent;
}

export interface ModelSelectorHandle {
    handleInput: (input: string, key: Key) => boolean;
}

interface ModelOption {
    provider: LLMProvider;
    name: string;
    displayName: string | undefined;
    maxInputTokens: number;
    isDefault: boolean;
    isCurrent: boolean;
    isCustom: boolean;
    baseURL?: string;
}

// Special option for adding custom model
interface AddCustomOption {
    type: 'add-custom';
}

type SelectorItem = ModelOption | AddCustomOption;

function isAddCustomOption(item: SelectorItem): item is AddCustomOption {
    return 'type' in item && item.type === 'add-custom';
}

const MAX_VISIBLE_ITEMS = 10;

/**
 * Model selector with search and custom model support
 */
const ModelSelector = forwardRef<ModelSelectorHandle, ModelSelectorProps>(function ModelSelector(
    { isVisible, onSelectModel, onClose, onAddCustomModel, agent },
    ref
) {
    const [models, setModels] = useState<ModelOption[]>([]);
    const [customModels, setCustomModels] = useState<CustomModel[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [selectedIndex, setSelectedIndex] = useState(0);
    const [searchQuery, setSearchQuery] = useState('');
    const [scrollOffset, setScrollOffset] = useState(0);
    const [pendingDeleteModel, setPendingDeleteModel] = useState<string | null>(null);
    const selectedIndexRef = useRef(selectedIndex);
    const deleteTimeoutRef = useRef<NodeJS.Timeout | null>(null);

    // Keep ref in sync
    selectedIndexRef.current = selectedIndex;

    // Clear delete confirmation timeout on unmount
    useEffect(() => {
        return () => {
            if (deleteTimeoutRef.current) {
                clearTimeout(deleteTimeoutRef.current);
            }
        };
    }, []);

    // Fetch models from agent and load custom models
    useEffect(() => {
        if (!isVisible) return;

        let cancelled = false;
        setIsLoading(true);
        setSearchQuery('');
        setSelectedIndex(0);
        setScrollOffset(0);
        setPendingDeleteModel(null);
        if (deleteTimeoutRef.current) {
            clearTimeout(deleteTimeoutRef.current);
            deleteTimeoutRef.current = null;
        }

        const fetchModels = async () => {
            try {
                const [allModels, providers, currentConfig, loadedCustomModels] = await Promise.all(
                    [
                        Promise.resolve(agent.getSupportedModels()),
                        Promise.resolve(agent.getSupportedProviders()),
                        Promise.resolve(agent.getCurrentLLMConfig()),
                        loadCustomModels(),
                    ]
                );

                const modelList: ModelOption[] = [];

                // Add custom models first
                for (const custom of loadedCustomModels) {
                    modelList.push({
                        provider: 'openai-compatible' as LLMProvider,
                        name: custom.name,
                        displayName: custom.displayName || custom.name,
                        maxInputTokens: custom.maxInputTokens || 128000,
                        isDefault: false,
                        isCurrent:
                            currentConfig.provider === 'openai-compatible' &&
                            currentConfig.model === custom.name,
                        isCustom: true,
                        baseURL: custom.baseURL,
                    });
                }

                // Add registry models
                for (const provider of providers) {
                    // Skip openai-compatible as those are shown via custom models
                    if (provider === 'openai-compatible') continue;

                    const providerModels = allModels[provider];
                    for (const model of providerModels) {
                        modelList.push({
                            provider,
                            name: model.name,
                            displayName: model.displayName,
                            maxInputTokens: model.maxInputTokens,
                            isDefault: model.isDefault,
                            isCurrent:
                                provider === currentConfig.provider &&
                                model.name === currentConfig.model,
                            isCustom: false,
                        });
                    }
                }

                if (!cancelled) {
                    setModels(modelList);
                    setCustomModels(loadedCustomModels);
                    setIsLoading(false);

                    // Set initial selection to current model (offset by 1 for "Add custom" option)
                    const currentIndex = modelList.findIndex((m) => m.isCurrent);
                    if (currentIndex >= 0) {
                        setSelectedIndex(currentIndex + 1); // +1 for "Add custom" at top
                    }
                }
            } catch (error) {
                if (!cancelled) {
                    logger.error(
                        `Failed to fetch models: ${error instanceof Error ? error.message : 'Unknown error'}`,
                        { error }
                    );
                    setModels([]);
                    setIsLoading(false);
                }
            }
        };

        void fetchModels();

        return () => {
            cancelled = true;
        };
    }, [isVisible, agent]);

    // Filter models based on search query
    const filteredItems = useMemo((): SelectorItem[] => {
        const addCustomOption: AddCustomOption = { type: 'add-custom' };

        if (!searchQuery.trim()) {
            return [addCustomOption, ...models];
        }

        const query = searchQuery.toLowerCase();
        const filtered = models.filter((model) => {
            const name = model.name.toLowerCase();
            const displayName = (model.displayName || '').toLowerCase();
            const provider = model.provider.toLowerCase();
            return name.includes(query) || displayName.includes(query) || provider.includes(query);
        });

        // Always show "Add custom" when searching (user might want to add what they're searching for)
        return [addCustomOption, ...filtered];
    }, [models, searchQuery]);

    // Adjust selected index when filter changes
    useEffect(() => {
        if (selectedIndex >= filteredItems.length) {
            setSelectedIndex(Math.max(0, filteredItems.length - 1));
        }
    }, [filteredItems.length, selectedIndex]);

    // Calculate scroll offset
    useEffect(() => {
        if (selectedIndex < scrollOffset) {
            setScrollOffset(selectedIndex);
        } else if (selectedIndex >= scrollOffset + MAX_VISIBLE_ITEMS) {
            setScrollOffset(selectedIndex - MAX_VISIBLE_ITEMS + 1);
        }
    }, [selectedIndex, scrollOffset]);

    // Handle delete custom model
    const handleDeleteCustomModel = async (model: ModelOption) => {
        if (!model.isCustom) return;

        try {
            await deleteCustomModel(model.name);
            // Refresh the list
            const updated = await loadCustomModels();
            setCustomModels(updated);
            // Update models list
            setModels((prev) => prev.filter((m) => !(m.isCustom && m.name === model.name)));
        } catch (error) {
            logger.error(
                `Failed to delete custom model: ${error instanceof Error ? error.message : 'Unknown error'}`
            );
        }
    };

    // Expose handleInput method via ref
    useImperativeHandle(
        ref,
        () => ({
            handleInput: (input: string, key: Key): boolean => {
                if (!isVisible) return false;

                // Escape always works
                if (key.escape) {
                    onClose();
                    return true;
                }

                // Handle character input for search
                if (input && !key.return && !key.upArrow && !key.downArrow && !key.tab) {
                    // Shift+D to delete custom model (requires double-press confirmation)
                    if (input === 'D' && key.shift) {
                        const item = filteredItems[selectedIndexRef.current];
                        if (item && !isAddCustomOption(item) && item.isCustom) {
                            if (pendingDeleteModel === item.name) {
                                // Second press - actually delete
                                if (deleteTimeoutRef.current) {
                                    clearTimeout(deleteTimeoutRef.current);
                                    deleteTimeoutRef.current = null;
                                }
                                setPendingDeleteModel(null);
                                void handleDeleteCustomModel(item);
                            } else {
                                // First press - set pending and start timeout
                                setPendingDeleteModel(item.name);
                                if (deleteTimeoutRef.current) {
                                    clearTimeout(deleteTimeoutRef.current);
                                }
                                deleteTimeoutRef.current = setTimeout(() => {
                                    setPendingDeleteModel(null);
                                    deleteTimeoutRef.current = null;
                                }, 3000); // 3 second timeout
                            }
                            return true;
                        }
                        return false;
                    }

                    // Any other input clears the pending delete confirmation
                    if (pendingDeleteModel) {
                        setPendingDeleteModel(null);
                        if (deleteTimeoutRef.current) {
                            clearTimeout(deleteTimeoutRef.current);
                            deleteTimeoutRef.current = null;
                        }
                    }

                    // Backspace
                    if (key.backspace || key.delete) {
                        setSearchQuery((prev) => prev.slice(0, -1));
                        return true;
                    }

                    // Regular character - add to search
                    if (input.length === 1 && input.charCodeAt(0) >= 32) {
                        setSearchQuery((prev) => prev + input);
                        setSelectedIndex(0);
                        setScrollOffset(0);
                        return true;
                    }
                }

                // Backspace when no other input
                if (key.backspace || key.delete) {
                    setSearchQuery((prev) => prev.slice(0, -1));
                    return true;
                }

                const itemsLength = filteredItems.length;
                if (itemsLength === 0) return false;

                if (key.upArrow) {
                    // Clear pending delete on navigation
                    if (pendingDeleteModel) {
                        setPendingDeleteModel(null);
                        if (deleteTimeoutRef.current) {
                            clearTimeout(deleteTimeoutRef.current);
                            deleteTimeoutRef.current = null;
                        }
                    }
                    const nextIndex = (selectedIndexRef.current - 1 + itemsLength) % itemsLength;
                    setSelectedIndex(nextIndex);
                    selectedIndexRef.current = nextIndex;
                    return true;
                }

                if (key.downArrow) {
                    // Clear pending delete on navigation
                    if (pendingDeleteModel) {
                        setPendingDeleteModel(null);
                        if (deleteTimeoutRef.current) {
                            clearTimeout(deleteTimeoutRef.current);
                            deleteTimeoutRef.current = null;
                        }
                    }
                    const nextIndex = (selectedIndexRef.current + 1) % itemsLength;
                    setSelectedIndex(nextIndex);
                    selectedIndexRef.current = nextIndex;
                    return true;
                }

                if (key.return && itemsLength > 0) {
                    const item = filteredItems[selectedIndexRef.current];
                    if (item) {
                        if (isAddCustomOption(item)) {
                            onAddCustomModel();
                        } else {
                            onSelectModel(item.provider, item.name, item.baseURL);
                        }
                        return true;
                    }
                }

                return false;
            },
        }),
        [isVisible, filteredItems, onClose, onSelectModel, onAddCustomModel, pendingDeleteModel]
    );

    if (!isVisible) return null;

    if (isLoading) {
        return (
            <Box paddingX={0} paddingY={0}>
                <Text dimColor>Loading models...</Text>
            </Box>
        );
    }

    const visibleItems = filteredItems.slice(scrollOffset, scrollOffset + MAX_VISIBLE_ITEMS);
    const hasCustomModels = customModels.length > 0;

    return (
        <Box flexDirection="column">
            {/* Header */}
            <Box paddingX={0} paddingY={0}>
                <Text color="cyan" bold>
                    Select Model ({selectedIndex + 1}/{filteredItems.length})
                </Text>
            </Box>
            {/* Navigation hints */}
            <Box paddingX={0} paddingY={0}>
                <Text dimColor>↑↓ navigate, Enter select, Esc close</Text>
                {hasCustomModels && <Text dimColor>, Shift+D delete custom</Text>}
            </Box>

            {/* Search input */}
            <Box paddingX={0} paddingY={0}>
                <Text color="gray">🔍 </Text>
                <Text color={searchQuery ? 'white' : 'gray'}>
                    {searchQuery || 'Type to search...'}
                </Text>
                <Text color="cyan">▌</Text>
            </Box>

            {/* Separator */}
            <Box paddingX={0} paddingY={0}>
                <Text dimColor>{'─'.repeat(50)}</Text>
            </Box>

            {/* Items */}
            {visibleItems.map((item, visibleIndex) => {
                const actualIndex = scrollOffset + visibleIndex;
                const isSelected = actualIndex === selectedIndex;

                if (isAddCustomOption(item)) {
                    return (
                        <Box key="add-custom" paddingX={0} paddingY={0}>
                            <Text color={isSelected ? 'green' : 'gray'} bold={isSelected}>
                                ➕ Add custom model...
                            </Text>
                        </Box>
                    );
                }

                return (
                    <Box key={`${item.provider}-${item.name}`} paddingX={0} paddingY={0}>
                        {item.isCustom && <Text color={isSelected ? 'yellow' : 'gray'}>★ </Text>}
                        <Text color={isSelected ? 'cyan' : 'gray'} bold={isSelected}>
                            {item.displayName || item.name}
                        </Text>
                        <Text color={isSelected ? 'white' : 'gray'} dimColor={!isSelected}>
                            {' '}
                            ({item.isCustom ? 'custom' : item.provider})
                        </Text>
                        <Text color={isSelected ? 'white' : 'gray'} dimColor={!isSelected}>
                            {' '}
                            • {item.maxInputTokens.toLocaleString()} tokens
                        </Text>
                        {item.isDefault && (
                            <Text color={isSelected ? 'white' : 'gray'} dimColor={!isSelected}>
                                {' '}
                                [DEFAULT]
                            </Text>
                        )}
                        {item.isCurrent && (
                            <Text color={isSelected ? 'cyan' : 'gray'} bold={isSelected}>
                                {' '}
                                ← Current
                            </Text>
                        )}
                    </Box>
                );
            })}

            {/* Scroll indicator */}
            {filteredItems.length > MAX_VISIBLE_ITEMS && (
                <Box paddingX={0} paddingY={0}>
                    <Text dimColor>
                        {scrollOffset > 0 ? '↑ more above' : ''}
                        {scrollOffset > 0 && scrollOffset + MAX_VISIBLE_ITEMS < filteredItems.length
                            ? ' | '
                            : ''}
                        {scrollOffset + MAX_VISIBLE_ITEMS < filteredItems.length
                            ? '↓ more below'
                            : ''}
                    </Text>
                </Box>
            )}

            {/* Delete confirmation message */}
            {pendingDeleteModel && (
                <Box paddingX={0} paddingY={0} marginTop={1}>
                    <Text color="yellow">
                        ⚠️ Press Shift+D again to delete '{pendingDeleteModel}'
                    </Text>
                </Box>
            )}
        </Box>
    );
});

export default ModelSelector;

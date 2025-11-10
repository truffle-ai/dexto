import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Box, Text, useInput } from 'ink';
import type { DextoAgent } from '@dexto/core';
import type { LLMProvider } from '@dexto/core';

interface ModelSelectorProps {
    isVisible: boolean;
    onSelectModel: (provider: LLMProvider, model: string) => void;
    onClose: () => void;
    agent: DextoAgent;
}

interface ModelOption {
    provider: LLMProvider;
    name: string;
    displayName: string | undefined;
    maxInputTokens: number;
    isDefault: boolean;
}

export default function ModelSelector({
    isVisible,
    onSelectModel,
    onClose,
    agent,
}: ModelSelectorProps) {
    const [models, setModels] = useState<ModelOption[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [selectedIndex, setSelectedIndex] = useState(0);
    const [scrollOffset, setScrollOffset] = useState(0);
    const selectedIndexRef = useRef(0);
    const MAX_VISIBLE_ITEMS = 10;

    // Keep ref in sync
    useEffect(() => {
        selectedIndexRef.current = selectedIndex;
    }, [selectedIndex]);

    // Fetch models from agent
    useEffect(() => {
        if (!isVisible) return;

        let cancelled = false;
        setIsLoading(true);

        const fetchModels = async () => {
            try {
                const allModels = agent.getSupportedModels();
                const providers = agent.getSupportedProviders();
                const currentConfig = agent.getCurrentLLMConfig();

                const modelList: ModelOption[] = [];
                for (const provider of providers) {
                    const providerModels = allModels[provider];
                    for (const model of providerModels) {
                        modelList.push({
                            provider,
                            name: model.name,
                            displayName: model.displayName,
                            maxInputTokens: model.maxInputTokens,
                            isDefault: model.isDefault,
                        });
                    }
                }

                if (!cancelled) {
                    setModels(modelList);
                    setIsLoading(false);

                    // Set initial selection to current model
                    const currentIndex = modelList.findIndex(
                        (m) =>
                            m.provider === currentConfig.provider && m.name === currentConfig.model
                    );
                    if (currentIndex >= 0) {
                        setSelectedIndex(currentIndex);
                    }
                }
            } catch (error) {
                if (!cancelled) {
                    console.error('Failed to fetch models:', error);
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

    // Reset scroll when selection changes
    useEffect(() => {
        if (selectedIndex < scrollOffset) {
            setScrollOffset(selectedIndex);
        } else if (selectedIndex >= scrollOffset + MAX_VISIBLE_ITEMS) {
            setScrollOffset(Math.max(0, selectedIndex - MAX_VISIBLE_ITEMS + 1));
        }
    }, [selectedIndex, scrollOffset]);

    // Calculate visible items
    const visibleItems = useMemo(() => {
        return models.slice(scrollOffset, scrollOffset + MAX_VISIBLE_ITEMS);
    }, [models, scrollOffset]);

    // Handle keyboard navigation
    useInput(
        (input, key) => {
            if (!isVisible) return;

            const itemsLength = models.length;
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

            if (key.return && itemsLength > 0) {
                const model = models[selectedIndexRef.current];
                if (model) {
                    onSelectModel(model.provider, model.name);
                }
            }
        },
        { isActive: isVisible }
    );

    if (!isVisible) return null;

    if (isLoading) {
        return (
            <Box borderStyle="single" borderColor="gray" paddingX={1} paddingY={1}>
                <Text dimColor>Loading models...</Text>
            </Box>
        );
    }

    if (models.length === 0) {
        return (
            <Box borderStyle="single" borderColor="gray" paddingX={1} paddingY={1}>
                <Text dimColor>No models found</Text>
            </Box>
        );
    }

    const hasMoreAbove = scrollOffset > 0;
    const hasMoreBelow = scrollOffset + MAX_VISIBLE_ITEMS < models.length;
    const currentModel = agent.getCurrentLLMConfig();

    return (
        <Box
            borderStyle="single"
            borderColor="cyan"
            flexDirection="column"
            height={Math.min(MAX_VISIBLE_ITEMS + 3, models.length + 3)}
        >
            <Box paddingX={1} paddingY={0}>
                <Text dimColor>
                    Select Model ({selectedIndex + 1}/{models.length}) - ↑↓ to navigate, Enter to
                    select, Esc to close
                </Text>
            </Box>
            {hasMoreAbove && (
                <Box paddingX={1} paddingY={0}>
                    <Text dimColor>... ↑ ({scrollOffset} more above)</Text>
                </Box>
            )}
            {visibleItems.map((model, visibleIndex) => {
                const actualIndex = scrollOffset + visibleIndex;
                const isSelected = actualIndex === selectedIndex;
                const isCurrent =
                    model.provider === currentModel.provider && model.name === currentModel.model;

                return (
                    <Box
                        key={`${model.provider}-${model.name}`}
                        paddingX={1}
                        paddingY={0}
                        backgroundColor={isSelected ? 'cyan' : undefined}
                        flexDirection="row"
                    >
                        <Text color={isSelected ? 'black' : 'green'} bold>
                            {model.displayName || model.name}
                        </Text>
                        <Text color={isSelected ? 'black' : 'gray'} dimColor={!isSelected}>
                            {' '}
                            ({model.provider})
                        </Text>
                        <Text color={isSelected ? 'black' : 'gray'} dimColor={!isSelected}>
                            {' '}
                            • {model.maxInputTokens.toLocaleString()} tokens
                        </Text>
                        {model.isDefault && (
                            <Text color={isSelected ? 'black' : 'yellow'} dimColor={!isSelected}>
                                {' '}
                                [DEFAULT]
                            </Text>
                        )}
                        {isCurrent && (
                            <Text color={isSelected ? 'black' : 'cyan'} bold>
                                {' '}
                                ← Current
                            </Text>
                        )}
                    </Box>
                );
            })}
            {hasMoreBelow && (
                <Box paddingX={1} paddingY={0}>
                    <Text dimColor>
                        ... ↓ ({models.length - scrollOffset - MAX_VISIBLE_ITEMS} more below)
                    </Text>
                </Box>
            )}
        </Box>
    );
}

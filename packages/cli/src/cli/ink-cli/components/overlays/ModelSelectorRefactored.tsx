/**
 * ModelSelector Component (Refactored)
 * Now a thin wrapper around BaseSelector
 * Eliminates ~200 lines of code by using base component
 */

import React, { useState, useEffect, forwardRef, useRef, useImperativeHandle } from 'react';
import { Text, type Key } from 'ink';
import { logger, type DextoAgent, type LLMProvider } from '@dexto/core';
import { BaseSelector, type BaseSelectorHandle } from '../base/BaseSelector.js';

interface ModelSelectorProps {
    isVisible: boolean;
    onSelectModel: (provider: LLMProvider, model: string) => void;
    onClose: () => void;
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
}

/**
 * Model selector - now a thin wrapper around BaseSelector
 * Provides data fetching and formatting only
 */
const ModelSelector = forwardRef<ModelSelectorHandle, ModelSelectorProps>(function ModelSelector(
    { isVisible, onSelectModel, onClose, agent },
    ref
) {
    const baseSelectorRef = useRef<BaseSelectorHandle>(null);

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
    const [models, setModels] = useState<ModelOption[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [selectedIndex, setSelectedIndex] = useState(0);

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
                            isCurrent:
                                provider === currentConfig.provider &&
                                model.name === currentConfig.model,
                        });
                    }
                }

                if (!cancelled) {
                    setModels(modelList);
                    setIsLoading(false);

                    // Set initial selection to current model
                    const currentIndex = modelList.findIndex((m) => m.isCurrent);
                    if (currentIndex >= 0) {
                        setSelectedIndex(currentIndex);
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

    // Format model item for display
    const formatItem = (model: ModelOption, isSelected: boolean) => (
        <>
            <Text color={isSelected ? 'black' : 'gray'} bold={isSelected}>
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
                <Text color={isSelected ? 'black' : 'gray'} dimColor={!isSelected}>
                    {' '}
                    [DEFAULT]
                </Text>
            )}
            {model.isCurrent && (
                <Text color={isSelected ? 'black' : 'gray'} bold={isSelected}>
                    {' '}
                    ← Current
                </Text>
            )}
        </>
    );

    // Handle selection
    const handleSelect = (model: ModelOption) => {
        onSelectModel(model.provider, model.name);
    };

    return (
        <BaseSelector
            ref={baseSelectorRef}
            items={models}
            isVisible={isVisible}
            isLoading={isLoading}
            selectedIndex={selectedIndex}
            onSelectIndex={setSelectedIndex}
            onSelect={handleSelect}
            onClose={onClose}
            formatItem={formatItem}
            title="Select Model"
            borderColor="cyan"
            loadingMessage="Loading models..."
            emptyMessage="No models found"
        />
    );
});

export default ModelSelector;

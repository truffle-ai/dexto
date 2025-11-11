/**
 * ModelSelector Component (Refactored)
 * Now a thin wrapper around BaseSelector
 * Eliminates ~200 lines of code by using base component
 */

import React, { useState, useEffect } from 'react';
import { Text } from 'ink';
import type { DextoAgent, LLMProvider } from '@dexto/core';
import { BaseSelector } from '../base/BaseSelector.js';

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
    isCurrent: boolean;
}

/**
 * Model selector - now a thin wrapper around BaseSelector
 * Provides data fetching and formatting only
 */
export default function ModelSelector({
    isVisible,
    onSelectModel,
    onClose,
    agent,
}: ModelSelectorProps) {
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

    // Format model item for display
    const formatItem = (model: ModelOption, isSelected: boolean) => (
        <>
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
            {model.isCurrent && (
                <Text color={isSelected ? 'black' : 'cyan'} bold>
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
}

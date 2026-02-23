/**
 * ModelSelector Component (Refactored)
 * Features:
 * - Search filtering
 * - Custom models support (add/edit/delete via arrow navigation)
 */

import {
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
import type { DextoAgent, LLMProvider } from '@dexto/core';
import {
    listOllamaModels,
    DEFAULT_OLLAMA_URL,
    getLocalModelById,
    isReasoningCapableModel,
} from '@dexto/core';
import {
    loadCustomModels,
    deleteCustomModel,
    getAllInstalledModels,
    loadGlobalPreferences,
    isDextoAuthEnabled,
    type CustomModel,
} from '@dexto/agent-management';
import { getLLMProviderDisplayName } from '../../utils/llm-provider-display.js';

type ReasoningEffort = 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';

interface ModelSelectorProps {
    isVisible: boolean;
    onSelectModel: (
        provider: LLMProvider,
        model: string,
        displayName?: string,
        baseURL?: string,
        reasoningEffort?: ReasoningEffort
    ) => void;
    onSetDefaultModel: (
        provider: LLMProvider,
        model: string,
        displayName?: string,
        baseURL?: string,
        reasoningEffort?: ReasoningEffort
    ) => Promise<void>;
    onClose: () => void;
    onAddCustomModel: () => void;
    onEditCustomModel: (model: CustomModel) => void;
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
    reasoningEffort?: ReasoningEffort;
    /** For gateway providers like dexto-nova, the original provider this model comes from */
    originalProvider?: LLMProvider;
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

// Reasoning effort options - defined at module scope to avoid recreation on each render
const REASONING_EFFORT_OPTIONS: {
    value: ReasoningEffort | 'auto';
    label: string;
    description: string;
}[] = [
    {
        value: 'auto',
        label: 'Auto',
        description: 'Let the model decide (recommended for most tasks)',
    },
    { value: 'none', label: 'None', description: 'No reasoning, fastest responses' },
    { value: 'minimal', label: 'Minimal', description: 'Barely any reasoning, very fast' },
    { value: 'low', label: 'Low', description: 'Light reasoning, fast responses' },
    {
        value: 'medium',
        label: 'Medium',
        description: 'Balanced reasoning (OpenAI recommended)',
    },
    { value: 'high', label: 'High', description: 'Thorough reasoning for complex tasks' },
    { value: 'xhigh', label: 'Extra High', description: 'Maximum quality, slower/costlier' },
];

/**
 * Model selector with search and custom model support
 */
const ModelSelector = forwardRef<ModelSelectorHandle, ModelSelectorProps>(function ModelSelector(
    {
        isVisible,
        onSelectModel,
        onSetDefaultModel,
        onClose,
        onAddCustomModel,
        onEditCustomModel,
        agent,
    },
    ref
) {
    const [models, setModels] = useState<ModelOption[]>([]);
    const [customModels, setCustomModels] = useState<CustomModel[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [selectedIndex, setSelectedIndex] = useState(0);
    const [searchQuery, setSearchQuery] = useState('');
    const [scrollOffset, setScrollOffset] = useState(0);
    const [customModelAction, setCustomModelAction] = useState<
        'edit' | 'default' | 'delete' | null
    >(null);
    const [pendingDeleteConfirm, setPendingDeleteConfirm] = useState(false);
    const selectedIndexRef = useRef(selectedIndex);
    const deleteTimeoutRef = useRef<NodeJS.Timeout | null>(null);

    // Reasoning effort sub-step state
    const [pendingReasoningModel, setPendingReasoningModel] = useState<ModelOption | null>(null);
    const [reasoningEffortIndex, setReasoningEffortIndex] = useState(0); // Default to 'Auto' (index 0)
    const [isSettingDefault, setIsSettingDefault] = useState(false); // Track if setting as default vs normal selection
    const [refreshVersion, setRefreshVersion] = useState(0);

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
        setCustomModelAction(null);
        setPendingDeleteConfirm(false);
        setPendingReasoningModel(null);
        setIsSettingDefault(false);
        setReasoningEffortIndex(0); // Default to 'Auto'
        if (deleteTimeoutRef.current) {
            clearTimeout(deleteTimeoutRef.current);
            deleteTimeoutRef.current = null;
        }

        const fetchModels = async () => {
            try {
                const [allModels, providers, currentConfig, loadedCustomModels, preferences] =
                    await Promise.all([
                        Promise.resolve(agent.getSupportedModels()),
                        Promise.resolve(agent.getSupportedProviders()),
                        Promise.resolve(agent.getCurrentLLMConfig()),
                        loadCustomModels(),
                        loadGlobalPreferences().catch(() => null),
                    ]);

                const modelList: ModelOption[] = [];
                const defaultProvider = preferences?.llm.provider;
                const defaultModel = preferences?.llm.model;
                const defaultBaseURL = preferences?.llm.baseURL;
                const defaultReasoningEffort = preferences?.llm.reasoningEffort;

                // Fetch dynamic models for local providers
                let ollamaModels: Array<{ name: string; size?: number }> = [];
                let localModels: Array<{ id: string; filePath: string; sizeBytes: number }> = [];

                try {
                    ollamaModels = await listOllamaModels(DEFAULT_OLLAMA_URL);
                } catch (error) {
                    // Ollama not available, skip
                    agent.logger.debug('Ollama not available for model listing');
                }

                try {
                    localModels = await getAllInstalledModels();
                } catch (error) {
                    // Local models not available, skip
                    agent.logger.debug('Local models not available for listing');
                }

                // Add custom models first
                for (const custom of loadedCustomModels) {
                    // Use provider from custom model, default to openai-compatible for legacy models
                    const customProvider = (custom.provider ?? 'openai-compatible') as LLMProvider;
                    const modelOption: ModelOption = {
                        provider: customProvider,
                        name: custom.name,
                        displayName: custom.displayName || custom.name,
                        maxInputTokens: custom.maxInputTokens ?? 128000,
                        isDefault:
                            customProvider === defaultProvider && custom.name === defaultModel,
                        isCurrent:
                            currentConfig.provider === customProvider &&
                            currentConfig.model === custom.name,
                        isCustom: true,
                    };
                    if (custom.baseURL) {
                        modelOption.baseURL = custom.baseURL;
                    }
                    if (custom.reasoningEffort) {
                        modelOption.reasoningEffort = custom.reasoningEffort;
                    }
                    modelList.push(modelOption);
                }

                // Add registry models
                for (const provider of providers) {
                    // Skip custom-only providers that don't have a static model list
                    // These are only accessible via the "Add custom model" wizard
                    if (
                        provider === 'openai-compatible' ||
                        provider === 'openrouter' ||
                        provider === 'litellm' ||
                        provider === 'glama'
                    )
                        continue;

                    // Skip ollama and local - they'll be added dynamically below
                    if (provider === 'ollama' || provider === 'local') {
                        continue;
                    }

                    // Skip dexto-nova provider when feature is not enabled
                    if (provider === 'dexto-nova' && !isDextoAuthEnabled()) {
                        continue;
                    }

                    const providerModels = allModels[provider];
                    for (const model of providerModels) {
                        // For dexto-nova provider, models have originalProvider field
                        // showing which provider the model originally came from
                        const originalProvider =
                            'originalProvider' in model ? model.originalProvider : undefined;

                        modelList.push({
                            provider,
                            name: model.name,
                            displayName: model.displayName,
                            maxInputTokens: model.maxInputTokens,
                            isDefault: provider === defaultProvider && model.name === defaultModel,
                            isCurrent:
                                provider === currentConfig.provider &&
                                model.name === currentConfig.model,
                            isCustom: false,
                            ...(defaultReasoningEffort &&
                            provider === defaultProvider &&
                            model.name === defaultModel
                                ? { reasoningEffort: defaultReasoningEffort }
                                : {}),
                            ...(defaultBaseURL &&
                            provider === defaultProvider &&
                            model.name === defaultModel
                                ? { baseURL: defaultBaseURL }
                                : {}),
                            // Store original provider for display purposes
                            ...(originalProvider && { originalProvider }),
                        });
                    }
                }

                // Add Ollama models dynamically
                for (const ollamaModel of ollamaModels) {
                    modelList.push({
                        provider: 'ollama',
                        name: ollamaModel.name,
                        displayName: ollamaModel.name,
                        maxInputTokens: 128000, // Default, actual varies by model
                        isDefault:
                            defaultProvider === 'ollama' && defaultModel === ollamaModel.name,
                        isCurrent:
                            currentConfig.provider === 'ollama' &&
                            currentConfig.model === ollamaModel.name,
                        isCustom: false,
                    });
                }

                // Add local models dynamically
                for (const localModel of localModels) {
                    // Get display name from registry if available
                    const modelInfo = getLocalModelById(localModel.id);
                    const displayName = modelInfo?.name || localModel.id;
                    const maxInputTokens = modelInfo?.contextLength || 128000;

                    modelList.push({
                        provider: 'local',
                        name: localModel.id,
                        displayName,
                        maxInputTokens,
                        isDefault: defaultProvider === 'local' && defaultModel === localModel.id,
                        isCurrent:
                            currentConfig.provider === 'local' &&
                            currentConfig.model === localModel.id,
                        isCustom: false,
                    });
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
                    agent.logger.error(
                        `Failed to fetch models: ${error instanceof Error ? error.message : 'Unknown error'}`
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
    }, [isVisible, agent, refreshVersion]);

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
    const handleDeleteCustomModel = useCallback(
        async (model: ModelOption) => {
            if (!model.isCustom) return;

            try {
                await deleteCustomModel(model.name);
                // Refresh the list
                const updated = await loadCustomModels();
                setCustomModels(updated);
                // Update models list
                setModels((prev) => prev.filter((m) => !(m.isCustom && m.name === model.name)));
            } catch (error) {
                agent.logger.error(
                    `Failed to delete custom model: ${error instanceof Error ? error.message : 'Unknown error'}`
                );
            }
        },
        [agent]
    );

    // Helper to clear action state
    const clearActionState = () => {
        setCustomModelAction(null);
        setPendingDeleteConfirm(false);
        if (deleteTimeoutRef.current) {
            clearTimeout(deleteTimeoutRef.current);
            deleteTimeoutRef.current = null;
        }
    };

    // Expose handleInput method via ref
    useImperativeHandle(
        ref,
        () => ({
            handleInput: (input: string, key: Key): boolean => {
                if (!isVisible) return false;

                // Handle reasoning effort sub-step
                if (pendingReasoningModel) {
                    if (key.escape) {
                        // Go back to model selection
                        setPendingReasoningModel(null);
                        setIsSettingDefault(false);
                        return true;
                    }
                    if (key.upArrow) {
                        setReasoningEffortIndex((prev) =>
                            prev > 0 ? prev - 1 : REASONING_EFFORT_OPTIONS.length - 1
                        );
                        return true;
                    }
                    if (key.downArrow) {
                        setReasoningEffortIndex((prev) =>
                            prev < REASONING_EFFORT_OPTIONS.length - 1 ? prev + 1 : 0
                        );
                        return true;
                    }
                    if (key.return) {
                        const selectedOption = REASONING_EFFORT_OPTIONS[reasoningEffortIndex];
                        const reasoningEffort =
                            selectedOption?.value === 'auto' ? undefined : selectedOption?.value;

                        if (isSettingDefault) {
                            // Setting as default model
                            clearActionState();
                            void (async () => {
                                await onSetDefaultModel(
                                    pendingReasoningModel.provider,
                                    pendingReasoningModel.name,
                                    pendingReasoningModel.displayName,
                                    pendingReasoningModel.baseURL,
                                    reasoningEffort
                                );
                                setRefreshVersion((prev) => prev + 1);
                                onClose(); // Close overlay after setting default
                            })();
                        } else {
                            // Normal model selection
                            onSelectModel(
                                pendingReasoningModel.provider,
                                pendingReasoningModel.name,
                                pendingReasoningModel.displayName,
                                pendingReasoningModel.baseURL,
                                reasoningEffort
                            );
                        }

                        setPendingReasoningModel(null);
                        setIsSettingDefault(false);
                        return true;
                    }
                    return true; // Consume all input in reasoning effort mode
                }

                // Escape always works
                if (key.escape) {
                    // If in action mode, just clear it first
                    if (customModelAction) {
                        clearActionState();
                        return true;
                    }
                    onClose();
                    return true;
                }

                const itemsLength = filteredItems.length;
                const currentItem = filteredItems[selectedIndexRef.current];
                const isCustomActionItem =
                    currentItem && !isAddCustomOption(currentItem) && currentItem.isCustom;
                const isSelectableItem = currentItem && !isAddCustomOption(currentItem);
                const isOnActionItem = isCustomActionItem || isSelectableItem;

                // Right arrow - enter/advance action mode for custom or selectable models
                if (key.rightArrow) {
                    if (!isOnActionItem) return false;

                    if (customModelAction === null) {
                        if (isCustomActionItem) {
                            setCustomModelAction('edit');
                        } else {
                            setCustomModelAction('default');
                        }
                        return true;
                    }

                    if (customModelAction === 'edit') {
                        setCustomModelAction('default');
                        return true;
                    }

                    if (customModelAction === 'default') {
                        if (isCustomActionItem) {
                            setCustomModelAction('delete');
                            setPendingDeleteConfirm(false);
                            return true;
                        }

                        const actionItem = currentItem as ModelOption;

                        // Check if reasoning-capable, show reasoning effort selection
                        if (isReasoningCapableModel(actionItem.name)) {
                            setPendingReasoningModel(actionItem);
                            setIsSettingDefault(true);
                            setReasoningEffortIndex(0); // Default to 'Auto'
                            return true;
                        }

                        clearActionState();
                        void (async () => {
                            await onSetDefaultModel(
                                actionItem.provider,
                                actionItem.name,
                                actionItem.displayName,
                                actionItem.baseURL,
                                actionItem.reasoningEffort
                            );
                            setRefreshVersion((prev) => prev + 1);
                            onClose(); // Close overlay after setting default
                        })();
                        return true;
                    }

                    if (customModelAction === 'delete') {
                        if (pendingDeleteConfirm) {
                            if (deleteTimeoutRef.current) {
                                clearTimeout(deleteTimeoutRef.current);
                                deleteTimeoutRef.current = null;
                            }
                            clearActionState();
                            void handleDeleteCustomModel(currentItem as ModelOption);
                        } else {
                            setPendingDeleteConfirm(true);
                            if (deleteTimeoutRef.current) {
                                clearTimeout(deleteTimeoutRef.current);
                            }
                            deleteTimeoutRef.current = setTimeout(() => {
                                setPendingDeleteConfirm(false);
                                deleteTimeoutRef.current = null;
                            }, 3000);
                        }
                        return true;
                    }
                }

                // Left arrow - go back in action mode
                if (key.leftArrow) {
                    if (customModelAction === 'delete') {
                        setCustomModelAction('default');
                        setPendingDeleteConfirm(false);
                        if (deleteTimeoutRef.current) {
                            clearTimeout(deleteTimeoutRef.current);
                            deleteTimeoutRef.current = null;
                        }
                        return true;
                    }

                    if (customModelAction === 'default') {
                        if (isCustomActionItem) {
                            setCustomModelAction('edit');
                        } else {
                            setCustomModelAction(null);
                        }
                        return true;
                    }

                    if (customModelAction === 'edit') {
                        setCustomModelAction(null);
                        return true;
                    }

                    return false;
                }

                // Handle character input for search
                if (input && !key.return && !key.upArrow && !key.downArrow && !key.tab) {
                    // Any character input clears action state and adds to search
                    if (customModelAction) {
                        clearActionState();
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

                if (itemsLength === 0) return false;

                if (key.upArrow) {
                    // Clear action state on vertical navigation
                    if (customModelAction) {
                        clearActionState();
                    }
                    const nextIndex = (selectedIndexRef.current - 1 + itemsLength) % itemsLength;
                    setSelectedIndex(nextIndex);
                    selectedIndexRef.current = nextIndex;
                    return true;
                }

                if (key.downArrow) {
                    // Clear action state on vertical navigation
                    if (customModelAction) {
                        clearActionState();
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
                            return true;
                        }

                        // Handle action mode confirmations
                        if (customModelAction === 'edit' && item.isCustom) {
                            // Find the full custom model data
                            const customModel = customModels.find(
                                (cm) =>
                                    cm.name === item.name &&
                                    (cm.provider ?? 'openai-compatible') === item.provider
                            );
                            if (customModel) {
                                onEditCustomModel(customModel);
                            }
                            return true;
                        }

                        if (customModelAction === 'default') {
                            // Check if reasoning-capable, show reasoning effort selection
                            if (isReasoningCapableModel(item.name)) {
                                setPendingReasoningModel(item);
                                setIsSettingDefault(true);
                                setReasoningEffortIndex(0); // Default to 'Auto'
                                return true;
                            }

                            clearActionState();
                            void (async () => {
                                await onSetDefaultModel(
                                    item.provider,
                                    item.name,
                                    item.displayName,
                                    item.baseURL,
                                    item.reasoningEffort
                                );
                                setRefreshVersion((prev) => prev + 1);
                                onClose(); // Close overlay after setting default
                            })();
                            return true;
                        }

                        if (customModelAction === 'delete' && item.isCustom) {
                            if (pendingDeleteConfirm) {
                                // Already confirmed, delete
                                clearActionState();
                                void handleDeleteCustomModel(item);
                            } else {
                                // Set pending confirmation
                                setPendingDeleteConfirm(true);
                                if (deleteTimeoutRef.current) {
                                    clearTimeout(deleteTimeoutRef.current);
                                }
                                deleteTimeoutRef.current = setTimeout(() => {
                                    setPendingDeleteConfirm(false);
                                    deleteTimeoutRef.current = null;
                                }, 3000);
                            }
                            return true;
                        }

                        // Normal selection - check if reasoning-capable
                        if (isReasoningCapableModel(item.name)) {
                            // Show reasoning effort sub-step
                            setPendingReasoningModel(item);
                            setReasoningEffortIndex(0); // Default to 'Auto'
                            return true;
                        }
                        onSelectModel(item.provider, item.name, item.displayName, item.baseURL);
                        return true;
                    }
                }

                return false;
            },
        }),
        [
            isVisible,
            filteredItems,
            onClose,
            onSelectModel,
            onSetDefaultModel,
            onAddCustomModel,
            onEditCustomModel,
            customModelAction,
            pendingDeleteConfirm,
            customModels,
            handleDeleteCustomModel,
            pendingReasoningModel,
            reasoningEffortIndex,
            isSettingDefault,
        ]
    );

    if (!isVisible) return null;

    if (isLoading) {
        return (
            <Box paddingX={0} paddingY={0}>
                <Text color="gray">Loading models...</Text>
            </Box>
        );
    }

    // Reasoning effort sub-step UI
    if (pendingReasoningModel) {
        return (
            <Box flexDirection="column">
                <Box paddingX={0} paddingY={0}>
                    <Text color="cyan" bold>
                        Configure Reasoning Effort
                        {isSettingDefault && <Text color="gray"> (Setting as Default)</Text>}
                    </Text>
                </Box>
                <Box paddingX={0} paddingY={0}>
                    <Text color="gray">
                        for {pendingReasoningModel.displayName || pendingReasoningModel.name}
                    </Text>
                </Box>
                <Box paddingX={0} paddingY={0}>
                    <Text color="gray">↑↓ navigate, Enter select, Esc back</Text>
                </Box>
                <Box paddingX={0} paddingY={0}>
                    <Text color="gray">{'─'.repeat(50)}</Text>
                </Box>
                {REASONING_EFFORT_OPTIONS.map((option, index) => {
                    const isSelected = index === reasoningEffortIndex;
                    return (
                        <Box key={option.value} paddingX={0} paddingY={0}>
                            <Text color={isSelected ? 'cyan' : 'gray'} bold={isSelected}>
                                {isSelected ? '› ' : '  '}
                                {option.label}
                            </Text>
                            <Text color={isSelected ? 'white' : 'gray'}>
                                {' '}
                                - {option.description}
                            </Text>
                        </Box>
                    );
                })}
            </Box>
        );
    }

    const visibleItems = filteredItems.slice(scrollOffset, scrollOffset + MAX_VISIBLE_ITEMS);
    const hasCustomModels = customModels.length > 0;
    const hasActionableItems = filteredItems.some((item) => !isAddCustomOption(item));
    const selectedItem = filteredItems[selectedIndex];
    const isSelectedCustom =
        selectedItem && !isAddCustomOption(selectedItem) && selectedItem.isCustom;

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
                <Text color="gray">↑↓ navigate, Enter select, Esc close</Text>
                {hasActionableItems && <Text color="gray">, →← for actions</Text>}
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
                <Text color="gray">{'─'.repeat(50)}</Text>
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

                // Show action buttons for selected custom models
                const showActions = isSelected && !isAddCustomOption(item);

                // Keep the UI label simple: show the actual provider being selected.
                // Gateway routing details are intentionally hidden from the main picker.
                const providerDisplay = getLLMProviderDisplayName(item.provider);

                return (
                    <Box
                        key={`${item.provider}-${item.name}-${item.isCustom ? 'custom' : 'registry'}`}
                        paddingX={0}
                        paddingY={0}
                    >
                        {item.isCustom && <Text color={isSelected ? 'orange' : 'gray'}>★ </Text>}
                        <Text color={isSelected ? 'cyan' : 'gray'} bold={isSelected}>
                            {item.displayName || item.name}
                        </Text>
                        <Text color={isSelected ? 'white' : 'gray'}> ({providerDisplay})</Text>
                        <Text color={isSelected ? 'white' : 'gray'}>
                            {' '}
                            • {item.maxInputTokens.toLocaleString()} tokens
                        </Text>
                        {item.isDefault && (
                            <Text color={isSelected ? 'white' : 'gray'}> [DEFAULT]</Text>
                        )}
                        {item.isCurrent && !showActions && (
                            <Text color={isSelected ? 'cyan' : 'gray'} bold={isSelected}>
                                {' '}
                                ← Current
                            </Text>
                        )}
                        {/* Action buttons for selectable models */}
                        {showActions && (
                            <>
                                {item.isCustom && (
                                    <>
                                        <Text> </Text>
                                        <Text
                                            color={customModelAction === 'edit' ? 'green' : 'gray'}
                                            bold={customModelAction === 'edit'}
                                            inverse={customModelAction === 'edit'}
                                        >
                                            {' '}
                                            Edit{' '}
                                        </Text>
                                    </>
                                )}
                                <Text> </Text>
                                <Text
                                    color={customModelAction === 'default' ? 'cyan' : 'gray'}
                                    bold={customModelAction === 'default'}
                                    inverse={customModelAction === 'default'}
                                >
                                    {' '}
                                    Set as Default{' '}
                                </Text>
                                {item.isCustom && (
                                    <>
                                        <Text> </Text>
                                        <Text
                                            color={customModelAction === 'delete' ? 'red' : 'gray'}
                                            bold={customModelAction === 'delete'}
                                            inverse={customModelAction === 'delete'}
                                        >
                                            {' '}
                                            Delete{' '}
                                        </Text>
                                    </>
                                )}
                            </>
                        )}
                    </Box>
                );
            })}

            {/* Scroll indicator */}
            {filteredItems.length > MAX_VISIBLE_ITEMS && (
                <Box paddingX={0} paddingY={0}>
                    <Text color="gray" wrap="truncate">
                        {scrollOffset > 0 ? '↑ more above' : ''}
                        {scrollOffset > 0 && scrollOffset + MAX_VISIBLE_ITEMS < filteredItems.length
                            ? ' • '
                            : ''}
                        {scrollOffset + MAX_VISIBLE_ITEMS < filteredItems.length
                            ? '↓ more below'
                            : ''}
                    </Text>
                </Box>
            )}

            {customModelAction === 'delete' && pendingDeleteConfirm && (
                <Box paddingX={0} paddingY={0} marginTop={1}>
                    <Text color="yellowBright">⚠️ Press → or Enter again to confirm delete</Text>
                </Box>
            )}
            {/* Action mode hints */}
            {customModelAction && !pendingDeleteConfirm && (
                <Box paddingX={0} paddingY={0} marginTop={1}>
                    <Text color="gray">
                        ←{' '}
                        {customModelAction === 'edit'
                            ? 'deselect'
                            : isSelectedCustom
                              ? 'edit'
                              : 'deselect'}{' '}
                        | →{' '}
                        {customModelAction === 'edit'
                            ? 'default'
                            : customModelAction === 'default'
                              ? isSelectedCustom
                                  ? 'delete'
                                  : 'confirm'
                              : 'confirm'}{' '}
                        | Enter {customModelAction}
                    </Text>
                </Box>
            )}
        </Box>
    );
});

export default ModelSelector;

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
import { useTerminalSize } from '../../hooks/useTerminalSize.js';
import type { DextoAgent, LLMProvider, ReasoningPreset } from '@dexto/core';
import {
    listOllamaModels,
    DEFAULT_OLLAMA_URL,
    getLocalModelById,
    getReasoningSupport,
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
import { getMaxVisibleItemsForTerminalRows } from '../../utils/overlaySizing.js';
import { HintBar } from '../shared/HintBar.js';

interface ModelSelectorProps {
    isVisible: boolean;
    onSelectModel: (
        provider: LLMProvider,
        model: string,
        displayName?: string,
        baseURL?: string,
        reasoningPreset?: ReasoningPreset
    ) => void;
    onSetDefaultModel: (
        provider: LLMProvider,
        model: string,
        displayName?: string,
        baseURL?: string,
        reasoningPreset?: ReasoningPreset
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
    reasoningPreset?: ReasoningPreset;
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

function asModelOption(item: SelectorItem): ModelOption {
    return item as ModelOption;
}

function getRowPrefix({
    isSelected,
    isDefault,
    isCurrent,
    isCustom,
}: {
    isSelected: boolean;
    isDefault: boolean;
    isCurrent: boolean;
    isCustom: boolean;
}): string {
    return `${isSelected ? '›' : ' '} ${isDefault ? '✓' : ' '} ${isCurrent ? '●' : ' '} ${
        isCustom ? '★' : ' '
    }`;
}

function computeNextSelection(
    currentIndex: number,
    itemsLength: number,
    viewportItems: number
): { index: number; offset: number } {
    const nextIndex = currentIndex;
    let nextOffset = 0;
    const modelsLength = Math.max(0, itemsLength - 1);

    if (nextIndex > 0) {
        const modelIndex = nextIndex - 1;
        if (modelIndex < nextOffset) {
            nextOffset = modelIndex;
        } else if (modelIndex >= nextOffset + viewportItems) {
            nextOffset = Math.max(0, modelIndex - viewportItems + 1);
        }
    }

    const maxOffset = Math.max(0, modelsLength - viewportItems);
    nextOffset = Math.min(maxOffset, Math.max(0, nextOffset));

    return { index: nextIndex, offset: nextOffset };
}

// Reasoning preset options - defined at module scope to avoid recreation on each render
const REASONING_PRESET_OPTIONS: {
    value: ReasoningPreset;
    label: string;
    description: string;
}[] = [
    {
        value: 'auto',
        label: 'Auto',
        description: 'Let Dexto/provider choose an appropriate reasoning level',
    },
    { value: 'off', label: 'Off', description: 'Disable reasoning (fastest)' },
    { value: 'low', label: 'Low', description: 'Light reasoning, faster responses' },
    { value: 'medium', label: 'Medium', description: 'Balanced reasoning' },
    { value: 'high', label: 'High', description: 'Thorough reasoning' },
    { value: 'max', label: 'Max', description: 'Maximize reasoning within provider limits' },
    { value: 'xhigh', label: 'XHigh', description: 'Extra high (only on some models, e.g. codex)' },
];

function getInitialPresetIndex(
    savedPreset: ReasoningPreset | undefined,
    supportedPresets: ReasoningPreset[]
): number {
    const filteredOptions = REASONING_PRESET_OPTIONS.filter((option) =>
        supportedPresets.includes(option.value)
    );
    if (!savedPreset) return 0;
    const idx = filteredOptions.findIndex((option) => option.value === savedPreset);
    return idx >= 0 ? idx : 0;
}

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
    const { rows: terminalRows } = useTerminalSize();
    const maxVisibleItems = useMemo(() => {
        return getMaxVisibleItemsForTerminalRows({
            rows: terminalRows,
            hardCap: 8,
            reservedRows: 14,
        });
    }, [terminalRows]);
    const [models, setModels] = useState<ModelOption[]>([]);
    const [customModels, setCustomModels] = useState<CustomModel[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [selection, setSelection] = useState({ index: 0, offset: 0 });
    const [searchQuery, setSearchQuery] = useState('');
    const [customModelAction, setCustomModelAction] = useState<
        'edit' | 'default' | 'delete' | null
    >(null);
    const [pendingDeleteConfirm, setPendingDeleteConfirm] = useState(false);
    const selectedIndexRef = useRef(0);
    const deleteTimeoutRef = useRef<NodeJS.Timeout | null>(null);
    const maxVisibleItemsRef = useRef(maxVisibleItems);

    // Reasoning effort sub-step state
    const [pendingReasoningModel, setPendingReasoningModel] = useState<ModelOption | null>(null);
    const [reasoningPresetIndex, setReasoningPresetIndex] = useState(0); // Default to 'Auto' (index 0)
    const [isSettingDefault, setIsSettingDefault] = useState(false); // Track if setting as default vs normal selection
    const [refreshVersion, setRefreshVersion] = useState(0);

    const reasoningPresetOptions = useMemo(() => {
        if (!pendingReasoningModel) return REASONING_PRESET_OPTIONS;
        const support = getReasoningSupport(
            pendingReasoningModel.provider,
            pendingReasoningModel.name
        );
        return REASONING_PRESET_OPTIONS.filter((option) =>
            support.supportedPresets.includes(option.value)
        );
    }, [pendingReasoningModel]);

    // Keep ref in sync
    selectedIndexRef.current = selection.index;
    maxVisibleItemsRef.current = maxVisibleItems;
    const modelsViewportItems = Math.max(1, maxVisibleItems - 1);

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
        setModels([]);
        setCustomModels([]);
        setSearchQuery('');
        setSelection({ index: 0, offset: 0 });
        setCustomModelAction(null);
        setPendingDeleteConfirm(false);
        setPendingReasoningModel(null);
        setIsSettingDefault(false);
        setReasoningPresetIndex(0); // Default to 'Auto'
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
                const defaultReasoningPreset = preferences?.llm.reasoning?.preset;

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
                    if (custom.reasoning?.preset) {
                        modelOption.reasoningPreset = custom.reasoning.preset;
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
                        provider === 'glama' ||
                        provider === 'bedrock'
                    )
                        continue;

                    // Skip ollama, local, and vertex - they'll be added dynamically below
                    if (provider === 'ollama' || provider === 'local' || provider === 'vertex') {
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
                            ...(defaultReasoningPreset &&
                            provider === defaultProvider &&
                            model.name === defaultModel
                                ? { reasoningPreset: defaultReasoningPreset }
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

                // Add Vertex AI models from registry
                const vertexModels = allModels['vertex'];
                if (vertexModels) {
                    for (const model of vertexModels) {
                        modelList.push({
                            provider: 'vertex',
                            name: model.name,
                            displayName: model.displayName,
                            maxInputTokens: model.maxInputTokens,
                            isDefault: defaultProvider === 'vertex' && defaultModel === model.name,
                            isCurrent:
                                currentConfig.provider === 'vertex' &&
                                currentConfig.model === model.name,
                            isCustom: false,
                            ...(defaultReasoningPreset &&
                            defaultProvider === 'vertex' &&
                            defaultModel === model.name
                                ? { reasoningPreset: defaultReasoningPreset }
                                : {}),
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
                        const nextIndex = currentIndex + 1; // +1 for "Add custom" at top
                        const nextMaxVisibleItems = maxVisibleItemsRef.current;
                        const nextModelsViewportItems = Math.max(1, nextMaxVisibleItems - 1);
                        const maxOffset = Math.max(0, modelList.length - nextModelsViewportItems);
                        const nextOffset = Math.min(
                            maxOffset,
                            Math.max(0, currentIndex - nextModelsViewportItems + 1)
                        );

                        selectedIndexRef.current = nextIndex;
                        setSelection({ index: nextIndex, offset: nextOffset });
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

        const query = searchQuery.toLowerCase().replace(/[\s-]+/g, '');
        const filtered = models.filter((model) => {
            const name = model.name.toLowerCase().replace(/[\s-]+/g, '');
            const displayName = (model.displayName || '').toLowerCase().replace(/[\s-]+/g, '');
            const provider = model.provider.toLowerCase().replace(/[\s-]+/g, '');
            return name.includes(query) || displayName.includes(query) || provider.includes(query);
        });

        // Always show "Add custom" when searching (user might want to add what they're searching for)
        return [addCustomOption, ...filtered];
    }, [models, searchQuery]);

    // Keep selection valid and visible when filtering or terminal height changes.
    useEffect(() => {
        setSelection((prev) => {
            const maxIndex = Math.max(0, filteredItems.length - 1);
            const nextIndex = Math.min(prev.index, maxIndex);

            let nextOffset = prev.offset;
            const nextModelsLength = Math.max(0, filteredItems.length - 1);

            if (nextIndex > 0) {
                const modelIndex = nextIndex - 1;
                if (modelIndex < nextOffset) {
                    nextOffset = modelIndex;
                } else if (modelIndex >= nextOffset + modelsViewportItems) {
                    nextOffset = Math.max(0, modelIndex - modelsViewportItems + 1);
                }
            }

            const maxOffset = Math.max(0, nextModelsLength - modelsViewportItems);
            nextOffset = Math.min(maxOffset, Math.max(0, nextOffset));

            if (nextIndex === prev.index && nextOffset === prev.offset) {
                return prev;
            }

            selectedIndexRef.current = nextIndex;
            return { index: nextIndex, offset: nextOffset };
        });
    }, [filteredItems.length, modelsViewportItems]);

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

    const beginReasoningPresetSelection = (item: ModelOption, settingDefault: boolean): boolean => {
        const support = getReasoningSupport(item.provider, item.name);
        if (!support.capable) {
            return false;
        }

        setPendingReasoningModel(item);
        setIsSettingDefault(settingDefault);
        setReasoningPresetIndex(
            getInitialPresetIndex(item.reasoningPreset, support.supportedPresets)
        );
        return true;
    };

    // Expose handleInput method via ref
    useImperativeHandle(
        ref,
        () => ({
            handleInput: (input: string, key: Key): boolean => {
                if (!isVisible) return false;

                // While loading, allow closing but ignore all other input.
                if (isLoading) {
                    if (key.escape) {
                        onClose();
                    }
                    return true;
                }

                // Handle reasoning preset sub-step
                if (pendingReasoningModel) {
                    if (key.escape) {
                        // Go back to model selection
                        setPendingReasoningModel(null);
                        setIsSettingDefault(false);
                        return true;
                    }
                    if (key.upArrow) {
                        if (reasoningPresetOptions.length === 0) return true;
                        setReasoningPresetIndex((prev) =>
                            prev > 0 ? prev - 1 : reasoningPresetOptions.length - 1
                        );
                        return true;
                    }
                    if (key.downArrow) {
                        if (reasoningPresetOptions.length === 0) return true;
                        setReasoningPresetIndex((prev) =>
                            prev < reasoningPresetOptions.length - 1 ? prev + 1 : 0
                        );
                        return true;
                    }
                    if (key.return) {
                        const selectedOption =
                            reasoningPresetOptions[reasoningPresetIndex] ??
                            reasoningPresetOptions[0];
                        const reasoningPreset = selectedOption?.value ?? 'auto';

                        if (isSettingDefault) {
                            // Setting as default model
                            clearActionState();
                            void (async () => {
                                await onSetDefaultModel(
                                    pendingReasoningModel.provider,
                                    pendingReasoningModel.name,
                                    pendingReasoningModel.displayName,
                                    pendingReasoningModel.baseURL,
                                    reasoningPreset
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
                                reasoningPreset
                            );
                        }
                        setPendingReasoningModel(null);
                        setIsSettingDefault(false);
                        return true;
                    }
                    return true; // Consume all input in reasoning preset mode
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

                // Right arrow - enter/advance action mode for custom or selectable models
                if (key.rightArrow) {
                    if (!isSelectableItem) return false;

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
                        return true;
                    }

                    if (customModelAction === 'delete') {
                        // Use Enter for delete confirmation/execution to avoid accidental deletes.
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
                        selectedIndexRef.current = 0;
                        setSelection({ index: 0, offset: 0 });
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
                    selectedIndexRef.current = nextIndex;
                    setSelection((prev) => {
                        let nextOffset = prev.offset;
                        const nextModelsLength = Math.max(0, itemsLength - 1);

                        if (nextIndex > 0) {
                            const modelIndex = nextIndex - 1;
                            if (modelIndex < prev.offset) {
                                nextOffset = modelIndex;
                            } else if (modelIndex >= prev.offset + modelsViewportItems) {
                                nextOffset = Math.max(0, modelIndex - modelsViewportItems + 1);
                            }
                        }
                        const maxOffset = Math.max(0, nextModelsLength - modelsViewportItems);
                        nextOffset = Math.min(maxOffset, Math.max(0, nextOffset));
                        return { index: nextIndex, offset: nextOffset };
                    });
                    return true;
                }

                if (key.downArrow) {
                    // Clear action state on vertical navigation
                    if (customModelAction) {
                        clearActionState();
                    }
                    const nextIndex = (selectedIndexRef.current + 1) % itemsLength;
                    selectedIndexRef.current = nextIndex;
                    setSelection((prev) => {
                        let nextOffset = prev.offset;
                        const nextModelsLength = Math.max(0, itemsLength - 1);

                        if (nextIndex > 0) {
                            const modelIndex = nextIndex - 1;
                            if (modelIndex < prev.offset) {
                                nextOffset = modelIndex;
                            } else if (modelIndex >= prev.offset + modelsViewportItems) {
                                nextOffset = Math.max(0, modelIndex - modelsViewportItems + 1);
                            }
                        }
                        const maxOffset = Math.max(0, nextModelsLength - modelsViewportItems);
                        nextOffset = Math.min(maxOffset, Math.max(0, nextOffset));
                        return { index: nextIndex, offset: nextOffset };
                    });
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
                            if (beginReasoningPresetSelection(item, true)) {
                                return true;
                            }

                            clearActionState();
                            void (async () => {
                                await onSetDefaultModel(
                                    item.provider,
                                    item.name,
                                    item.displayName,
                                    item.baseURL,
                                    item.reasoningPreset
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
                        if (beginReasoningPresetSelection(item, false)) {
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
            isLoading,
            filteredItems,
            maxVisibleItems,
            modelsViewportItems,
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
            reasoningPresetIndex,
            reasoningPresetOptions,
            isSettingDefault,
            beginReasoningPresetSelection,
        ]
    );

    if (!isVisible) return null;

    if (pendingReasoningModel) {
        const totalOptions = reasoningPresetOptions.length;
        const reasoningVisibleItems = Math.min(maxVisibleItems, totalOptions);
        const reasoningOffset = Math.min(
            Math.max(0, reasoningPresetIndex - reasoningVisibleItems + 1),
            Math.max(0, totalOptions - reasoningVisibleItems)
        );
        const visibleReasoningOptions = reasoningPresetOptions.slice(
            reasoningOffset,
            reasoningOffset + reasoningVisibleItems
        );
        const selectedReasoningOption =
            reasoningPresetOptions[reasoningPresetIndex] ?? reasoningPresetOptions[0];

        return (
            <Box flexDirection="column">
                <Box paddingX={0} paddingY={0}>
                    <Text color="cyan" bold>
                        Reasoning Preset
                        {isSettingDefault ? <Text color="gray"> (default)</Text> : null}
                    </Text>
                </Box>
                <Box paddingX={0} paddingY={0}>
                    <Text color="gray" wrap="truncate-end">
                        {pendingReasoningModel.displayName || pendingReasoningModel.name}
                    </Text>
                </Box>
                <Box flexDirection="column" height={maxVisibleItems} marginTop={1}>
                    {Array.from({ length: maxVisibleItems }, (_, rowIndex) => {
                        const option = visibleReasoningOptions[rowIndex];
                        if (!option) {
                            return (
                                <Box key={`reasoning-empty-${rowIndex}`} paddingX={0} paddingY={0}>
                                    <Text> </Text>
                                </Box>
                            );
                        }

                        const actualIndex = reasoningOffset + rowIndex;
                        const isSelected = actualIndex === reasoningPresetIndex;
                        return (
                            <Box key={option.value} paddingX={0} paddingY={0}>
                                <Text
                                    color={isSelected ? 'cyan' : 'gray'}
                                    bold={isSelected}
                                    wrap="truncate-end"
                                >
                                    {isSelected ? '›' : ' '} {option.label}
                                </Text>
                            </Box>
                        );
                    })}
                </Box>
                <Box paddingX={0} paddingY={0} marginTop={1}>
                    <Text color="gray" wrap="truncate-end">
                        {selectedReasoningOption?.description ?? ''}
                    </Text>
                </Box>
                <Box paddingX={0} paddingY={0}>
                    <HintBar hints={['↑↓ navigate', 'Enter select', 'Esc back']} />
                </Box>
            </Box>
        );
    }

    const selectedIndex = selection.index;
    const scrollOffset = selection.offset;
    const modelsOnly = filteredItems.slice(1) as ModelOption[];
    const visibleModels = modelsOnly.slice(scrollOffset, scrollOffset + modelsViewportItems);
    const selectedItem = filteredItems[selectedIndex];
    const hasActionableItems = selectedItem && !isAddCustomOption(selectedItem);

    let detailLine = '';
    if (isLoading) {
        detailLine = 'Loading models…';
    } else if (customModelAction === 'delete' && pendingDeleteConfirm) {
        detailLine = 'Confirm delete: press Enter again';
    } else if (customModelAction) {
        const label =
            customModelAction === 'edit'
                ? 'Edit'
                : customModelAction === 'default'
                  ? 'Set as default'
                  : 'Delete';
        detailLine = `Action: ${label}`;
    } else if (searchQuery.trim() && filteredItems.length <= 1) {
        detailLine = 'No models match your search';
    } else if (!selectedItem) {
        detailLine = '';
    } else if (isAddCustomOption(selectedItem)) {
        detailLine = 'Enter to add a custom model';
    } else {
        const provider = getLLMProviderDisplayName(selectedItem.provider);
        const name = selectedItem.displayName || selectedItem.name;
        const flags: string[] = [];
        if (selectedItem.isDefault) flags.push('default');
        if (selectedItem.isCurrent) flags.push('current');
        detailLine =
            flags.length > 0
                ? `${name} (${provider}) • ${flags.join(', ')}`
                : `${name} (${provider})`;
    }

    return (
        <Box flexDirection="column">
            {/* Header */}
            <Box paddingX={0} paddingY={0}>
                <Text color="cyan" bold>
                    Models
                </Text>
            </Box>

            {/* Search input */}
            <Box paddingX={0} paddingY={0} marginTop={1}>
                <Text color="gray">Search: </Text>
                <Text color={searchQuery ? 'white' : 'gray'} wrap="truncate-end">
                    {searchQuery || 'Type to filter models…'}
                </Text>
            </Box>

            {/* Items */}
            <Box flexDirection="column" marginTop={1}>
                <Box paddingX={0} paddingY={0}>
                    <Text
                        color={selectedIndex === 0 ? 'green' : 'gray'}
                        bold={selectedIndex === 0}
                        wrap="truncate-end"
                    >
                        {getRowPrefix({
                            isSelected: selectedIndex === 0,
                            isDefault: false,
                            isCurrent: false,
                            isCustom: false,
                        })}{' '}
                        Add custom model…
                    </Text>
                </Box>
                <Box flexDirection="column" height={modelsViewportItems}>
                    {isLoading || modelsOnly.length === 0
                        ? Array.from({ length: modelsViewportItems }, (_, index) => (
                              <Box key={`model-empty-${index}`} paddingX={0} paddingY={0}>
                                  <Text> </Text>
                              </Box>
                          ))
                        : Array.from({ length: modelsViewportItems }, (_, rowIndex) => {
                              const item = visibleModels[rowIndex];
                              if (!item) {
                                  return (
                                      <Box
                                          key={`model-empty-${rowIndex}`}
                                          paddingX={0}
                                          paddingY={0}
                                      >
                                          <Text> </Text>
                                      </Box>
                                  );
                              }

                              const actualIndex = 1 + scrollOffset + rowIndex;
                              const isSelected = actualIndex === selectedIndex;

                              const providerDisplay = getLLMProviderDisplayName(item.provider);
                              const name = item.displayName || item.name;
                              const prefix = getRowPrefix({
                                  isSelected,
                                  isDefault: item.isDefault,
                                  isCurrent: item.isCurrent,
                                  isCustom: item.isCustom,
                              });

                              return (
                                  <Box
                                      key={`${item.provider}-${item.name}-${item.isCustom ? 'custom' : 'registry'}`}
                                      flexDirection="row"
                                      paddingX={0}
                                      paddingY={0}
                                  >
                                      <Box flexGrow={1}>
                                          <Text
                                              color={isSelected ? 'cyan' : 'gray'}
                                              bold={isSelected}
                                              wrap="truncate-end"
                                          >
                                              {prefix} {name} ({providerDisplay})
                                          </Text>
                                      </Box>
                                      {isSelected && (
                                          <Box flexDirection="row" marginLeft={1}>
                                              {item.isCustom && (
                                                  <>
                                                      <Text
                                                          color={
                                                              customModelAction === 'edit'
                                                                  ? 'green'
                                                                  : 'gray'
                                                          }
                                                          bold={customModelAction === 'edit'}
                                                          inverse={customModelAction === 'edit'}
                                                      >
                                                          {' '}
                                                          Edit{' '}
                                                      </Text>
                                                      <Text> </Text>
                                                  </>
                                              )}
                                              <Text
                                                  color={
                                                      customModelAction === 'default'
                                                          ? 'cyan'
                                                          : 'gray'
                                                  }
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
                                                          color={
                                                              customModelAction === 'delete'
                                                                  ? 'red'
                                                                  : 'gray'
                                                          }
                                                          bold={customModelAction === 'delete'}
                                                          inverse={customModelAction === 'delete'}
                                                      >
                                                          {' '}
                                                          Delete{' '}
                                                      </Text>
                                                  </>
                                              )}
                                          </Box>
                                      )}
                                  </Box>
                              );
                          })}
                </Box>
            </Box>

            <Box paddingX={0} paddingY={0} marginTop={1}>
                <Text color="gray" wrap="truncate-end">
                    {detailLine}
                </Text>
            </Box>

            <Box paddingX={0} paddingY={0}>
                <HintBar
                    hints={[
                        '↑↓ navigate',
                        'Enter select',
                        'Esc close',
                        hasActionableItems ? '←→ actions' : '',
                    ]}
                />
            </Box>
        </Box>
    );
});

export default ModelSelector;

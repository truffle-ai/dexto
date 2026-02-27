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
import type { DextoAgent, LLMProvider, ReasoningVariant } from '@dexto/core';
import {
    listOllamaModels,
    DEFAULT_OLLAMA_URL,
    getLocalModelById,
    getCuratedModelsForProvider,
    getOpenRouterModelCacheInfo,
    getReasoningProfile,
    refreshOpenRouterModelCache,
} from '@dexto/core';
import {
    loadCustomModels,
    deleteCustomModel,
    getAllInstalledModels,
    loadGlobalPreferences,
    isDextoAuthEnabled,
    loadModelPickerState,
    toggleFavoriteModel,
    toModelPickerKey,
    type CustomModel,
    type ModelPickerState,
} from '@dexto/agent-management';
import { getLLMProviderDisplayName } from '../../utils/llm-provider-display.js';
import { getMaxVisibleItemsForTerminalRows } from '../../utils/overlaySizing.js';
import {
    getCachedStringWidth,
    stripUnsafeCharacters,
    toCodePoints,
} from '../../utils/textUtils.js';
import { HintBar } from '../shared/HintBar.js';

type ModelSelectorTab = 'all-models' | 'featured' | 'recents' | 'favorites' | 'custom';
const FEATURED_SECTION_LIMIT = 8;
const MODEL_SELECTOR_TABS: ReadonlyArray<{ id: ModelSelectorTab; label: string }> = [
    { id: 'all-models', label: 'All' },
    { id: 'featured', label: 'Featured' },
    { id: 'recents', label: 'Recents' },
    { id: 'favorites', label: 'Favorites' },
    { id: 'custom', label: 'Custom' },
];

function getNextModelSelectorTab(current: ModelSelectorTab): ModelSelectorTab {
    const currentIndex = MODEL_SELECTOR_TABS.findIndex((tab) => tab.id === current);
    const nextIndex = currentIndex < 0 ? 0 : (currentIndex + 1) % MODEL_SELECTOR_TABS.length;
    return MODEL_SELECTOR_TABS[nextIndex]?.id ?? 'all-models';
}

function getPreviousModelSelectorTab(current: ModelSelectorTab): ModelSelectorTab {
    const currentIndex = MODEL_SELECTOR_TABS.findIndex((tab) => tab.id === current);
    const previousIndex =
        currentIndex < 0
            ? 0
            : (currentIndex - 1 + MODEL_SELECTOR_TABS.length) % MODEL_SELECTOR_TABS.length;
    return MODEL_SELECTOR_TABS[previousIndex]?.id ?? 'all-models';
}
interface ModelSelectorProps {
    isVisible: boolean;
    onSelectModel: (
        provider: LLMProvider,
        model: string,
        displayName?: string,
        baseURL?: string,
        reasoningVariant?: ReasoningVariant
    ) => void;
    onSetDefaultModel: (
        provider: LLMProvider,
        model: string,
        displayName?: string,
        baseURL?: string,
        reasoningVariant?: ReasoningVariant
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
    reasoningVariant?: ReasoningVariant;
    /** For gateway providers like dexto-nova, the original provider this model comes from */
    originalProvider?: LLMProvider;
}

// Special option for adding custom model
interface AddCustomOption {
    type: 'add-custom';
}

type SelectorItem = ModelOption | AddCustomOption;

function toModelIdentityKey(model: Pick<ModelOption, 'provider' | 'name'>): string {
    return toModelPickerKey({ provider: model.provider, model: model.name });
}

function normalizeLineText(value: string): string {
    return stripUnsafeCharacters(value).replace(/\r?\n/g, ' ').replace(/\s+/g, ' ').trim();
}

function formatLineToWidth(value: string, width: number): string {
    if (width <= 0) return '';

    const normalized = normalizeLineText(value);
    if (!normalized) {
        return ' '.repeat(width);
    }

    const normalizedWidth = getCachedStringWidth(normalized);
    if (normalizedWidth <= width) {
        return normalized + ' '.repeat(width - normalizedWidth);
    }

    if (width === 1) {
        return '…';
    }

    const ellipsis = '…';
    const targetWidth = width - getCachedStringWidth(ellipsis);
    let truncated = '';

    for (const char of toCodePoints(normalized)) {
        const candidate = `${truncated}${char}`;
        if (getCachedStringWidth(candidate) > targetWidth) {
            break;
        }
        truncated = candidate;
    }

    const withEllipsis = `${truncated}${ellipsis}`;
    const finalWidth = getCachedStringWidth(withEllipsis);
    if (finalWidth >= width) {
        return withEllipsis;
    }

    return withEllipsis + ' '.repeat(width - finalWidth);
}

function isAddCustomOption(item: SelectorItem): item is AddCustomOption {
    return 'type' in item && item.type === 'add-custom';
}

function isModelOption(item: SelectorItem): item is ModelOption {
    return !('type' in item);
}

function getRowPrefix({
    isSelected,
    isDefault,
    isCurrent,
    isCustom,
    isFavorite,
}: {
    isSelected: boolean;
    isDefault: boolean;
    isCurrent: boolean;
    isCustom: boolean;
    isFavorite: boolean;
}): string {
    return `${isSelected ? '›' : ' '} ${isDefault ? '✓' : ' '} ${isCurrent ? '●' : ' '} ${
        isFavorite ? '★' : isCustom ? '◇' : ' '
    }`;
}

type ReasoningOption = {
    value: ReasoningVariant;
    label: string;
    description: string;
};

const REASONING_VARIANT_DESCRIPTIONS: Readonly<Record<string, string>> = {
    disabled: 'Disable reasoning (fastest)',
    none: 'Disable reasoning (fastest)',
    enabled: 'Enable provider default reasoning',
    minimal: 'Minimal reasoning',
    low: 'Light reasoning, faster responses',
    medium: 'Balanced reasoning',
    high: 'Thorough reasoning',
    max: 'Maximum reasoning within provider limits',
    xhigh: 'Extra high reasoning',
};

function buildReasoningVariantOptions(
    support: ReturnType<typeof getReasoningProfile>
): ReasoningOption[] {
    return support.variants.map((variant) => ({
        value: variant.id,
        label:
            variant.id === support.defaultVariant
                ? `${variant.label} (Recommended)`
                : variant.label,
        description:
            REASONING_VARIANT_DESCRIPTIONS[variant.id] ?? 'Model/provider-native reasoning variant',
    }));
}

function getInitialVariantIndex(
    savedVariant: ReasoningVariant | undefined,
    options: ReasoningOption[],
    defaultVariant: string | undefined
): number {
    const preferredVariant = savedVariant ?? defaultVariant;
    if (!preferredVariant) return 0;
    const idx = options.findIndex((option) => option.value === preferredVariant);
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
    const { rows: terminalRows, columns: terminalColumns } = useTerminalSize();
    const overlayWidth = useMemo(() => Math.max(20, terminalColumns - 2), [terminalColumns]);
    const maxVisibleItems = useMemo(() => {
        return getMaxVisibleItemsForTerminalRows({
            rows: terminalRows,
            hardCap: 8,
            reservedRows: 14,
        });
    }, [terminalRows]);
    const [models, setModels] = useState<ModelOption[]>([]);
    const [customModels, setCustomModels] = useState<CustomModel[]>([]);
    const [modelPickerState, setModelPickerState] = useState<ModelPickerState | null>(null);
    const [activeTab, setActiveTab] = useState<ModelSelectorTab>('all-models');
    const [isLoading, setIsLoading] = useState(false);
    const [selection, setSelection] = useState({ index: 0, offset: 0 });
    const [searchQuery, setSearchQuery] = useState('');
    const [customModelAction, setCustomModelAction] = useState<
        'favorite' | 'default' | 'edit' | 'delete' | null
    >(null);
    const [pendingDeleteConfirm, setPendingDeleteConfirm] = useState(false);
    const selectedIndexRef = useRef(0);
    const deleteTimeoutRef = useRef<NodeJS.Timeout | null>(null);
    const maxVisibleItemsRef = useRef(maxVisibleItems);

    // Reasoning variant sub-step state
    const [pendingReasoningModel, setPendingReasoningModel] = useState<ModelOption | null>(null);
    const [reasoningVariantIndex, setReasoningVariantIndex] = useState(0);
    const [isSettingDefault, setIsSettingDefault] = useState(false); // Track if setting as default vs normal selection
    const [refreshVersion, setRefreshVersion] = useState(0);

    const reasoningVariantOptions = useMemo(() => {
        if (!pendingReasoningModel) return [];
        const support = getReasoningProfile(
            pendingReasoningModel.provider,
            pendingReasoningModel.name
        );
        return buildReasoningVariantOptions(support);
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
        setReasoningVariantIndex(0);
        setActiveTab('all-models');
        setModelPickerState(null);
        if (deleteTimeoutRef.current) {
            clearTimeout(deleteTimeoutRef.current);
            deleteTimeoutRef.current = null;
        }

        const fetchModels = async () => {
            try {
                try {
                    const cacheInfo = getOpenRouterModelCacheInfo();
                    if (cacheInfo.modelCount === 0) {
                        await refreshOpenRouterModelCache({ force: true, timeoutMs: 10_000 });
                    }
                } catch (error) {
                    agent.logger.debug(
                        `OpenRouter catalog refresh skipped: ${error instanceof Error ? error.message : String(error)}`
                    );
                }

                const [allModels, providers, currentConfig, loadedCustomModels, preferences] =
                    await Promise.all([
                        Promise.resolve(agent.getSupportedModels()),
                        Promise.resolve(agent.getSupportedProviders()),
                        Promise.resolve(agent.getCurrentLLMConfig()),
                        loadCustomModels(),
                        loadGlobalPreferences().catch(() => null),
                    ]);
                const pickerState = await loadModelPickerState().catch(() => null);

                const modelList: ModelOption[] = [];
                const defaultProvider = preferences?.llm.provider;
                const defaultModel = preferences?.llm.model;
                const defaultBaseURL = preferences?.llm.baseURL;
                const defaultReasoningVariant = preferences?.llm.reasoning?.variant;

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
                    const customProvider: LLMProvider = custom.provider;
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
                    if (custom.reasoning?.variant) {
                        modelOption.reasoningVariant = custom.reasoning.variant;
                    }
                    modelList.push(modelOption);
                }

                // Add registry models
                for (const provider of providers) {
                    // Skip custom-only providers that don't have a static model list
                    // These are only accessible via the "Add custom model" wizard
                    if (
                        provider === 'openai-compatible' ||
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
                            ...(defaultReasoningVariant &&
                            provider === defaultProvider &&
                            model.name === defaultModel
                                ? { reasoningVariant: defaultReasoningVariant }
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
                            ...(defaultReasoningVariant &&
                            defaultProvider === 'vertex' &&
                            defaultModel === model.name
                                ? { reasoningVariant: defaultReasoningVariant }
                                : {}),
                        });
                    }
                }

                if (!cancelled) {
                    const dedupedByKey = new Map<string, ModelOption>();
                    const dedupeOrder: string[] = [];

                    for (const model of modelList) {
                        const key = toModelIdentityKey(model);
                        const existing = dedupedByKey.get(key);

                        if (!existing) {
                            dedupedByKey.set(key, model);
                            dedupeOrder.push(key);
                            continue;
                        }

                        const preferred = model.isCustom && !existing.isCustom ? model : existing;
                        const secondary = preferred === existing ? model : existing;
                        const mergedBaseURL = preferred.baseURL ?? secondary.baseURL;
                        const mergedReasoningVariant =
                            preferred.reasoningVariant ?? secondary.reasoningVariant;
                        const mergedOriginalProvider =
                            preferred.originalProvider ?? secondary.originalProvider;
                        const mergedModel: ModelOption = {
                            ...preferred,
                            isDefault: preferred.isDefault || secondary.isDefault,
                            isCurrent: preferred.isCurrent || secondary.isCurrent,
                            displayName: preferred.displayName ?? secondary.displayName,
                            maxInputTokens: Math.max(
                                preferred.maxInputTokens,
                                secondary.maxInputTokens
                            ),
                        };
                        if (mergedBaseURL !== undefined) {
                            mergedModel.baseURL = mergedBaseURL;
                        }
                        if (mergedReasoningVariant !== undefined) {
                            mergedModel.reasoningVariant = mergedReasoningVariant;
                        }
                        if (mergedOriginalProvider !== undefined) {
                            mergedModel.originalProvider = mergedOriginalProvider;
                        }
                        dedupedByKey.set(key, mergedModel);
                    }

                    const dedupedModelList = dedupeOrder
                        .map((key) => dedupedByKey.get(key))
                        .filter((model): model is ModelOption => model !== undefined);

                    setModels(dedupedModelList);
                    setCustomModels(loadedCustomModels);
                    setModelPickerState(pickerState);
                    setIsLoading(false);

                    // Set initial selection to current model
                    const currentIndex = dedupedModelList.findIndex((m) => m.isCurrent);
                    if (currentIndex >= 0) {
                        const nextIndex = currentIndex;
                        const nextMaxVisibleItems = maxVisibleItemsRef.current;
                        const maxOffset = Math.max(
                            0,
                            dedupedModelList.length - nextMaxVisibleItems
                        );
                        const nextOffset = Math.min(
                            maxOffset,
                            Math.max(0, currentIndex - nextMaxVisibleItems + 1)
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
                    setModelPickerState(null);
                    setIsLoading(false);
                }
            }
        };

        void fetchModels();

        return () => {
            cancelled = true;
        };
    }, [isVisible, agent, refreshVersion]);

    const favoriteKeySet = useMemo(
        () =>
            new Set(
                (modelPickerState?.favorites ?? []).map((entry) =>
                    toModelPickerKey({
                        provider: entry.provider,
                        model: entry.model,
                    })
                )
            ),
        [modelPickerState]
    );

    const matchesSearch = useCallback(
        (model: ModelOption): boolean => {
            if (!searchQuery.trim()) {
                return true;
            }

            const query = searchQuery.toLowerCase().replace(/[\s-]+/g, '');
            const name = model.name.toLowerCase().replace(/[\s-]+/g, '');
            const displayName = (model.displayName || '').toLowerCase().replace(/[\s-]+/g, '');
            const provider = model.provider.toLowerCase().replace(/[\s-]+/g, '');
            return name.includes(query) || displayName.includes(query) || provider.includes(query);
        },
        [searchQuery]
    );

    // Filter models based on active view and search query.
    const filteredItems = useMemo((): SelectorItem[] => {
        const addCustomOption: AddCustomOption = { type: 'add-custom' };
        const hasSearchQuery = searchQuery.trim().length > 0;
        const modelsByKey = new Map<string, ModelOption>(
            models.map((model) => [
                toModelPickerKey({ provider: model.provider, model: model.name }),
                model,
            ])
        );
        const toUniqueMatchingModels = (
            candidates: Array<ModelOption | undefined>,
            limit?: number
        ): ModelOption[] => {
            const deduped: ModelOption[] = [];
            const seen = new Set<string>();

            for (const candidate of candidates) {
                if (!candidate || !matchesSearch(candidate)) {
                    continue;
                }
                const key = toModelPickerKey({
                    provider: candidate.provider,
                    model: candidate.name,
                });
                if (seen.has(key)) {
                    continue;
                }
                seen.add(key);
                deduped.push(candidate);
                if (limit !== undefined && deduped.length >= limit) {
                    break;
                }
            }

            return deduped;
        };

        const providersInModels = Array.from(
            new Set(models.map((model) => model.provider))
        ) as LLMProvider[];
        const featuredCandidates: Array<ModelOption | undefined> = [];
        for (const provider of providersInModels) {
            for (const curatedModel of getCuratedModelsForProvider(provider)) {
                const key = toModelPickerKey({
                    provider,
                    model: curatedModel.name,
                });
                featuredCandidates.push(modelsByKey.get(key));
            }
        }

        const recentsFromState = (modelPickerState?.recents ?? []).map((entry) =>
            modelsByKey.get(toModelPickerKey({ provider: entry.provider, model: entry.model }))
        );
        const favoritesFromState = (modelPickerState?.favorites ?? []).map((entry) =>
            modelsByKey.get(toModelPickerKey({ provider: entry.provider, model: entry.model }))
        );
        const customCandidates = models.filter((model) => model.isCustom);
        const allModels = models;

        const tabModels = hasSearchQuery
            ? toUniqueMatchingModels(allModels)
            : activeTab === 'all-models'
              ? toUniqueMatchingModels(allModels)
              : activeTab === 'featured'
                ? toUniqueMatchingModels(featuredCandidates, FEATURED_SECTION_LIMIT)
                : activeTab === 'recents'
                  ? toUniqueMatchingModels(recentsFromState)
                  : activeTab === 'favorites'
                    ? toUniqueMatchingModels(favoritesFromState)
                    : toUniqueMatchingModels(customCandidates);

        return activeTab === 'custom' && !hasSearchQuery
            ? [addCustomOption, ...tabModels]
            : tabModels;
    }, [activeTab, matchesSearch, modelPickerState, models, searchQuery]);
    const hasAddCustomOption = activeTab === 'custom' && searchQuery.trim().length === 0;
    const modelStartIndex = hasAddCustomOption ? 1 : 0;
    const listViewportItems = hasAddCustomOption ? modelsViewportItems : maxVisibleItems;

    // Keep selection valid and visible when filtering or terminal height changes.
    useEffect(() => {
        setSelection((prev) => {
            const maxIndex = Math.max(0, filteredItems.length - 1);
            const nextIndex = Math.min(prev.index, maxIndex);

            let nextOffset = prev.offset;
            const nextModelsLength = Math.max(0, filteredItems.length - modelStartIndex);

            if (nextIndex >= modelStartIndex) {
                const modelIndex = nextIndex - modelStartIndex;
                if (modelIndex < nextOffset) {
                    nextOffset = modelIndex;
                } else if (modelIndex >= nextOffset + listViewportItems) {
                    nextOffset = Math.max(0, modelIndex - listViewportItems + 1);
                }
            } else {
                nextOffset = 0;
            }

            const maxOffset = Math.max(0, nextModelsLength - listViewportItems);
            nextOffset = Math.min(maxOffset, Math.max(0, nextOffset));

            if (nextIndex === prev.index && nextOffset === prev.offset) {
                return prev;
            }

            selectedIndexRef.current = nextIndex;
            return { index: nextIndex, offset: nextOffset };
        });
    }, [filteredItems.length, listViewportItems, modelStartIndex]);

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

    const beginReasoningVariantSelection = (
        item: ModelOption,
        settingDefault: boolean
    ): boolean => {
        const support = getReasoningProfile(item.provider, item.name);
        if (!support.capable) {
            return false;
        }

        const options = buildReasoningVariantOptions(support);

        setPendingReasoningModel(item);
        setIsSettingDefault(settingDefault);
        setReasoningVariantIndex(
            getInitialVariantIndex(item.reasoningVariant, options, support.defaultVariant)
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

                // Handle reasoning variant sub-step
                if (pendingReasoningModel) {
                    if (key.escape) {
                        // Go back to model selection
                        setPendingReasoningModel(null);
                        setIsSettingDefault(false);
                        return true;
                    }
                    if (key.upArrow) {
                        if (reasoningVariantOptions.length === 0) return true;
                        setReasoningVariantIndex((prev) =>
                            prev > 0 ? prev - 1 : reasoningVariantOptions.length - 1
                        );
                        return true;
                    }
                    if (key.downArrow) {
                        if (reasoningVariantOptions.length === 0) return true;
                        setReasoningVariantIndex((prev) =>
                            prev < reasoningVariantOptions.length - 1 ? prev + 1 : 0
                        );
                        return true;
                    }
                    if (key.return) {
                        const selectedOption =
                            reasoningVariantOptions[reasoningVariantIndex] ??
                            reasoningVariantOptions[0];
                        const reasoningVariant = selectedOption?.value;
                        if (!reasoningVariant) {
                            setPendingReasoningModel(null);
                            setIsSettingDefault(false);
                            return true;
                        }

                        if (isSettingDefault) {
                            // Setting as default model
                            clearActionState();
                            void (async () => {
                                await onSetDefaultModel(
                                    pendingReasoningModel.provider,
                                    pendingReasoningModel.name,
                                    pendingReasoningModel.displayName,
                                    pendingReasoningModel.baseURL,
                                    reasoningVariant
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
                                reasoningVariant
                            );
                        }
                        setPendingReasoningModel(null);
                        setIsSettingDefault(false);
                        return true;
                    }
                    return true; // Consume all input in reasoning variant mode
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
                const selectedModel =
                    currentItem && isModelOption(currentItem) ? currentItem : null;
                const isCustomActionItem = selectedModel?.isCustom ?? false;
                const isSelectableItem = selectedModel !== null;

                if (key.tab) {
                    clearActionState();
                    setActiveTab((prev) =>
                        key.shift
                            ? getPreviousModelSelectorTab(prev)
                            : getNextModelSelectorTab(prev)
                    );
                    selectedIndexRef.current = 0;
                    setSelection({ index: 0, offset: 0 });
                    return true;
                }

                if (key.ctrl && (input === 'f' || input === 'F') && isSelectableItem) {
                    const item = selectedModel;
                    if (!item) return true;
                    clearActionState();
                    void (async () => {
                        try {
                            await toggleFavoriteModel({
                                provider: item.provider,
                                model: item.name,
                            });
                            const nextState = await loadModelPickerState();
                            setModelPickerState(nextState);
                        } catch (error) {
                            agent.logger.error(
                                `Failed to toggle favorite model: ${
                                    error instanceof Error ? error.message : 'Unknown error'
                                }`
                            );
                        }
                    })();
                    return true;
                }

                // Right arrow - enter/advance action mode for custom or selectable models
                if (key.rightArrow) {
                    if (!isSelectableItem) return false;

                    if (customModelAction === null) {
                        setCustomModelAction('favorite');
                        return true;
                    }

                    if (customModelAction === 'favorite') {
                        setCustomModelAction('default');
                        return true;
                    }

                    if (customModelAction === 'default') {
                        if (isCustomActionItem) {
                            setCustomModelAction('edit');
                            return true;
                        }
                        return true;
                    }

                    if (customModelAction === 'edit') {
                        if (isCustomActionItem) {
                            setCustomModelAction('delete');
                            setPendingDeleteConfirm(false);
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
                        setCustomModelAction('edit');
                        setPendingDeleteConfirm(false);
                        if (deleteTimeoutRef.current) {
                            clearTimeout(deleteTimeoutRef.current);
                            deleteTimeoutRef.current = null;
                        }
                        return true;
                    }

                    if (customModelAction === 'default') {
                        setCustomModelAction('favorite');
                        return true;
                    }

                    if (customModelAction === 'edit') {
                        setCustomModelAction('default');
                        return true;
                    }

                    if (customModelAction === 'favorite') {
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
                        const nextModelsLength = Math.max(0, itemsLength - modelStartIndex);

                        if (nextIndex >= modelStartIndex) {
                            const modelIndex = nextIndex - modelStartIndex;
                            if (modelIndex < prev.offset) {
                                nextOffset = modelIndex;
                            } else if (modelIndex >= prev.offset + listViewportItems) {
                                nextOffset = Math.max(0, modelIndex - listViewportItems + 1);
                            }
                        } else {
                            nextOffset = 0;
                        }
                        const maxOffset = Math.max(0, nextModelsLength - listViewportItems);
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
                        const nextModelsLength = Math.max(0, itemsLength - modelStartIndex);

                        if (nextIndex >= modelStartIndex) {
                            const modelIndex = nextIndex - modelStartIndex;
                            if (modelIndex < prev.offset) {
                                nextOffset = modelIndex;
                            } else if (modelIndex >= prev.offset + listViewportItems) {
                                nextOffset = Math.max(0, modelIndex - listViewportItems + 1);
                            }
                        } else {
                            nextOffset = 0;
                        }
                        const maxOffset = Math.max(0, nextModelsLength - listViewportItems);
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
                        if (customModelAction === 'favorite') {
                            void (async () => {
                                try {
                                    await toggleFavoriteModel({
                                        provider: item.provider,
                                        model: item.name,
                                    });
                                    const nextState = await loadModelPickerState();
                                    setModelPickerState(nextState);
                                } catch (error) {
                                    agent.logger.error(
                                        `Failed to toggle favorite model: ${
                                            error instanceof Error ? error.message : 'Unknown error'
                                        }`
                                    );
                                }
                            })();
                            return true;
                        }

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
                            if (beginReasoningVariantSelection(item, true)) {
                                return true;
                            }

                            clearActionState();
                            void (async () => {
                                await onSetDefaultModel(
                                    item.provider,
                                    item.name,
                                    item.displayName,
                                    item.baseURL,
                                    item.reasoningVariant
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
                        if (beginReasoningVariantSelection(item, false)) {
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
            listViewportItems,
            modelStartIndex,
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
            reasoningVariantIndex,
            reasoningVariantOptions,
            isSettingDefault,
            activeTab,
            agent,
            beginReasoningVariantSelection,
        ]
    );

    if (!isVisible) return null;

    const blankLine = ' '.repeat(overlayWidth);

    if (pendingReasoningModel) {
        const totalOptions = reasoningVariantOptions.length;
        const reasoningVisibleItems = Math.min(maxVisibleItems, totalOptions);
        const reasoningOffset = Math.min(
            Math.max(0, reasoningVariantIndex - reasoningVisibleItems + 1),
            Math.max(0, totalOptions - reasoningVisibleItems)
        );
        const visibleReasoningOptions = reasoningVariantOptions.slice(
            reasoningOffset,
            reasoningOffset + reasoningVisibleItems
        );
        const selectedReasoningOption =
            reasoningVariantOptions[reasoningVariantIndex] ?? reasoningVariantOptions[0];

        return (
            <Box flexDirection="column" width={overlayWidth}>
                <Box paddingX={0} paddingY={0} width={overlayWidth}>
                    <Text color="cyan" bold>
                        Reasoning Variant
                        {isSettingDefault ? <Text color="gray"> (default)</Text> : null}
                    </Text>
                </Box>
                <Box paddingX={0} paddingY={0} width={overlayWidth}>
                    <Text color="gray">
                        {formatLineToWidth(
                            pendingReasoningModel.displayName || pendingReasoningModel.name,
                            overlayWidth
                        )}
                    </Text>
                </Box>
                <Box
                    flexDirection="column"
                    height={maxVisibleItems}
                    marginTop={1}
                    width={overlayWidth}
                >
                    {Array.from({ length: maxVisibleItems }, (_, rowIndex) => {
                        const option = visibleReasoningOptions[rowIndex];
                        if (!option) {
                            return (
                                <Box
                                    key={`reasoning-empty-${rowIndex}`}
                                    paddingX={0}
                                    paddingY={0}
                                    width={overlayWidth}
                                >
                                    <Text>{blankLine}</Text>
                                </Box>
                            );
                        }

                        const actualIndex = reasoningOffset + rowIndex;
                        const isSelected = actualIndex === reasoningVariantIndex;
                        return (
                            <Box key={option.value} paddingX={0} paddingY={0} width={overlayWidth}>
                                <Text color={isSelected ? 'cyan' : 'gray'} bold={isSelected}>
                                    {formatLineToWidth(
                                        `${isSelected ? '›' : ' '} ${option.label}`,
                                        overlayWidth
                                    )}
                                </Text>
                            </Box>
                        );
                    })}
                </Box>
                <Box paddingX={0} paddingY={0} marginTop={1} width={overlayWidth}>
                    <Text color="gray">
                        {formatLineToWidth(
                            selectedReasoningOption?.description ?? '',
                            overlayWidth
                        )}
                    </Text>
                </Box>
                <Box paddingX={0} paddingY={0} width={overlayWidth}>
                    <HintBar hints={['↑↓ navigate', 'Enter select', 'Esc back']} />
                </Box>
            </Box>
        );
    }

    const selectedIndex = selection.index;
    const scrollOffset = selection.offset;
    const listItems = filteredItems.filter((item): item is ModelOption => !isAddCustomOption(item));
    const visibleItems = listItems.slice(scrollOffset, scrollOffset + listViewportItems);
    const selectedItem = filteredItems[selectedIndex];
    const hasActionableItems = Boolean(selectedItem && isModelOption(selectedItem));

    const searchLine = formatLineToWidth(
        `Search: ${searchQuery || 'Type to filter models…'}`,
        overlayWidth
    );
    const addCustomLine = hasAddCustomOption
        ? formatLineToWidth(
              `${getRowPrefix({
                  isSelected: selectedIndex === 0,
                  isDefault: false,
                  isCurrent: false,
                  isCustom: false,
                  isFavorite: false,
              })} Add custom model…`,
              overlayWidth
          )
        : '';

    return (
        <Box flexDirection="column" width={overlayWidth}>
            {/* Header */}
            <Box paddingX={0} paddingY={0} width={overlayWidth}>
                <Text color="cyan" bold>
                    Models
                </Text>
            </Box>
            <Box paddingX={0} paddingY={0} width={overlayWidth} flexDirection="row">
                {MODEL_SELECTOR_TABS.map((tab) => (
                    <Box
                        key={tab.id}
                        marginRight={1}
                        borderStyle="round"
                        borderColor={activeTab === tab.id ? 'cyan' : 'gray'}
                        paddingX={1}
                    >
                        <Text
                            color={activeTab === tab.id ? 'cyan' : 'gray'}
                            bold={activeTab === tab.id}
                        >
                            {tab.label}
                        </Text>
                    </Box>
                ))}
            </Box>

            {/* Search input */}
            <Box paddingX={0} paddingY={0} width={overlayWidth}>
                <Text color={searchQuery ? 'white' : 'gray'}>{searchLine}</Text>
            </Box>

            {/* Items */}
            <Box flexDirection="column" marginTop={1} width={overlayWidth}>
                {hasAddCustomOption && (
                    <Box paddingX={0} paddingY={0} width={overlayWidth}>
                        <Text
                            color={selectedIndex === 0 ? 'green' : 'gray'}
                            bold={selectedIndex === 0}
                        >
                            {addCustomLine}
                        </Text>
                    </Box>
                )}
                <Box flexDirection="column" height={listViewportItems} width={overlayWidth}>
                    {isLoading || listItems.length === 0
                        ? Array.from({ length: listViewportItems }, (_, index) => (
                              <Box
                                  key={`model-empty-${index}`}
                                  paddingX={0}
                                  paddingY={0}
                                  width={overlayWidth}
                              >
                                  <Text>{blankLine}</Text>
                              </Box>
                          ))
                        : Array.from({ length: listViewportItems }, (_, rowIndex) => {
                              const item = visibleItems[rowIndex];
                              if (!item) {
                                  return (
                                      <Box
                                          key={`model-empty-${rowIndex}`}
                                          paddingX={0}
                                          paddingY={0}
                                          width={overlayWidth}
                                      >
                                          <Text>{blankLine}</Text>
                                      </Box>
                                  );
                              }

                              const actualIndex = modelStartIndex + scrollOffset + rowIndex;
                              const isSelected = actualIndex === selectedIndex;

                              const providerDisplay = getLLMProviderDisplayName(item.provider);
                              const name =
                                  item.displayName && item.displayName !== item.name
                                      ? `${item.displayName} [${item.name}]`
                                      : item.displayName || item.name;
                              const isFavorite = favoriteKeySet.has(
                                  toModelPickerKey({
                                      provider: item.provider,
                                      model: item.name,
                                  })
                              );
                              const prefix = getRowPrefix({
                                  isSelected,
                                  isDefault: item.isDefault,
                                  isCurrent: item.isCurrent,
                                  isCustom: item.isCustom,
                                  isFavorite,
                              });

                              return (
                                  <Box
                                      key={`model-${activeTab}-${actualIndex}-${toModelIdentityKey(item)}`}
                                      flexDirection="row"
                                      paddingX={0}
                                      paddingY={0}
                                      width={overlayWidth}
                                  >
                                      <Text color={isSelected ? 'cyan' : 'gray'} bold={isSelected}>
                                          {formatLineToWidth(
                                              `${prefix} ${name} (${providerDisplay})`,
                                              overlayWidth
                                          )}
                                      </Text>
                                  </Box>
                              );
                          })}
                </Box>
            </Box>

            <Box paddingX={0} paddingY={0} width={overlayWidth}>
                <HintBar
                    hints={[
                        '↑↓ navigate',
                        'Enter select/apply',
                        'Esc close',
                        'Tab/Shift+Tab switch tab',
                        hasActionableItems ? '←→ action' : '',
                        hasActionableItems ? 'Ctrl+F quick favorite' : '',
                    ]}
                />
            </Box>
        </Box>
    );
});

export default ModelSelector;

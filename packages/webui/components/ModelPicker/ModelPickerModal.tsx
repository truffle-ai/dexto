/**
 * Model Picker Modal
 *
 * Allows users to browse and switch between LLM models across providers.
 *
 * TODO: Implement "Run via" toggle for featured models
 * - Show a single model card with toggle buttons: "Dexto / Direct / OpenRouter"
 * - Toggle changes both provider AND model ID (e.g., dexto-nova uses OpenRouter IDs,
 *   direct uses native IDs like claude-sonnet-4-5 vs anthropic/claude-sonnet-4.5)
 * - Disable toggles when credentials are missing (e.g., no ANTHROPIC_API_KEY)
 * - Requires a curated mapping table for featured models (provider/model pairs per backend)
 * - See feature-plans/holistic-dexto-auth-analysis/13-model-id-namespaces-and-mapping.md
 * - See feature-plans/holistic-dexto-auth-analysis/14-webui-effective-credentials-and-routing-awareness.md
 */
import { useEffect, useMemo, useState, useCallback, useRef } from 'react';
import {
    useLLMCatalog,
    useSwitchLLM,
    useCustomModels,
    useCreateCustomModel,
    useDeleteCustomModel,
    useModelPickerState,
    useToggleFavoriteModel,
    useSetFavoriteModels,
    useProviderApiKey,
    useSaveApiKey,
    type SwitchLLMPayload,
    type CustomModel,
} from '../hooks/useLLM';
import { useLocalModels, useDeleteInstalledModel, type LocalModel } from '../hooks/useModels';
import { useDextoAuth } from '../hooks/useDextoAuth';
import {
    CustomModelForm,
    type CustomModelFormData,
    type CustomModelProvider,
} from './CustomModelForms';
import { Popover, PopoverContent, PopoverTrigger } from '../ui/popover';
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip';
import { Button } from '../ui/button';
import { Alert, AlertDescription } from '../ui/alert';
import { ApiKeyModal } from '../ApiKeyModal';
import { useSessionStore } from '@/lib/stores/sessionStore';
import { useCurrentLLM } from '../hooks/useCurrentLLM';
import { Bot, ChevronDown, Loader2, Plus, Filter } from 'lucide-react';
import { SearchBar } from './SearchBar';
import { ModelCard } from './ModelCard';
import {
    CUSTOM_MODELS_STORAGE_KEY,
    FAVORITES_STORAGE_KEY,
    ProviderCatalog,
    ModelInfo,
    favKey,
    validateBaseURL,
} from './types';
import { cn } from '../../lib/utils';
import type { LLMProvider } from '@dexto/core';
import { LLM_PROVIDERS } from '@dexto/core';
import { PROVIDER_LOGOS, needsDarkModeInversion, hasLogo } from './constants';
import { useAnalytics } from '@/lib/analytics/index.js';

export default function ModelPickerModal() {
    const [open, setOpen] = useState(false);
    const [providers, setProviders] = useState<Partial<Record<LLMProvider, ProviderCatalog>>>({});
    const [search, setSearch] = useState('');
    const [baseURL, setBaseURL] = useState('');
    const [error, setError] = useState<string | null>(null);
    const [activeTab, setActiveTab] = useState<'for-you' | 'all-models'>('for-you');
    // Provider filter - empty array means 'all', can include 'custom' or any LLMProvider
    const [providerFilter, setProviderFilter] = useState<Array<LLMProvider | 'custom'>>([]);
    const [showCustomForm, setShowCustomForm] = useState(false);

    // Custom models form state (data comes from API via useCustomModels)
    const [customModelForm, setCustomModelForm] = useState<CustomModelFormData>({
        provider: 'openai-compatible',
        name: '',
        baseURL: '',
        displayName: '',
        maxInputTokens: '',
        maxOutputTokens: '',
        apiKey: '',
        filePath: '',
    });
    // Track original name when editing (to handle renames)
    const [editingModelName, setEditingModelName] = useState<string | null>(null);

    // API key modal
    const [keyModalOpen, setKeyModalOpen] = useState(false);
    const [pendingKeyProvider, setPendingKeyProvider] = useState<LLMProvider | null>(null);
    const [pendingSelection, setPendingSelection] = useState<{
        provider: LLMProvider;
        model: ModelInfo;
    } | null>(null);

    const currentSessionId = useSessionStore((s) => s.currentSessionId);
    const { data: currentLLM, refetch: refreshCurrentLLM } = useCurrentLLM(currentSessionId);

    // Analytics tracking
    const analytics = useAnalytics();
    const analyticsRef = useRef(analytics);

    useEffect(() => {
        analyticsRef.current = analytics;
    }, [analytics]);

    // Load catalog when opening
    const {
        data: catalogData,
        isLoading: loading,
        error: catalogError,
    } = useLLMCatalog({
        enabled: open,
        scope: activeTab === 'all-models' ? 'all' : 'curated',
    });

    // Load dexto auth status (for checking if user can use dexto-nova provider)
    const { data: dextoAuthStatus } = useDextoAuth(open);

    // Load custom models from API (always enabled so trigger shows correct icon)
    const { data: customModels = [] } = useCustomModels();
    // Load installed local GGUF models from state.json (downloaded via CLI/Interactive CLI)
    const { data: localModelsData } = useLocalModels({ enabled: open });
    const installedLocalModels = useMemo(
        () => localModelsData?.models ?? [],
        [localModelsData?.models]
    );
    const { mutateAsync: createCustomModelAsync } = useCreateCustomModel();
    const { mutate: deleteCustomModelMutation } = useDeleteCustomModel();
    const { mutate: deleteInstalledModelMutation } = useDeleteInstalledModel();
    const { mutateAsync: saveApiKey } = useSaveApiKey();
    const { mutateAsync: toggleFavoriteModelAsync } = useToggleFavoriteModel();
    const { mutateAsync: setFavoriteModelsAsync } = useSetFavoriteModels();

    const {
        data: modelPickerState,
        isLoading: modelPickerStateLoading,
        error: modelPickerStateError,
    } = useModelPickerState({ enabled: open });

    // Fetch provider API key status for the current form provider (for smart storage logic)
    const { data: providerKeyData } = useProviderApiKey(customModelForm.provider as LLMProvider, {
        enabled: open && showCustomForm,
    });
    useEffect(() => {
        if (catalogData && 'providers' in catalogData) {
            setProviders(catalogData.providers);
        }
    }, [catalogData]);

    // When opening, initialize from current session LLM
    useEffect(() => {
        if (!open) return;
        if (currentLLM) {
            setBaseURL(currentLLM.baseURL || '');
        }
    }, [open, currentLLM]);

    const [favoritesMigrationDone, setFavoritesMigrationDone] = useState(false);

    // Migrate legacy localStorage favorites to shared backend state.
    useEffect(() => {
        if (!open || favoritesMigrationDone || !modelPickerState) return;

        const migrateFavorites = async () => {
            try {
                const favRaw = localStorage.getItem(FAVORITES_STORAGE_KEY);
                if (!favRaw) {
                    setFavoritesMigrationDone(true);
                    return;
                }

                // Backend is already source of truth; drop stale local copy.
                if (modelPickerState.favorites.length > 0) {
                    localStorage.removeItem(FAVORITES_STORAGE_KEY);
                    setFavoritesMigrationDone(true);
                    return;
                }

                const parsed = JSON.parse(favRaw) as unknown;
                const favorites = Array.isArray(parsed)
                    ? parsed
                          .map((value) => {
                              if (typeof value !== 'string') return null;
                              const [providerRaw, ...modelParts] = value.split('|');
                              const model = modelParts.join('|').trim();
                              if (
                                  !providerRaw ||
                                  !model ||
                                  !LLM_PROVIDERS.includes(providerRaw as LLMProvider)
                              ) {
                                  return null;
                              }

                              return {
                                  provider: providerRaw as LLMProvider,
                                  model,
                              };
                          })
                          .filter(
                              (
                                  value
                              ): value is {
                                  provider: LLMProvider;
                                  model: string;
                              } => Boolean(value)
                          )
                    : [];

                if (favorites.length === 0) {
                    localStorage.removeItem(FAVORITES_STORAGE_KEY);
                    setFavoritesMigrationDone(true);
                    return;
                }

                await setFavoriteModelsAsync({ favorites });
                localStorage.removeItem(FAVORITES_STORAGE_KEY);
                setFavoritesMigrationDone(true);
            } catch (migrationError) {
                console.warn('Failed to migrate favorites from localStorage:', migrationError);
                setFavoritesMigrationDone(true);
            }
        };

        void migrateFavorites();
    }, [open, favoritesMigrationDone, modelPickerState, setFavoriteModelsAsync]);

    // Migrate localStorage custom models to API (one-time migration)
    const [migrationDone, setMigrationDone] = useState(false);
    useEffect(() => {
        if (!open || migrationDone) return;

        const migrateModels = async () => {
            try {
                const localStorageRaw = localStorage.getItem(CUSTOM_MODELS_STORAGE_KEY);
                if (!localStorageRaw) {
                    setMigrationDone(true);
                    return;
                }

                const localModels = JSON.parse(localStorageRaw) as Array<{
                    name: string;
                    baseURL: string;
                    maxInputTokens?: number;
                    maxOutputTokens?: number;
                }>;

                if (localModels.length === 0) {
                    localStorage.removeItem(CUSTOM_MODELS_STORAGE_KEY);
                    setMigrationDone(true);
                    return;
                }

                // Check which models don't exist in API yet
                const existingNames = new Set(customModels.map((m) => m.name));
                const toMigrate = localModels.filter((m) => !existingNames.has(m.name));

                if (toMigrate.length === 0) {
                    // All models already migrated, clean up localStorage
                    localStorage.removeItem(CUSTOM_MODELS_STORAGE_KEY);
                    setMigrationDone(true);
                    return;
                }

                // Migrate each model - await all to complete before clearing localStorage
                const migrationPromises = toMigrate.map((model) =>
                    createCustomModelAsync({
                        name: model.name,
                        baseURL: model.baseURL,
                        maxInputTokens: model.maxInputTokens,
                        maxOutputTokens: model.maxOutputTokens,
                    })
                );

                // Wait for all migrations to succeed before clearing localStorage
                await Promise.all(migrationPromises);

                // Only clear localStorage after successful migration
                localStorage.removeItem(CUSTOM_MODELS_STORAGE_KEY);
                console.info(`Migrated ${toMigrate.length} custom models from localStorage to API`);
                setMigrationDone(true);
            } catch (err) {
                // Don't clear localStorage on failure - keep models for retry
                console.warn('Failed to migrate custom models from localStorage:', err);
                setMigrationDone(true);
            }
        };

        migrateModels();
    }, [open, migrationDone, customModels, createCustomModelAsync]);

    const favoriteKeySet = useMemo(
        () =>
            new Set(
                (modelPickerState?.favorites ?? []).map((entry) =>
                    favKey(entry.provider, entry.model)
                )
            ),
        [modelPickerState?.favorites]
    );

    const isFavorite = useCallback(
        (providerId: LLMProvider, modelName: string) =>
            favoriteKeySet.has(favKey(providerId, modelName)),
        [favoriteKeySet]
    );

    const toggleFavorite = useCallback(
        async (providerId: LLMProvider, modelName: string) => {
            try {
                await toggleFavoriteModelAsync({
                    provider: providerId,
                    model: modelName,
                });
                setError(null);
            } catch (toggleError) {
                setError(
                    toggleError instanceof Error
                        ? toggleError.message
                        : 'Failed to update favorites'
                );
            }
        },
        [toggleFavoriteModelAsync]
    );

    const [isAddingModel, setIsAddingModel] = useState(false);
    const switchLLMMutation = useSwitchLLM();

    const addCustomModel = useCallback(async () => {
        const { provider, name, baseURL, maxInputTokens, maxOutputTokens, displayName, apiKey } =
            customModelForm;

        if (!name.trim()) {
            setError('Model name is required');
            return;
        }

        setIsAddingModel(true);

        try {
            // Determine API key storage strategy
            // TODO: Deduplicate - canonical version is determineApiKeyStorage() in @dexto/agent-management
            // Can't import directly as WebUI runs in browser. Move to @dexto/core if this changes often.
            const SHARED_API_KEY_PROVIDERS = ['glama', 'openrouter', 'litellm'];
            const userEnteredKey = apiKey?.trim();
            const providerHasKey = providerKeyData?.hasKey ?? false;
            const hasSharedEnvVarKey = SHARED_API_KEY_PROVIDERS.includes(provider);

            let saveToProviderEnvVar = false;
            let saveAsPerModel = false;

            // Only process if user actually entered a new key
            if (userEnteredKey) {
                if (hasSharedEnvVarKey) {
                    if (!providerHasKey) {
                        // No existing key - save to provider env var
                        saveToProviderEnvVar = true;
                    } else {
                        // Provider already has a key - save as per-model override
                        saveAsPerModel = true;
                    }
                } else {
                    // Non-shared providers always save per-model
                    saveAsPerModel = true;
                }
            }
            // If user didn't enter a key, we don't modify anything - existing key (if any) is used

            if (saveToProviderEnvVar && userEnteredKey) {
                await saveApiKey({ provider: provider as LLMProvider, apiKey: userEnteredKey });
            }

            // If editing and name changed, delete the old model first
            if (editingModelName && editingModelName !== name.trim()) {
                try {
                    await new Promise<void>((resolve, reject) => {
                        deleteCustomModelMutation(editingModelName, {
                            onSuccess: () => resolve(),
                            onError: (err: Error) => reject(err),
                        });
                    });
                } catch (err) {
                    // Log but continue - old model might already be deleted
                    console.warn(`Failed to delete old model "${editingModelName}":`, err);
                }
            }

            // Create/update the custom model
            await createCustomModelAsync({
                provider,
                name: name.trim(),
                ...(provider === 'openai-compatible' &&
                    baseURL.trim() && { baseURL: baseURL.trim() }),
                ...(provider === 'litellm' && baseURL.trim() && { baseURL: baseURL.trim() }),
                ...(displayName?.trim() && { displayName: displayName.trim() }),
                ...(maxInputTokens && { maxInputTokens: parseInt(maxInputTokens, 10) }),
                ...(maxOutputTokens && { maxOutputTokens: parseInt(maxOutputTokens, 10) }),
                ...(saveAsPerModel && userEnteredKey && { apiKey: userEnteredKey }),
            });

            // Only switch to the model for new models, not edits
            // (user is already using edited model or chose not to switch)
            if (!editingModelName) {
                const baseSwitchPayload: SwitchLLMPayload = {
                    provider: provider as LLMProvider,
                    model: name.trim(),
                    ...(provider === 'openai-compatible' &&
                        baseURL.trim() && { baseURL: baseURL.trim() }),
                    ...(provider === 'litellm' && baseURL.trim() && { baseURL: baseURL.trim() }),
                    ...(saveAsPerModel && userEnteredKey && { apiKey: userEnteredKey }),
                };

                // Always update global default first (no sessionId)
                await switchLLMMutation.mutateAsync(baseSwitchPayload);

                // Then switch current session if active
                if (currentSessionId) {
                    try {
                        await switchLLMMutation.mutateAsync({
                            ...baseSwitchPayload,
                            sessionId: currentSessionId,
                        });
                    } catch (sessionErr) {
                        setError(
                            sessionErr instanceof Error
                                ? `Model added and set as global default, but failed to switch current session: ${sessionErr.message}`
                                : 'Model added and set as global default, but failed to switch current session'
                        );
                        await refreshCurrentLLM();
                        setIsAddingModel(false);
                        return;
                    }
                }

                await refreshCurrentLLM();

                // Track the switch
                if (currentLLM) {
                    analyticsRef.current.trackLLMSwitched({
                        fromProvider: currentLLM.provider,
                        fromModel: currentLLM.model,
                        toProvider: provider,
                        toModel: name.trim(),
                        sessionId: currentSessionId || undefined,
                        trigger: 'user_action',
                    });
                }
            }

            // Reset form and close
            setCustomModelForm({
                provider: 'openai-compatible',
                name: '',
                baseURL: '',
                displayName: '',
                maxInputTokens: '',
                maxOutputTokens: '',
                apiKey: '',
                filePath: '',
            });
            setEditingModelName(null);
            setShowCustomForm(false);
            setError(null);
            setOpen(false);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to add model');
        } finally {
            setIsAddingModel(false);
        }
    }, [
        customModelForm,
        createCustomModelAsync,
        switchLLMMutation,
        currentSessionId,
        currentLLM,
        refreshCurrentLLM,
        providerKeyData,
        saveApiKey,
        editingModelName,
        deleteCustomModelMutation,
    ]);

    const deleteCustomModel = useCallback(
        (name: string) => {
            deleteCustomModelMutation(name, {
                onError: (err: Error) => {
                    setError(err.message);
                },
            });
        },
        [deleteCustomModelMutation]
    );

    const deleteInstalledModel = useCallback(
        (modelId: string) => {
            // Delete installed model and its GGUF file from disk
            deleteInstalledModelMutation(
                { modelId, deleteFile: true },
                {
                    onError: (err: Error) => {
                        setError(err.message);
                    },
                }
            );
        },
        [deleteInstalledModelMutation]
    );

    const editCustomModel = useCallback((model: CustomModel) => {
        // Map provider to form-supported provider (vertex uses openai-compatible form)
        const formSupportedProviders: CustomModelProvider[] = [
            'openai-compatible',
            'openrouter',
            'litellm',
            'glama',
            'bedrock',
            'ollama',
            'local',
        ];
        const provider = model.provider ?? 'openai-compatible';
        const formProvider: CustomModelProvider = formSupportedProviders.includes(
            provider as CustomModelProvider
        )
            ? (provider as CustomModelProvider)
            : 'openai-compatible';

        setCustomModelForm({
            provider: formProvider,
            name: model.name,
            baseURL: model.baseURL ?? '',
            displayName: model.displayName ?? '',
            maxInputTokens: model.maxInputTokens?.toString() ?? '',
            maxOutputTokens: model.maxOutputTokens?.toString() ?? '',
            apiKey: model.apiKey ?? '',
            filePath: model.filePath ?? '',
        });
        setEditingModelName(model.name);
        setShowCustomForm(true);
        setError(null);
    }, []);

    const modelMatchesSearch = useCallback(
        (providerId: LLMProvider, model: ModelInfo): boolean => {
            const q = search.trim().toLowerCase();
            if (!q) return true;
            return (
                model.name.toLowerCase().includes(q) ||
                (model.displayName?.toLowerCase().includes(q) ?? false) ||
                providerId.toLowerCase().includes(q) ||
                (providers[providerId]?.name.toLowerCase().includes(q) ?? false)
            );
        },
        [search, providers]
    );

    function onPickModel(
        providerId: LLMProvider,
        model: ModelInfo,
        customBaseURL?: string,
        skipApiKeyCheck = false,
        customApiKey?: string
    ) {
        const provider = providers[providerId];
        const effectiveBaseURL = customBaseURL || baseURL;
        const supportsBaseURL = provider?.supportsBaseURL ?? Boolean(effectiveBaseURL);

        if (supportsBaseURL && effectiveBaseURL) {
            const v = validateBaseURL(effectiveBaseURL);
            if (!v.isValid) {
                setError(v.error || 'Invalid base URL');
                return;
            }
        }

        // Dexto Nova provider requires OAuth login via CLI, not manual API key entry
        // Check canUse from auth status API (requires both authentication AND API key)
        if (!skipApiKeyCheck && providerId === 'dexto-nova') {
            if (!dextoAuthStatus?.canUse) {
                setError('Run `dexto login` or `/login` from the CLI to authenticate with Dexto');
                return;
            }
        } else if (!skipApiKeyCheck && provider && !provider.hasApiKey && !customApiKey) {
            // Other providers - show API key modal if no key configured
            setPendingSelection({ provider: providerId, model });
            setPendingKeyProvider(providerId);
            setKeyModalOpen(true);
            return;
        }

        const basePayload: SwitchLLMPayload = {
            provider: providerId,
            model: model.name,
            ...(supportsBaseURL && effectiveBaseURL && { baseURL: effectiveBaseURL }),
            ...(customApiKey && { apiKey: customApiKey }),
        };

        // Always update global default first (no sessionId), then switch current session if active
        switchLLMMutation.mutate(basePayload, {
            onSuccess: async () => {
                // If there's an active session, also switch it to the new model
                if (currentSessionId) {
                    try {
                        await switchLLMMutation.mutateAsync({
                            ...basePayload,
                            sessionId: currentSessionId,
                        });
                    } catch (err) {
                        setError(
                            err instanceof Error
                                ? err.message
                                : 'Failed to switch model for current session'
                        );
                        return;
                    }
                }

                await refreshCurrentLLM();

                if (currentLLM) {
                    analyticsRef.current.trackLLMSwitched({
                        fromProvider: currentLLM.provider,
                        fromModel: currentLLM.model,
                        toProvider: providerId,
                        toModel: model.name,
                        sessionId: currentSessionId || undefined,
                        trigger: 'user_action',
                    });
                }

                setOpen(false);
                setError(null);
            },
            onError: (error: Error) => {
                setError(error.message);
            },
        });
    }

    function onPickCustomModel(customModel: CustomModel) {
        const provider = (customModel.provider ?? 'openai-compatible') as LLMProvider;
        const modelInfo: ModelInfo = {
            name: customModel.name,
            displayName: customModel.displayName || customModel.name,
            maxInputTokens: customModel.maxInputTokens || 128000,
            supportedFileTypes: ['pdf', 'image', 'audio'],
        };
        // Skip API key check for custom models - user already configured them.
        // If they didn't add an API key, it's intentional (self-hosted, local, or env var).
        // Pass the custom model's apiKey for per-model override if present.
        onPickModel(provider, modelInfo, customModel.baseURL, true, customModel.apiKey);
    }

    function onPickInstalledModel(model: LocalModel) {
        // Installed local models use the model ID as the name
        // Context length is auto-detected by node-llama-cpp at runtime
        const modelInfo: ModelInfo = {
            name: model.id,
            displayName: model.displayName,
            maxInputTokens: model.contextLength || 8192,
            supportedFileTypes: [], // Local models typically don't support file attachments
        };
        // Skip API key check - local models don't need API keys
        onPickModel('local', modelInfo, undefined, true);
    }

    function onApiKeySaved(meta: { provider: string; envVar: string }) {
        const providerKey = meta.provider as LLMProvider;
        setProviders((prev) => ({
            ...prev,
            [providerKey]: prev[providerKey]
                ? { ...prev[providerKey]!, hasApiKey: true }
                : prev[providerKey],
        }));
        setKeyModalOpen(false);
        if (pendingSelection) {
            const { provider: providerId, model } = pendingSelection;
            // Skip API key check since we just saved it
            onPickModel(providerId, model, undefined, true);
            setPendingSelection(null);
        }
    }

    const triggerLabel = currentLLM?.displayName || currentLLM?.model || 'Choose Model';
    const isWelcomeScreen = !currentSessionId;

    // Toggle a filter (add if not present, remove if present)
    const toggleFilter = useCallback((filter: LLMProvider | 'custom') => {
        setProviderFilter((prev) =>
            prev.includes(filter) ? prev.filter((f) => f !== filter) : [...prev, filter]
        );
    }, []);

    type ModelPickerSectionEntry = {
        provider: LLMProvider;
        model: string;
        displayName?: string;
        supportedFileTypes: ModelInfo['supportedFileTypes'];
        source: 'catalog' | 'custom' | 'local-installed';
    };

    const customModelsByKey = useMemo(() => {
        const byKey = new Map<string, CustomModel>();
        for (const customModel of customModels) {
            const provider = (customModel.provider ?? 'openai-compatible') as LLMProvider;
            byKey.set(favKey(provider, customModel.name), customModel);
        }
        return byKey;
    }, [customModels]);

    const installedLocalModelsById = useMemo(() => {
        const byId = new Map<string, LocalModel>();
        for (const model of installedLocalModels) {
            byId.set(model.id, model);
        }
        return byId;
    }, [installedLocalModels]);

    const providerModelsByKey = useMemo(() => {
        const byKey = new Map<string, ModelInfo>();
        for (const providerId of LLM_PROVIDERS) {
            const provider = providers[providerId];
            if (!provider) continue;
            for (const model of provider.models) {
                byKey.set(favKey(providerId, model.name), model);
            }
        }
        return byKey;
    }, [providers]);

    const resolveModelInfoFromEntry = useCallback(
        (entry: ModelPickerSectionEntry): ModelInfo => {
            const key = favKey(entry.provider, entry.model);
            const providerModel = providerModelsByKey.get(key);
            if (providerModel) {
                return providerModel;
            }

            const customModel = customModelsByKey.get(key);
            if (customModel) {
                return {
                    name: customModel.name,
                    displayName: customModel.displayName || customModel.name,
                    maxInputTokens: customModel.maxInputTokens || 128000,
                    supportedFileTypes: ['pdf', 'image', 'audio'],
                };
            }

            const installedModel =
                entry.provider === 'local' ? installedLocalModelsById.get(entry.model) : undefined;

            return {
                name: entry.model,
                displayName: entry.displayName || entry.model,
                maxInputTokens: installedModel?.contextLength || 8192,
                supportedFileTypes: entry.supportedFileTypes ?? [],
            };
        },
        [customModelsByKey, installedLocalModelsById, providerModelsByKey]
    );

    const onPickSectionEntry = useCallback(
        (entry: ModelPickerSectionEntry) => {
            const key = favKey(entry.provider, entry.model);
            const customModel = customModelsByKey.get(key);
            if (customModel) {
                onPickCustomModel(customModel);
                return;
            }

            if (entry.provider === 'local') {
                const localModel = installedLocalModelsById.get(entry.model);
                if (localModel) {
                    onPickInstalledModel(localModel);
                    return;
                }
            }

            onPickModel(entry.provider, resolveModelInfoFromEntry(entry));
        },
        [
            customModelsByKey,
            installedLocalModelsById,
            resolveModelInfoFromEntry,
            onPickCustomModel,
            onPickInstalledModel,
        ]
    );

    const modelPickerEntryMatchesSearch = useCallback(
        (entry: ModelPickerSectionEntry): boolean => {
            const q = search.trim().toLowerCase();
            if (!q) return true;

            const providerName = providers[entry.provider]?.name.toLowerCase() ?? '';
            return (
                entry.model.toLowerCase().includes(q) ||
                (entry.displayName?.toLowerCase().includes(q) ?? false) ||
                entry.provider.toLowerCase().includes(q) ||
                providerName.includes(q)
            );
        },
        [providers, search]
    );

    const forYouSections = useMemo(() => {
        if (!modelPickerState) {
            return [];
        }

        const sections = [
            {
                id: 'featured',
                title: 'Featured',
                entries: modelPickerState.featured as ModelPickerSectionEntry[],
            },
            {
                id: 'recents',
                title: 'Recents',
                entries: modelPickerState.recents as ModelPickerSectionEntry[],
            },
            {
                id: 'favorites',
                title: 'Favorites',
                entries: modelPickerState.favorites as ModelPickerSectionEntry[],
            },
            {
                id: 'custom',
                title: 'Custom',
                entries: modelPickerState.custom as ModelPickerSectionEntry[],
            },
        ];

        return sections
            .map((section) => ({
                ...section,
                entries: section.entries.filter(modelPickerEntryMatchesSearch),
            }))
            .filter((section) => section.entries.length > 0);
    }, [modelPickerEntryMatchesSearch, modelPickerState]);

    // All models flat list (filtered by search and provider)
    const allModels = useMemo(() => {
        // Get non-custom provider filters
        const providerFilters = providerFilter.filter((f): f is LLMProvider => f !== 'custom');
        // If only 'custom' is selected, don't show catalog models
        if (providerFilter.length > 0 && providerFilters.length === 0) return [];

        const result: Array<{
            providerId: LLMProvider;
            provider: ProviderCatalog;
            model: ModelInfo;
        }> = [];

        for (const providerId of LLM_PROVIDERS) {
            // Empty filter = show all, otherwise check if provider is in filter
            if (providerFilter.length > 0 && !providerFilters.includes(providerId)) continue;

            const provider = providers[providerId];
            if (!provider) continue;

            for (const model of provider.models) {
                if (modelMatchesSearch(providerId, model)) {
                    result.push({ providerId, provider, model });
                }
            }
        }

        return result;
    }, [providers, providerFilter, modelMatchesSearch]);

    // Filtered custom models (shown when no filter, 'custom' filter, or provider-specific filter)
    const filteredCustomModels = useMemo(() => {
        const hasCustomFilter = providerFilter.includes('custom');
        const hasOpenRouterFilter = providerFilter.includes('openrouter');
        const noFilter = providerFilter.length === 0;

        // If filter is set but neither 'custom' nor 'openrouter', hide custom models
        if (!noFilter && !hasCustomFilter && !hasOpenRouterFilter) return [];

        let filtered = customModels;

        // If openrouter filter is active (without custom), only show openrouter custom models
        if (hasOpenRouterFilter && !hasCustomFilter && !noFilter) {
            filtered = customModels.filter((cm) => cm.provider === 'openrouter');
        }

        const q = search.trim().toLowerCase();
        if (!q) return filtered;
        return filtered.filter(
            (cm) =>
                cm.name.toLowerCase().includes(q) ||
                (cm.displayName?.toLowerCase().includes(q) ?? false) ||
                (cm.provider?.toLowerCase().includes(q) ?? false) ||
                (cm.baseURL?.toLowerCase().includes(q) ?? false)
        );
    }, [providerFilter, search, customModels]);

    // Filtered installed local models (downloaded via CLI/Interactive CLI)
    // Shown when no filter or 'local' filter is active
    const filteredInstalledModels = useMemo(() => {
        const hasLocalFilter = providerFilter.includes('local');
        const noFilter = providerFilter.length === 0;

        // If filter is set but not 'local', hide installed models
        if (!noFilter && !hasLocalFilter) return [];

        const q = search.trim().toLowerCase();
        if (!q) return installedLocalModels;
        return installedLocalModels.filter(
            (model) =>
                model.id.toLowerCase().includes(q) ||
                model.displayName.toLowerCase().includes(q) ||
                'local'.includes(q)
        );
    }, [providerFilter, search, installedLocalModels]);

    // Available providers for filter
    // OpenRouter always shown (users add their own models via custom models)
    // Local shown when there are installed models from CLI
    const availableProviders = useMemo(() => {
        const base = LLM_PROVIDERS.filter((p) => p === 'openrouter' || providers[p]?.models.length);
        // Add 'local' if there are installed local models
        if (installedLocalModels.length > 0 && !base.includes('local')) {
            return [...base, 'local' as LLMProvider];
        }
        return base;
    }, [providers, installedLocalModels]);

    const isCurrentModel = (providerId: string, modelName: string) =>
        currentLLM?.provider === providerId && currentLLM?.model === modelName;

    return (
        <>
            <Popover open={open} onOpenChange={setOpen}>
                <PopoverTrigger asChild>
                    <Button
                        variant="ghost"
                        size="sm"
                        className="flex items-center gap-2 cursor-pointer"
                        title="Choose model"
                    >
                        {currentLLM?.provider && hasLogo(currentLLM.provider as LLMProvider) ? (
                            <img
                                src={PROVIDER_LOGOS[currentLLM.provider as LLMProvider]}
                                alt={`${currentLLM.provider} logo`}
                                width={16}
                                height={16}
                                className={cn(
                                    'object-contain',
                                    needsDarkModeInversion(currentLLM.provider as LLMProvider) &&
                                        'dark:invert dark:brightness-0 dark:contrast-200'
                                )}
                            />
                        ) : (
                            <Bot className="h-4 w-4" />
                        )}
                        <span className="text-sm">{triggerLabel}</span>
                        {currentLLM?.viaDexto && (
                            <span className="text-xs text-muted-foreground">via Dexto Nova</span>
                        )}
                        <ChevronDown
                            className={cn('h-3 w-3 transition-transform', open && 'rotate-180')}
                        />
                    </Button>
                </PopoverTrigger>

                <PopoverContent
                    side="top"
                    align="end"
                    sideOffset={8}
                    avoidCollisions={true}
                    collisionPadding={16}
                    className={cn(
                        'w-[calc(100vw-32px)] max-w-[700px]',
                        isWelcomeScreen ? 'max-h-[min(400px,50vh)]' : 'max-h-[min(580px,75vh)]',
                        'flex flex-col p-0 overflow-hidden',
                        'rounded-xl border border-border/60 bg-popover/98 backdrop-blur-xl shadow-xl'
                    )}
                >
                    {/* Full-screen Add Custom Model Form - replaces all content when active */}
                    {showCustomForm ? (
                        <CustomModelForm
                            formData={customModelForm}
                            onChange={(updates) =>
                                setCustomModelForm((prev) => ({ ...prev, ...updates }))
                            }
                            onSubmit={addCustomModel}
                            onCancel={() => {
                                setShowCustomForm(false);
                                setEditingModelName(null);
                                setError(null);
                            }}
                            isSubmitting={isAddingModel}
                            error={error}
                            isEditing={editingModelName !== null}
                        />
                    ) : (
                        <>
                            {/* Header */}
                            <div className="flex-shrink-0 px-3 pt-3 pb-2 border-b border-border/30 space-y-2">
                                {(error || catalogError || modelPickerStateError) && (
                                    <Alert variant="destructive" className="py-2">
                                        <AlertDescription className="text-xs">
                                            {error ||
                                                catalogError?.message ||
                                                modelPickerStateError?.message}
                                        </AlertDescription>
                                    </Alert>
                                )}
                                <div className="flex items-center gap-2">
                                    <div className="inline-flex rounded-lg border border-border/60 bg-muted/30 p-1">
                                        <button
                                            onClick={() => setActiveTab('for-you')}
                                            className={cn(
                                                'px-3 py-1 text-xs font-medium rounded-md transition-colors',
                                                activeTab === 'for-you'
                                                    ? 'bg-background text-foreground shadow-sm'
                                                    : 'text-muted-foreground hover:text-foreground'
                                            )}
                                        >
                                            For You
                                        </button>
                                        <button
                                            onClick={() => setActiveTab('all-models')}
                                            className={cn(
                                                'px-3 py-1 text-xs font-medium rounded-md transition-colors',
                                                activeTab === 'all-models'
                                                    ? 'bg-background text-foreground shadow-sm'
                                                    : 'text-muted-foreground hover:text-foreground'
                                            )}
                                        >
                                            All Models
                                        </button>
                                    </div>
                                    <div className="flex-1">
                                        <SearchBar
                                            value={search}
                                            onChange={setSearch}
                                            placeholder={
                                                activeTab === 'all-models'
                                                    ? 'Search all models...'
                                                    : 'Search your models...'
                                            }
                                        />
                                    </div>
                                    <Tooltip>
                                        <TooltipTrigger asChild>
                                            <button
                                                onClick={() => setShowCustomForm(true)}
                                                className="p-2 rounded-lg transition-colors flex-shrink-0 bg-muted/50 text-muted-foreground hover:text-foreground hover:bg-muted"
                                            >
                                                <Plus className="h-4 w-4" />
                                                <span className="sr-only">Add custom model</span>
                                            </button>
                                        </TooltipTrigger>
                                        <TooltipContent side="bottom">
                                            Add custom model
                                        </TooltipContent>
                                    </Tooltip>
                                </div>

                                {activeTab === 'all-models' && availableProviders.length > 1 && (
                                    <div className="flex items-center gap-1.5 flex-wrap pt-1">
                                        <Filter className="h-3 w-3 text-muted-foreground flex-shrink-0" />
                                        <button
                                            onClick={() => setProviderFilter([])}
                                            className={cn(
                                                'px-2 py-1 text-[11px] font-medium rounded-md transition-colors',
                                                providerFilter.length === 0
                                                    ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                                                    : 'bg-muted/50 text-muted-foreground hover:bg-muted hover:text-foreground'
                                            )}
                                        >
                                            All
                                        </button>
                                        {availableProviders.map((providerId) => (
                                            <button
                                                key={providerId}
                                                onClick={() => toggleFilter(providerId)}
                                                className={cn(
                                                    'flex items-center gap-1 px-2 py-1 text-[11px] font-medium rounded-md transition-colors',
                                                    providerFilter.includes(providerId)
                                                        ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                                                        : 'bg-muted/50 text-muted-foreground hover:bg-muted hover:text-foreground'
                                                )}
                                            >
                                                {PROVIDER_LOGOS[providerId] && (
                                                    <img
                                                        src={PROVIDER_LOGOS[providerId]}
                                                        alt=""
                                                        width={10}
                                                        height={10}
                                                        className={cn(
                                                            'object-contain',
                                                            needsDarkModeInversion(providerId) &&
                                                                !providerFilter.includes(
                                                                    providerId
                                                                ) &&
                                                                'dark:invert dark:brightness-0 dark:contrast-200'
                                                        )}
                                                    />
                                                )}
                                                <span className="hidden sm:inline">
                                                    {providers[providerId]?.name || providerId}
                                                </span>
                                            </button>
                                        ))}
                                        <button
                                            onClick={() => toggleFilter('custom')}
                                            className={cn(
                                                'flex items-center gap-1 px-2 py-1 text-[11px] font-medium rounded-md transition-colors',
                                                providerFilter.includes('custom')
                                                    ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                                                    : 'bg-muted/50 text-muted-foreground hover:bg-muted hover:text-foreground'
                                            )}
                                        >
                                            <Bot className="h-2.5 w-2.5" />
                                            <span className="hidden sm:inline">Custom</span>
                                        </button>
                                    </div>
                                )}
                            </div>

                            {/* Main Content */}
                            <div className="flex-1 min-h-0 overflow-y-auto p-3">
                                {loading || (activeTab === 'for-you' && modelPickerStateLoading) ? (
                                    <div className="flex items-center justify-center py-8">
                                        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                                    </div>
                                ) : activeTab === 'for-you' ? (
                                    forYouSections.length === 0 ? (
                                        <div className="flex flex-col items-center justify-center py-8 text-center">
                                            <p className="text-sm font-medium text-muted-foreground">
                                                No models found
                                            </p>
                                            <p className="text-xs text-muted-foreground/70 mt-1">
                                                Try adjusting your search or add a custom model
                                            </p>
                                        </div>
                                    ) : (
                                        <div className="space-y-4">
                                            {forYouSections.map((section) => (
                                                <section key={section.id} className="space-y-2">
                                                    <div className="text-[11px] uppercase tracking-wide font-medium text-muted-foreground px-1">
                                                        {section.title}
                                                    </div>
                                                    <div
                                                        className="grid gap-2 justify-center"
                                                        style={{
                                                            gridTemplateColumns:
                                                                'repeat(auto-fill, 140px)',
                                                        }}
                                                    >
                                                        {section.entries.map((entry) => {
                                                            const modelInfo =
                                                                resolveModelInfoFromEntry(entry);
                                                            const providerInfo =
                                                                providers[entry.provider];
                                                            const key = favKey(
                                                                entry.provider,
                                                                entry.model
                                                            );
                                                            const customModel =
                                                                customModelsByKey.get(key);
                                                            const localModel =
                                                                entry.provider === 'local'
                                                                    ? installedLocalModelsById.get(
                                                                          entry.model
                                                                      )
                                                                    : undefined;

                                                            return (
                                                                <ModelCard
                                                                    key={`${section.id}|${key}`}
                                                                    provider={entry.provider}
                                                                    providerInfo={providerInfo}
                                                                    model={modelInfo}
                                                                    isFavorite={isFavorite(
                                                                        entry.provider,
                                                                        entry.model
                                                                    )}
                                                                    isActive={isCurrentModel(
                                                                        entry.provider,
                                                                        entry.model
                                                                    )}
                                                                    onClick={() =>
                                                                        onPickSectionEntry(entry)
                                                                    }
                                                                    onToggleFavorite={() => {
                                                                        void toggleFavorite(
                                                                            entry.provider,
                                                                            entry.model
                                                                        );
                                                                    }}
                                                                    onEdit={
                                                                        customModel
                                                                            ? () =>
                                                                                  editCustomModel(
                                                                                      customModel
                                                                                  )
                                                                            : undefined
                                                                    }
                                                                    onDelete={
                                                                        customModel
                                                                            ? () =>
                                                                                  deleteCustomModel(
                                                                                      customModel.name
                                                                                  )
                                                                            : localModel
                                                                              ? () =>
                                                                                    deleteInstalledModel(
                                                                                        localModel.id
                                                                                    )
                                                                              : undefined
                                                                    }
                                                                    size="sm"
                                                                    isCustom={Boolean(customModel)}
                                                                    isInstalled={Boolean(
                                                                        localModel
                                                                    )}
                                                                />
                                                            );
                                                        })}
                                                    </div>
                                                </section>
                                            ))}
                                        </div>
                                    )
                                ) : (
                                    <div>
                                        {allModels.length === 0 &&
                                        filteredCustomModels.length === 0 &&
                                        filteredInstalledModels.length === 0 ? (
                                            <div className="flex flex-col items-center justify-center py-8 text-center">
                                                <p className="text-sm font-medium text-muted-foreground">
                                                    {providerFilter.includes('openrouter')
                                                        ? 'No OpenRouter models yet'
                                                        : providerFilter.includes('local')
                                                          ? 'No local models installed'
                                                          : 'No models found'}
                                                </p>
                                                <p className="text-xs text-muted-foreground/70 mt-1">
                                                    {providerFilter.includes('openrouter')
                                                        ? 'Click the + button to add an OpenRouter model'
                                                        : providerFilter.includes('local')
                                                          ? 'Use the CLI to download models: dexto setup'
                                                          : 'Try adjusting your search or filters'}
                                                </p>
                                            </div>
                                        ) : (
                                            <div
                                                className="grid gap-2 justify-center"
                                                style={{
                                                    gridTemplateColumns: 'repeat(auto-fill, 140px)',
                                                }}
                                            >
                                                {allModels.map(
                                                    ({ providerId, provider, model }) => (
                                                        <ModelCard
                                                            key={`${providerId}|${model.name}`}
                                                            provider={providerId}
                                                            model={model}
                                                            providerInfo={provider}
                                                            isFavorite={isFavorite(
                                                                providerId,
                                                                model.name
                                                            )}
                                                            isActive={isCurrentModel(
                                                                providerId,
                                                                model.name
                                                            )}
                                                            onClick={() =>
                                                                onPickModel(providerId, model)
                                                            }
                                                            onToggleFavorite={() => {
                                                                void toggleFavorite(
                                                                    providerId,
                                                                    model.name
                                                                );
                                                            }}
                                                            size="sm"
                                                        />
                                                    )
                                                )}
                                                {/* Installed local models (downloaded via CLI) - shown before custom models */}
                                                {filteredInstalledModels.map((model) => (
                                                    <ModelCard
                                                        key={`local|${model.id}`}
                                                        provider="local"
                                                        model={{
                                                            name: model.id,
                                                            displayName: model.displayName,
                                                            maxInputTokens:
                                                                model.contextLength || 8192,
                                                            supportedFileTypes: [],
                                                        }}
                                                        isFavorite={isFavorite('local', model.id)}
                                                        isActive={isCurrentModel('local', model.id)}
                                                        onClick={() => onPickInstalledModel(model)}
                                                        onToggleFavorite={() => {
                                                            void toggleFavorite('local', model.id);
                                                        }}
                                                        onDelete={() =>
                                                            deleteInstalledModel(model.id)
                                                        }
                                                        size="sm"
                                                        isInstalled
                                                    />
                                                ))}
                                                {/* Custom models (user-configured) */}
                                                {filteredCustomModels.map((cm) => {
                                                    const cmProvider = (cm.provider ??
                                                        'openai-compatible') as LLMProvider;
                                                    return (
                                                        <ModelCard
                                                            key={`custom|${cm.name}`}
                                                            provider={cmProvider}
                                                            providerInfo={providers[cmProvider]}
                                                            model={{
                                                                name: cm.name,
                                                                displayName:
                                                                    cm.displayName || cm.name,
                                                                maxInputTokens:
                                                                    cm.maxInputTokens || 128000,
                                                                supportedFileTypes: [
                                                                    'pdf',
                                                                    'image',
                                                                    'audio',
                                                                ],
                                                            }}
                                                            isFavorite={isFavorite(
                                                                cmProvider,
                                                                cm.name
                                                            )}
                                                            isActive={isCurrentModel(
                                                                cmProvider,
                                                                cm.name
                                                            )}
                                                            onClick={() => onPickCustomModel(cm)}
                                                            onToggleFavorite={() => {
                                                                void toggleFavorite(
                                                                    cmProvider,
                                                                    cm.name
                                                                );
                                                            }}
                                                            onEdit={() => editCustomModel(cm)}
                                                            onDelete={() =>
                                                                deleteCustomModel(cm.name)
                                                            }
                                                            size="sm"
                                                            isCustom
                                                        />
                                                    );
                                                })}
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>
                        </>
                    )}
                </PopoverContent>
            </Popover>

            {pendingKeyProvider && (
                <ApiKeyModal
                    open={keyModalOpen}
                    onOpenChange={setKeyModalOpen}
                    provider={pendingKeyProvider}
                    primaryEnvVar={providers[pendingKeyProvider]?.primaryEnvVar || ''}
                    onSaved={onApiKeySaved}
                />
            )}
        </>
    );
}

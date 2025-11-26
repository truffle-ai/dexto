import React, { useEffect, useMemo, useState, useCallback, useRef } from 'react';
import { useLLMCatalog, useSwitchLLM, type SwitchLLMPayload } from '../hooks/useLLM';
import { Popover, PopoverContent, PopoverTrigger } from '../ui/popover';
import { Button } from '../ui/button';
import { Alert, AlertDescription } from '../ui/alert';
import { ApiKeyModal } from '../ApiKeyModal';
import { useChatContext } from '../hooks/ChatContext';
import {
    Bot,
    ChevronDown,
    ChevronLeft,
    ChevronUp,
    Loader2,
    Star,
    Plus,
    X,
    Filter,
} from 'lucide-react';
import { SearchBar } from './SearchBar';
import { ModelCard } from './ModelCard';
import {
    FAVORITES_STORAGE_KEY,
    CUSTOM_MODELS_STORAGE_KEY,
    DEFAULT_FAVORITES,
    ProviderCatalog,
    ModelInfo,
    CustomModelStorage,
    favKey,
    validateBaseURL,
} from './types';
import type { LLMRouter as SupportedRouter } from '@dexto/core';
import { Input } from '../ui/input';
import { cn } from '../../lib/utils';
import type { LLMProvider } from '@dexto/core';
import { LLM_PROVIDERS } from '@dexto/core';
import { PROVIDER_LOGOS, needsDarkModeInversion } from './constants';
import { useAnalytics } from '@/lib/analytics/index.js';

export default function ModelPickerModal() {
    const [open, setOpen] = useState(false);
    const [providers, setProviders] = useState<Partial<Record<LLMProvider, ProviderCatalog>>>({});
    const [search, setSearch] = useState('');
    const [selectedRouter, setSelectedRouter] = useState<SupportedRouter | ''>('');
    const [baseURL, setBaseURL] = useState('');
    const [error, setError] = useState<string | null>(null);
    const [providerFilter, setProviderFilter] = useState<LLMProvider | 'all'>('all');
    const [activeView, setActiveView] = useState<'favorites' | 'all'>('all');
    const [showCustomForm, setShowCustomForm] = useState(false);

    // Custom models state
    const [customModels, setCustomModels] = useState<CustomModelStorage[]>([]);
    const [customModelForm, setCustomModelForm] = useState({
        name: '',
        baseURL: '',
        maxInputTokens: '',
        maxOutputTokens: '',
    });

    // API key modal
    const [keyModalOpen, setKeyModalOpen] = useState(false);
    const [pendingKeyProvider, setPendingKeyProvider] = useState<LLMProvider | null>(null);
    const [pendingSelection, setPendingSelection] = useState<{
        provider: LLMProvider;
        model: ModelInfo;
    } | null>(null);

    const { currentSessionId, currentLLM, refreshCurrentLLM } = useChatContext();

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
    } = useLLMCatalog({ enabled: open });

    useEffect(() => {
        if (catalogData && 'providers' in catalogData) {
            setProviders(catalogData.providers);
        }
    }, [catalogData]);

    // When opening, initialize from current session LLM
    useEffect(() => {
        if (!open) return;
        if (currentLLM) {
            setSelectedRouter((currentLLM.router as SupportedRouter) || 'vercel');
            setBaseURL(currentLLM.baseURL || '');
        }
    }, [open, currentLLM]);

    const [favorites, setFavorites] = useState<string[]>([]);

    // Load favorites and custom models from localStorage
    useEffect(() => {
        if (open) {
            try {
                const favRaw = localStorage.getItem(FAVORITES_STORAGE_KEY);
                // Use default favorites for new users (when localStorage key doesn't exist)
                const loadedFavorites =
                    favRaw !== null ? (JSON.parse(favRaw) as string[]) : DEFAULT_FAVORITES;
                setFavorites(loadedFavorites);

                const customRaw = localStorage.getItem(CUSTOM_MODELS_STORAGE_KEY);
                const loadedCustom = customRaw
                    ? (JSON.parse(customRaw) as CustomModelStorage[])
                    : [];
                setCustomModels(loadedCustom);
            } catch (err) {
                console.warn('Failed to load favorites/custom models from localStorage:', err);
                setFavorites([]);
                setCustomModels([]);
            }
        }
    }, [open]);

    const toggleFavorite = useCallback((providerId: LLMProvider, modelName: string) => {
        const key = favKey(providerId, modelName);
        setFavorites((prev) => {
            const newFavs = prev.includes(key) ? prev.filter((f) => f !== key) : [...prev, key];
            localStorage.setItem(FAVORITES_STORAGE_KEY, JSON.stringify(newFavs));
            return newFavs;
        });
    }, []);

    const addCustomModel = useCallback(() => {
        const { name, baseURL, maxInputTokens, maxOutputTokens } = customModelForm;

        if (!name.trim() || !baseURL.trim()) {
            setError('Model name and Base URL are required');
            return;
        }

        const urlValidation = validateBaseURL(baseURL);
        if (!urlValidation.isValid) {
            setError(urlValidation.error || 'Invalid Base URL');
            return;
        }

        const newModel: CustomModelStorage = {
            name: name.trim(),
            baseURL: baseURL.trim(),
            maxInputTokens: maxInputTokens ? parseInt(maxInputTokens, 10) || undefined : undefined,
            maxOutputTokens: maxOutputTokens
                ? parseInt(maxOutputTokens, 10) || undefined
                : undefined,
        };

        const updated = [...customModels, newModel];
        setCustomModels(updated);
        localStorage.setItem(CUSTOM_MODELS_STORAGE_KEY, JSON.stringify(updated));

        setCustomModelForm({ name: '', baseURL: '', maxInputTokens: '', maxOutputTokens: '' });
        setShowCustomForm(false);
        setError(null);
    }, [customModelForm, customModels]);

    const deleteCustomModel = useCallback(
        (name: string) => {
            const updated = customModels.filter((m) => m.name !== name);
            setCustomModels(updated);
            localStorage.setItem(CUSTOM_MODELS_STORAGE_KEY, JSON.stringify(updated));
        },
        [customModels]
    );

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

    function pickRouterFor(providerId: LLMProvider, model: ModelInfo): SupportedRouter {
        const currentRouter = (currentLLM?.router as SupportedRouter) || 'vercel';
        const providerRouters = providers[providerId]?.supportedRouters ?? ['vercel'];
        const modelRouters = model.supportedRouters ?? providerRouters;
        const preferred = selectedRouter || currentRouter;
        if (modelRouters.includes(preferred as SupportedRouter))
            return preferred as SupportedRouter;
        return modelRouters[0] || providerRouters[0] || 'vercel';
    }

    const switchLLMMutation = useSwitchLLM();

    function onPickModel(
        providerId: LLMProvider,
        model: ModelInfo,
        customBaseURL?: string,
        skipApiKeyCheck = false
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

        if (!skipApiKeyCheck && provider && !provider.hasApiKey) {
            setPendingSelection({ provider: providerId, model });
            setPendingKeyProvider(providerId);
            setKeyModalOpen(true);
            return;
        }

        const router = pickRouterFor(providerId, model);
        const payload: SwitchLLMPayload = {
            provider: providerId,
            model: model.name,
            router,
            ...(supportsBaseURL && effectiveBaseURL && { baseURL: effectiveBaseURL }),
            ...(currentSessionId && { sessionId: currentSessionId }),
        };

        switchLLMMutation.mutate(payload, {
            onSuccess: async () => {
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

    function onPickCustomModel(customModel: CustomModelStorage) {
        const modelInfo: ModelInfo = {
            name: customModel.name,
            displayName: customModel.name,
            maxInputTokens: customModel.maxInputTokens || 128000,
            supportedFileTypes: ['pdf', 'image', 'audio'],
            supportedRouters: ['vercel', 'in-built'],
        };
        onPickModel('openai-compatible', modelInfo, customModel.baseURL);
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

    // Build favorites list
    const favoriteModels = useMemo(() => {
        return favorites
            .map((key) => {
                const [providerIdRaw, modelName] = key.split('|');
                const providerId = providerIdRaw as LLMProvider;
                if (!LLM_PROVIDERS.includes(providerId)) return null;

                const provider = providers[providerId];
                const model = provider?.models.find((m) => m.name === modelName);
                if (!provider || !model) return null;
                return { providerId, provider, model };
            })
            .filter(Boolean) as Array<{
            providerId: LLMProvider;
            provider: ProviderCatalog;
            model: ModelInfo;
        }>;
    }, [favorites, providers]);

    // All models flat list (filtered by search and provider)
    const allModels = useMemo(() => {
        const result: Array<{
            providerId: LLMProvider;
            provider: ProviderCatalog;
            model: ModelInfo;
        }> = [];

        for (const providerId of LLM_PROVIDERS) {
            if (providerFilter !== 'all' && providerId !== providerFilter) continue;

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

    // Available providers for filter
    const availableProviders = useMemo(() => {
        return LLM_PROVIDERS.filter((p) => providers[p]?.models.length);
    }, [providers]);

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
                        {currentLLM?.provider &&
                        PROVIDER_LOGOS[currentLLM.provider as LLMProvider] ? (
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
                        'w-[calc(100vw-32px)] max-w-[650px]',
                        isWelcomeScreen ? 'max-h-[min(400px,50vh)]' : 'max-h-[min(580px,75vh)]',
                        'flex flex-col p-0 overflow-hidden',
                        'rounded-xl border border-border/60 bg-popover/98 backdrop-blur-xl shadow-xl'
                    )}
                >
                    {/* Header - Search + Add Custom Button + Filters */}
                    <div className="flex-shrink-0 px-3 pt-3 pb-2 border-b border-border/30 space-y-2">
                        {(error || catalogError) && (
                            <Alert variant="destructive" className="py-2">
                                <AlertDescription className="text-xs">
                                    {error || catalogError?.message}
                                </AlertDescription>
                            </Alert>
                        )}
                        <div className="flex items-center gap-2">
                            <div className="flex-1">
                                <SearchBar
                                    value={search}
                                    onChange={setSearch}
                                    placeholder="Search models..."
                                />
                            </div>
                            <button
                                onClick={() => setShowCustomForm(!showCustomForm)}
                                className={cn(
                                    'p-2 rounded-lg transition-colors flex-shrink-0',
                                    showCustomForm
                                        ? 'bg-primary text-primary-foreground'
                                        : 'bg-muted/50 text-muted-foreground hover:text-foreground hover:bg-muted'
                                )}
                                title="Add custom model"
                            >
                                <Plus className="h-4 w-4" />
                            </button>
                        </div>

                        {/* Provider Filter Pills - only in All view */}
                        {activeView === 'all' && availableProviders.length > 1 && (
                            <div className="flex items-center gap-1.5 flex-wrap pt-1">
                                <Filter className="h-3 w-3 text-muted-foreground flex-shrink-0" />
                                <button
                                    onClick={() => setProviderFilter('all')}
                                    className={cn(
                                        'px-2 py-1 text-[11px] font-medium rounded-md transition-colors',
                                        providerFilter === 'all'
                                            ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                                            : 'bg-muted/50 text-muted-foreground hover:bg-muted hover:text-foreground'
                                    )}
                                >
                                    All
                                </button>
                                {availableProviders.map((providerId) => (
                                    <button
                                        key={providerId}
                                        onClick={() => setProviderFilter(providerId)}
                                        className={cn(
                                            'flex items-center gap-1 px-2 py-1 text-[11px] font-medium rounded-md transition-colors',
                                            providerFilter === providerId
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
                                                        providerFilter !== providerId &&
                                                        'dark:invert dark:brightness-0 dark:contrast-200'
                                                )}
                                            />
                                        )}
                                        <span className="hidden sm:inline">
                                            {providers[providerId]?.name || providerId}
                                        </span>
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>

                    {/* Custom Model Form (collapsible) */}
                    {showCustomForm && (
                        <div className="flex-shrink-0 px-3 py-3 border-b border-border/30 bg-muted/10">
                            <div className="space-y-2">
                                <div className="flex items-center justify-between">
                                    <span className="text-xs font-medium text-foreground">
                                        Add Custom Model
                                    </span>
                                    <button
                                        onClick={() => setShowCustomForm(false)}
                                        className="p-1 rounded hover:bg-muted transition-colors"
                                    >
                                        <X className="h-3 w-3 text-muted-foreground" />
                                    </button>
                                </div>
                                <div className="grid grid-cols-2 gap-2">
                                    <Input
                                        value={customModelForm.name}
                                        onChange={(e) =>
                                            setCustomModelForm((prev) => ({
                                                ...prev,
                                                name: e.target.value,
                                            }))
                                        }
                                        placeholder="Model name *"
                                        className="h-8 text-xs"
                                    />
                                    <Input
                                        value={customModelForm.baseURL}
                                        onChange={(e) =>
                                            setCustomModelForm((prev) => ({
                                                ...prev,
                                                baseURL: e.target.value,
                                            }))
                                        }
                                        placeholder="Base URL *"
                                        className="h-8 text-xs"
                                    />
                                    <Input
                                        value={customModelForm.maxInputTokens}
                                        onChange={(e) =>
                                            setCustomModelForm((prev) => ({
                                                ...prev,
                                                maxInputTokens: e.target.value,
                                            }))
                                        }
                                        placeholder="Max input tokens (default: 128k)"
                                        type="number"
                                        className="h-8 text-xs"
                                    />
                                    <Input
                                        value={customModelForm.maxOutputTokens}
                                        onChange={(e) =>
                                            setCustomModelForm((prev) => ({
                                                ...prev,
                                                maxOutputTokens: e.target.value,
                                            }))
                                        }
                                        placeholder="Max output tokens (optional)"
                                        type="number"
                                        className="h-8 text-xs"
                                    />
                                </div>
                                <Button
                                    onClick={addCustomModel}
                                    size="sm"
                                    className="w-full h-8 text-xs"
                                >
                                    <Plus className="h-3 w-3 mr-1" />
                                    Add Model
                                </Button>
                            </div>

                            {customModels.length > 0 && (
                                <div className="mt-3 pt-3 border-t border-border/30">
                                    <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">
                                        Saved Custom Models
                                    </span>
                                    <div className="flex gap-1.5 mt-2 flex-wrap">
                                        {customModels.map((cm) => (
                                            <div
                                                key={cm.name}
                                                className="group flex items-center gap-1.5 px-2 py-1 rounded-md bg-card/60 border border-border/40 text-[11px]"
                                            >
                                                <Bot className="h-2.5 w-2.5 text-muted-foreground" />
                                                <button
                                                    className="hover:text-primary transition-colors"
                                                    onClick={() => onPickCustomModel(cm)}
                                                >
                                                    {cm.name}
                                                </button>
                                                <button
                                                    onClick={() => deleteCustomModel(cm.name)}
                                                    className="text-muted-foreground hover:text-destructive opacity-0 group-hover:opacity-100 transition-opacity"
                                                >
                                                    <X className="h-2.5 w-2.5" />
                                                </button>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </div>
                    )}

                    {/* Main Content */}
                    <div className="flex-1 min-h-0 overflow-y-auto p-3">
                        {loading ? (
                            <div className="flex items-center justify-center py-8">
                                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                            </div>
                        ) : activeView === 'favorites' ? (
                            /* Favorites List View */
                            favoriteModels.length === 0 ? (
                                <div className="flex flex-col items-center justify-center py-8 text-center">
                                    <Star className="h-8 w-8 text-muted-foreground/30 mb-2" />
                                    <p className="text-sm font-medium text-muted-foreground">
                                        No favorites yet
                                    </p>
                                    <p className="text-xs text-muted-foreground/70 mt-1">
                                        Click &quot;Show all&quot; to browse and add favorites
                                    </p>
                                </div>
                            ) : (
                                <div className="space-y-1">
                                    {favoriteModels
                                        .filter(({ providerId, model }) => {
                                            if (!search.trim()) return true;
                                            const q = search.trim().toLowerCase();
                                            return (
                                                model.name.toLowerCase().includes(q) ||
                                                (model.displayName?.toLowerCase().includes(q) ??
                                                    false) ||
                                                providerId.toLowerCase().includes(q)
                                            );
                                        })
                                        .map(({ providerId, model }) => (
                                            <div
                                                key={favKey(providerId, model.name)}
                                                onClick={() => onPickModel(providerId, model)}
                                                onKeyDown={(e) => {
                                                    if (e.target !== e.currentTarget) return;
                                                    if (e.key === 'Enter' || e.key === ' ') {
                                                        e.preventDefault();
                                                        onPickModel(providerId, model);
                                                    }
                                                }}
                                                role="button"
                                                tabIndex={0}
                                                className={cn(
                                                    'w-full flex items-center gap-3 px-3 py-2.5 rounded-lg transition-colors cursor-pointer',
                                                    'hover:bg-accent/50',
                                                    isCurrentModel(providerId, model.name)
                                                        ? 'bg-primary/10 border border-primary/30'
                                                        : 'border border-transparent'
                                                )}
                                            >
                                                <div className="w-8 h-8 flex items-center justify-center rounded-lg bg-muted/60 flex-shrink-0">
                                                    {PROVIDER_LOGOS[providerId] ? (
                                                        <Image
                                                            src={PROVIDER_LOGOS[providerId]}
                                                            alt=""
                                                            width={20}
                                                            height={20}
                                                            className={cn(
                                                                'object-contain',
                                                                needsDarkModeInversion(
                                                                    providerId
                                                                ) &&
                                                                    'dark:invert dark:brightness-0 dark:contrast-200'
                                                            )}
                                                        />
                                                    ) : (
                                                        <Bot className="h-4 w-4 text-muted-foreground" />
                                                    )}
                                                </div>
                                                <div className="flex-1 text-left min-w-0">
                                                    <div className="text-sm font-medium text-foreground truncate">
                                                        {model.displayName || model.name}
                                                    </div>
                                                </div>
                                                <div className="flex items-center gap-1 flex-shrink-0">
                                                    {model.supportedFileTypes.includes('image') && (
                                                        <span
                                                            className="w-5 h-5 rounded bg-emerald-500/20 flex items-center justify-center"
                                                            title="Vision"
                                                        >
                                                            <svg
                                                                className="w-3 h-3 text-emerald-400"
                                                                fill="none"
                                                                viewBox="0 0 24 24"
                                                                stroke="currentColor"
                                                            >
                                                                <path
                                                                    strokeLinecap="round"
                                                                    strokeLinejoin="round"
                                                                    strokeWidth={2}
                                                                    d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
                                                                />
                                                                <path
                                                                    strokeLinecap="round"
                                                                    strokeLinejoin="round"
                                                                    strokeWidth={2}
                                                                    d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"
                                                                />
                                                            </svg>
                                                        </span>
                                                    )}
                                                    {model.supportedFileTypes.includes('pdf') && (
                                                        <span
                                                            className="w-5 h-5 rounded bg-blue-500/20 flex items-center justify-center"
                                                            title="PDF"
                                                        >
                                                            <svg
                                                                className="w-3 h-3 text-blue-400"
                                                                fill="none"
                                                                viewBox="0 0 24 24"
                                                                stroke="currentColor"
                                                            >
                                                                <path
                                                                    strokeLinecap="round"
                                                                    strokeLinejoin="round"
                                                                    strokeWidth={2}
                                                                    d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                                                                />
                                                            </svg>
                                                        </span>
                                                    )}
                                                </div>
                                                <button
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        toggleFavorite(providerId, model.name);
                                                    }}
                                                    className="p-1 rounded hover:bg-yellow-500/20 transition-colors flex-shrink-0"
                                                >
                                                    <Star className="h-4 w-4 fill-yellow-400 text-yellow-400" />
                                                </button>
                                            </div>
                                        ))}
                                </div>
                            )
                        ) : (
                            /* All Models Card Grid View */
                            <div>
                                {allModels.length === 0 ? (
                                    <div className="flex flex-col items-center justify-center py-8 text-center">
                                        <p className="text-sm font-medium text-muted-foreground">
                                            No models found
                                        </p>
                                        <p className="text-xs text-muted-foreground/70 mt-1">
                                            Try adjusting your search or filters
                                        </p>
                                    </div>
                                ) : (
                                    <div
                                        className="grid gap-2 justify-center"
                                        style={{
                                            gridTemplateColumns: 'repeat(auto-fill, 140px)',
                                        }}
                                    >
                                        {allModels.map(({ providerId, provider, model }) => (
                                            <ModelCard
                                                key={`${providerId}|${model.name}`}
                                                provider={providerId}
                                                model={model}
                                                providerInfo={provider}
                                                isFavorite={favorites.includes(
                                                    favKey(providerId, model.name)
                                                )}
                                                isActive={isCurrentModel(providerId, model.name)}
                                                onClick={() => onPickModel(providerId, model)}
                                                onToggleFavorite={() =>
                                                    toggleFavorite(providerId, model.name)
                                                }
                                                size="sm"
                                            />
                                        ))}
                                    </div>
                                )}
                            </div>
                        )}
                    </div>

                    {/* Bottom Navigation Bar */}
                    <div className="flex-shrink-0 border-t border-border/30 px-3 py-2 flex items-center justify-end">
                        <button
                            onClick={() =>
                                setActiveView(activeView === 'favorites' ? 'all' : 'favorites')
                            }
                            className="flex items-center gap-1.5 text-sm font-medium text-primary hover:text-primary/80 transition-colors"
                        >
                            {activeView === 'favorites' ? (
                                <>
                                    Show all
                                    <ChevronUp className="h-4 w-4" />
                                </>
                            ) : (
                                <>
                                    Favorites
                                    <ChevronLeft className="h-4 w-4 rotate-180" />
                                </>
                            )}
                            {activeView === 'favorites' && favoriteModels.length > 0 && (
                                <span className="ml-1 w-2 h-2 rounded-full bg-primary" />
                            )}
                        </button>
                    </div>
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

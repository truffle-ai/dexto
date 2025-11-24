'use client';

import React, { useEffect, useMemo, useState, useCallback, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useLLMCatalog, useSwitchLLM, type SwitchLLMPayload } from '../hooks/useLLM';
import Image from 'next/image';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from '../ui/dialog';
import { Button } from '../ui/button';
import { Label } from '../ui/label';
import { Alert, AlertDescription } from '../ui/alert';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { ApiKeyModal } from '../ApiKeyModal';
import { useChatContext } from '../hooks/ChatContext';
import { Bot, ChevronDown, ChevronUp, Loader2, Star, Lock, HelpCircle, Plus } from 'lucide-react';
import { SearchBar } from './SearchBar';
import { ProviderSection } from './ProviderSection';
import {
    FAVORITES_STORAGE_KEY,
    CUSTOM_MODELS_STORAGE_KEY,
    CatalogResponse,
    ProviderCatalog,
    ModelInfo,
    CustomModelStorage,
    favKey,
    validateBaseURL,
} from './types';
import { LabelWithTooltip } from '../ui/label-with-tooltip';
import type { LLMRouter as SupportedRouter } from '@dexto/core';
import { Input } from '../ui/input';
import { cn } from '../../lib/utils';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../ui/tooltip';
import type { LLMProvider } from '@dexto/core';
import { LLM_PROVIDERS } from '@dexto/core';
import { PROVIDER_LOGOS, needsDarkModeInversion, formatPricingLines } from './constants';
import { CapabilityIcons } from './CapabilityIcons';
import { useAnalytics } from '@/lib/analytics/index.js';
import { extractErrorMessage, type DextoErrorResponse } from '@/lib/api-errors.js';

interface CompactModelCardProps {
    provider: LLMProvider;
    model: ModelInfo;
    providerInfo: ProviderCatalog;
    isFavorite: boolean;
    isActive: boolean;
    onClick: () => void;
    onToggleFavorite: () => void;
}

function CompactModelCard({
    provider,
    model,
    providerInfo,
    isFavorite,
    isActive,
    onClick,
    onToggleFavorite,
}: CompactModelCardProps) {
    const displayName = model.displayName || model.name;
    const hasApiKey = providerInfo.hasApiKey;

    // Build description lines for tooltip
    const priceLines = formatPricingLines(model.pricing || undefined);
    const descriptionLines = [
        `Max tokens: ${model.maxInputTokens.toLocaleString()}`,
        model.supportedFileTypes.length > 0 && `Supports: ${model.supportedFileTypes.join(', ')}`,
        !hasApiKey && '⚠️ API key required',
        ...priceLines,
    ].filter(Boolean) as string[];

    return (
        <TooltipProvider>
            <Tooltip>
                <TooltipTrigger asChild>
                    <div
                        onClick={onClick}
                        onKeyDown={(event) => {
                            const target = event.target as HTMLElement | null;
                            if (target && target.closest('button')) return;

                            const isEnter = event.key === 'Enter';
                            const isSpace =
                                event.key === ' ' ||
                                event.key === 'Spacebar' ||
                                event.code === 'Space';
                            if (!isEnter && !isSpace) return;
                            if (isSpace) event.preventDefault();
                            onClick();
                        }}
                        className={cn(
                            'w-full flex items-center gap-4 px-4 py-3 rounded-xl transition-all duration-150 cursor-pointer group',
                            'hover:bg-accent/50 hover:shadow-md hover:scale-[1.01]',
                            isActive &&
                                'bg-primary/10 shadow-md ring-2 ring-primary/20 scale-[1.01]',
                            !hasApiKey && 'opacity-60'
                        )}
                        role="button"
                        tabIndex={0}
                    >
                        {/* Provider Logo */}
                        <div className="w-6 h-6 flex-shrink-0 flex items-center justify-center">
                            {PROVIDER_LOGOS[provider] ? (
                                <Image
                                    src={PROVIDER_LOGOS[provider]}
                                    alt={`${provider} logo`}
                                    width={24}
                                    height={24}
                                    className={cn(
                                        'object-contain',
                                        // Apply invert filter in dark mode for monochrome logos
                                        needsDarkModeInversion(provider) &&
                                            'dark:invert dark:brightness-0 dark:contrast-200'
                                    )}
                                />
                            ) : (
                                <HelpCircle className="h-5 w-5 text-muted-foreground" />
                            )}
                        </div>

                        {/* Model Name */}
                        <div className="flex-1 text-left min-w-0">
                            <div className="text-sm font-semibold text-foreground truncate">
                                {displayName}
                            </div>
                            <div className="text-xs text-muted-foreground">{provider}</div>
                        </div>

                        {/* Capability Icons */}
                        <CapabilityIcons
                            supportedFileTypes={model.supportedFileTypes}
                            hasApiKey={hasApiKey}
                        />

                        {/* Favorite Star */}
                        <TooltipProvider>
                            <Tooltip>
                                <TooltipTrigger asChild>
                                    <button
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            onToggleFavorite();
                                        }}
                                        className={cn(
                                            'flex-shrink-0 transition-all duration-200',
                                            'hover:scale-110 active:scale-95',
                                            isFavorite
                                                ? 'text-yellow-500 hover:text-yellow-400'
                                                : 'text-muted-foreground hover:text-yellow-500'
                                        )}
                                        aria-label={
                                            isFavorite
                                                ? 'Remove from favorites'
                                                : 'Add to favorites'
                                        }
                                    >
                                        <Star
                                            className={cn('h-4 w-4', isFavorite && 'fill-current')}
                                        />
                                    </button>
                                </TooltipTrigger>
                                <TooltipContent side="top">
                                    <span>
                                        {isFavorite ? 'Remove from favorites' : 'Add to favorites'}
                                    </span>
                                </TooltipContent>
                            </Tooltip>
                        </TooltipProvider>
                    </div>
                </TooltipTrigger>
                <TooltipContent side="right" className="max-w-xs">
                    <div className="text-xs space-y-0.5">
                        {descriptionLines.map((line, idx) => (
                            <div key={idx}>{line}</div>
                        ))}
                    </div>
                </TooltipContent>
            </Tooltip>
        </TooltipProvider>
    );
}

export default function ModelPickerModal() {
    const [open, setOpen] = useState(false);
    const [providers, setProviders] = useState<Partial<Record<LLMProvider, ProviderCatalog>>>({});
    const [search, setSearch] = useState('');
    const [advancedOpen, setAdvancedOpen] = useState(false);
    const [selectedRouter, setSelectedRouter] = useState<SupportedRouter | ''>('');
    const [baseURL, setBaseURL] = useState('');
    const [activeTab, setActiveTab] = useState<'favorites' | 'all' | 'custom'>('favorites');
    const [error, setError] = useState<string | null>(null);

    // Custom models state
    const [customModels, setCustomModels] = useState<CustomModelStorage[]>([]);
    const [customModelForm, setCustomModelForm] = useState({
        name: '',
        baseURL: '',
        maxInputTokens: '',
        maxOutputTokens: '',
    });
    const [showCustomModelForm, setShowCustomModelForm] = useState(false);

    // API key modal
    const [keyModalOpen, setKeyModalOpen] = useState(false);
    const [pendingKeyProvider, setPendingKeyProvider] = useState<LLMProvider | null>(null);
    const [pendingSelection, setPendingSelection] = useState<{
        provider: LLMProvider;
        model: string;
    } | null>(null);

    const { currentSessionId, currentLLM, refreshCurrentLLM } = useChatContext();
    const queryClient = useQueryClient();

    // Analytics tracking
    const analytics = useAnalytics();
    const analyticsRef = useRef(analytics);

    // Keep analytics ref up to date to avoid stale closure issues
    useEffect(() => {
        analyticsRef.current = analytics;
    }, [analytics]);

    // Load catalog when opening
    const { data: catalogData, isLoading: loading, error: catalogError } = useLLMCatalog(open);

    useEffect(() => {
        if (catalogData && 'providers' in catalogData) {
            setProviders(catalogData.providers);
        }
    }, [catalogData]);

    // When opening, initialize advanced panel inputs from current session LLM
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
                const loadedFavorites = favRaw ? (JSON.parse(favRaw) as string[]) : [];
                setFavorites(loadedFavorites);

                const customRaw = localStorage.getItem(CUSTOM_MODELS_STORAGE_KEY);
                const loadedCustom = customRaw
                    ? (JSON.parse(customRaw) as CustomModelStorage[])
                    : [];
                setCustomModels(loadedCustom);

                // Default to favorites if user has any, otherwise custom if they have custom models, otherwise all
                if (loadedFavorites.length > 0) {
                    setActiveTab('favorites');
                } else if (loadedCustom.length > 0) {
                    setActiveTab('custom');
                } else {
                    setActiveTab('all');
                }
            } catch {
                setFavorites([]);
                setCustomModels([]);
                setActiveTab('all');
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

        // Validation
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
            maxInputTokens: maxInputTokens
                ? (() => {
                      const parsed = parseInt(maxInputTokens, 10);
                      return isNaN(parsed) ? undefined : parsed;
                  })()
                : undefined,
            maxOutputTokens: maxOutputTokens
                ? (() => {
                      const parsed = parseInt(maxOutputTokens, 10);
                      return isNaN(parsed) ? undefined : parsed;
                  })()
                : undefined,
        };

        const updated = [...customModels, newModel];
        setCustomModels(updated);
        localStorage.setItem(CUSTOM_MODELS_STORAGE_KEY, JSON.stringify(updated));

        // Reset form
        setCustomModelForm({ name: '', baseURL: '', maxInputTokens: '', maxOutputTokens: '' });
        setShowCustomModelForm(false);
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

    // LLM switch mutation using typed hook
    const switchLLMMutation = useSwitchLLM();

    function onPickModel(providerId: LLMProvider, model: ModelInfo, customBaseURL?: string) {
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
        if (provider && !provider.hasApiKey) {
            setPendingSelection({ provider: providerId, model: model.name });
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

                // Track LLM switch
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
        // Convert CustomModelStorage to ModelInfo for openai-compatible provider
        const modelInfo: ModelInfo = {
            name: customModel.name,
            displayName: customModel.name,
            maxInputTokens: customModel.maxInputTokens || 128000,
            supportedFileTypes: ['pdf', 'image', 'audio'], // openai-compatible defaults
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
            const { provider, model } = pendingSelection;
            const m = providers[provider]?.models.find((x) => x.name === model);
            if (m) {
                onPickModel(provider, m);
            }
            setPendingSelection(null);
        }
    }

    const triggerLabel = currentLLM?.displayName || currentLLM?.model || 'Choose Model';

    // Build favorites list
    const favoriteModels = useMemo(() => {
        return favorites
            .map((key) => {
                const [providerIdRaw, modelName] = key.split('|');
                // Validate it's a real LLMProvider
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

    // Filter all models for search
    const filteredProviders = useMemo(() => {
        if (!search) return providers;
        const result = {} as typeof providers;
        for (const providerId of LLM_PROVIDERS) {
            const provider = providers[providerId];
            if (!provider) continue;
            const matchingModels = provider.models.filter((m) => modelMatchesSearch(providerId, m));
            if (matchingModels.length > 0) {
                result[providerId] = { ...provider, models: matchingModels };
            }
        }
        return result;
    }, [providers, search, modelMatchesSearch]);

    const isCurrentModel = (providerId: string, modelName: string) =>
        currentLLM?.provider === providerId && currentLLM?.model === modelName;

    return (
        <>
            <Dialog open={open} onOpenChange={setOpen}>
                <DialogTrigger asChild>
                    <Button
                        variant="ghost"
                        size="sm"
                        className="flex items-center gap-2 cursor-pointer"
                        title="Choose model"
                    >
                        {/* Provider logo (or fallback icon) */}
                        {currentLLM?.provider &&
                        PROVIDER_LOGOS[currentLLM.provider as LLMProvider] ? (
                            <Image
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
                        <ChevronDown className="h-3 w-3" />
                    </Button>
                </DialogTrigger>

                <DialogContent className="max-w-4xl max-h-[85vh] flex flex-col">
                    <DialogHeader className="pb-4 flex-shrink-0">
                        <DialogTitle className="text-xl">Select Model</DialogTitle>
                        <DialogDescription className="text-sm text-muted-foreground">
                            Choose your favorite model, check all models, or add your own model
                        </DialogDescription>
                    </DialogHeader>

                    <div className="flex flex-col min-h-0 flex-1 space-y-4">
                        {/* Search and Error */}
                        <div className="flex-shrink-0 space-y-4">
                            {(error || catalogError) && (
                                <Alert variant="destructive">
                                    <AlertDescription>
                                        {error || catalogError?.message}
                                    </AlertDescription>
                                </Alert>
                            )}
                            <SearchBar
                                value={search}
                                onChange={setSearch}
                                placeholder="Search models, providers..."
                            />
                        </div>

                        {/* Tabs */}
                        {!search && (
                            <div className="flex gap-2 border-b border-border pb-2">
                                <button
                                    onClick={() => setActiveTab('favorites')}
                                    className={cn(
                                        'flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-t-lg transition-colors',
                                        activeTab === 'favorites'
                                            ? 'bg-primary/10 text-primary border-b-2 border-primary'
                                            : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
                                    )}
                                >
                                    <Star
                                        className={cn(
                                            'h-4 w-4',
                                            activeTab === 'favorites' && 'fill-current'
                                        )}
                                    />
                                    Favorites
                                    {favoriteModels.length > 0 && (
                                        <span className="text-xs opacity-70">
                                            ({favoriteModels.length})
                                        </span>
                                    )}
                                </button>
                                <button
                                    onClick={() => setActiveTab('all')}
                                    className={cn(
                                        'flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-t-lg transition-colors',
                                        activeTab === 'all'
                                            ? 'bg-primary/10 text-primary border-b-2 border-primary'
                                            : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
                                    )}
                                >
                                    <Bot className="h-4 w-4" />
                                    All Models
                                </button>
                                <button
                                    onClick={() => setActiveTab('custom')}
                                    className={cn(
                                        'flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-t-lg transition-colors',
                                        activeTab === 'custom'
                                            ? 'bg-primary/10 text-primary border-b-2 border-primary'
                                            : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
                                    )}
                                >
                                    <Plus className="h-4 w-4" />
                                    Custom
                                    {customModels.length > 0 && (
                                        <span className="text-xs opacity-70">
                                            ({customModels.length})
                                        </span>
                                    )}
                                </button>
                            </div>
                        )}

                        {/* Tab Content */}
                        <div className="flex-1 overflow-auto px-1 min-h-0">
                            {loading ? (
                                <div className="flex items-center gap-2 text-sm text-muted-foreground justify-center py-8">
                                    <Loader2 className="h-4 w-4 animate-spin" /> Loading models...
                                </div>
                            ) : search ? (
                                // Search results across all models
                                <div className="space-y-6 pb-2">
                                    {Object.keys(filteredProviders).length === 0 ? (
                                        <div className="text-sm text-muted-foreground text-center py-8">
                                            No models found matching your search
                                        </div>
                                    ) : (
                                        LLM_PROVIDERS.map((providerId) => {
                                            const provider = filteredProviders[providerId];
                                            if (!provider) return null;
                                            return (
                                                <ProviderSection
                                                    key={providerId}
                                                    providerId={providerId}
                                                    provider={provider}
                                                    models={provider.models}
                                                    favorites={favorites}
                                                    currentModel={currentLLM || undefined}
                                                    onToggleFavorite={toggleFavorite}
                                                    onUse={onPickModel}
                                                />
                                            );
                                        })
                                    )}
                                </div>
                            ) : activeTab === 'favorites' ? (
                                // Favorites tab
                                favoriteModels.length === 0 ? (
                                    <div className="flex flex-col items-center justify-center py-12 text-center space-y-3">
                                        <Star className="h-12 w-12 text-muted-foreground/40" />
                                        <div>
                                            <p className="text-sm font-medium text-muted-foreground">
                                                No favorites yet
                                            </p>
                                            <p className="text-xs text-muted-foreground mt-1">
                                                Star models to add them to your favorites
                                            </p>
                                        </div>
                                    </div>
                                ) : (
                                    <div className="space-y-2 pb-2">
                                        {favoriteModels.map(({ providerId, provider, model }) => (
                                            <CompactModelCard
                                                key={favKey(providerId, model.name)}
                                                provider={providerId as LLMProvider}
                                                model={model}
                                                providerInfo={provider}
                                                isFavorite={true}
                                                isActive={isCurrentModel(providerId, model.name)}
                                                onClick={() => onPickModel(providerId, model)}
                                                onToggleFavorite={() =>
                                                    toggleFavorite(providerId, model.name)
                                                }
                                            />
                                        ))}
                                    </div>
                                )
                            ) : activeTab === 'custom' ? (
                                // Custom Models tab
                                <div className="space-y-4 pb-2">
                                    {/* Custom models list */}
                                    {customModels.length > 0 && (
                                        <div className="space-y-2">
                                            {customModels.map((cm) => (
                                                <div
                                                    key={cm.name}
                                                    className="flex items-center justify-between p-3 rounded-lg border border-border hover:bg-accent/50 transition-colors"
                                                >
                                                    <div className="flex-1 min-w-0">
                                                        <div className="flex items-center gap-2">
                                                            <span className="text-sm font-medium">
                                                                {cm.name}
                                                            </span>
                                                            <span className="text-xs text-muted-foreground">
                                                                openai-compatible
                                                            </span>
                                                        </div>
                                                        <div className="text-xs text-muted-foreground truncate mt-0.5">
                                                            {cm.baseURL}
                                                        </div>
                                                    </div>
                                                    <div className="flex items-center gap-2 ml-2">
                                                        <Button
                                                            size="sm"
                                                            variant="ghost"
                                                            onClick={() => onPickCustomModel(cm)}
                                                            className="h-8 px-3"
                                                        >
                                                            Use
                                                        </Button>
                                                        <Button
                                                            size="sm"
                                                            variant="ghost"
                                                            onClick={() =>
                                                                deleteCustomModel(cm.name)
                                                            }
                                                            className="h-8 w-8 p-0 text-destructive hover:text-destructive"
                                                            aria-label={`Delete custom model ${cm.name}`}
                                                        >
                                                            ×
                                                        </Button>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    )}

                                    {/* Add Custom Model Form */}
                                    <div className="space-y-3 pt-4 border-t border-border">
                                        <Button
                                            variant="ghost"
                                            size="sm"
                                            onClick={() =>
                                                setShowCustomModelForm(!showCustomModelForm)
                                            }
                                            className="flex items-center justify-between w-full p-0 h-auto hover:bg-transparent"
                                        >
                                            <span className="text-sm font-medium text-muted-foreground">
                                                {customModels.length === 0
                                                    ? 'Add your first custom model'
                                                    : 'Add another model'}
                                            </span>
                                            {showCustomModelForm ? (
                                                <ChevronUp className="h-4 w-4" />
                                            ) : (
                                                <ChevronDown className="h-4 w-4" />
                                            )}
                                        </Button>
                                        {showCustomModelForm && (
                                            <div className="space-y-4 pl-4 border-l-2 border-muted">
                                                <div className="space-y-2">
                                                    <LabelWithTooltip
                                                        htmlFor="custom-model-name"
                                                        tooltip="Model identifier (e.g., llama3, mixtral, gpt-5)"
                                                    >
                                                        Model Name *
                                                    </LabelWithTooltip>
                                                    <Input
                                                        id="custom-model-name"
                                                        value={customModelForm.name}
                                                        onChange={(e) =>
                                                            setCustomModelForm((prev) => ({
                                                                ...prev,
                                                                name: e.target.value,
                                                            }))
                                                        }
                                                        placeholder="e.g., llama3"
                                                        className="text-sm"
                                                    />
                                                </div>
                                                <div className="space-y-2">
                                                    <LabelWithTooltip
                                                        htmlFor="custom-base-url"
                                                        tooltip="OpenAI-compatible endpoint URL. Must include /v1 path (e.g., http://localhost:1234/v1)"
                                                    >
                                                        Base URL *
                                                    </LabelWithTooltip>
                                                    <Input
                                                        id="custom-base-url"
                                                        value={customModelForm.baseURL}
                                                        onChange={(e) =>
                                                            setCustomModelForm((prev) => ({
                                                                ...prev,
                                                                baseURL: e.target.value,
                                                            }))
                                                        }
                                                        placeholder="http://localhost:1234/v1"
                                                        className="text-sm"
                                                    />
                                                </div>
                                                <div className="grid grid-cols-2 gap-3">
                                                    <div className="space-y-2">
                                                        <LabelWithTooltip
                                                            htmlFor="custom-max-input"
                                                            tooltip="Maximum input tokens to send to the model. Defaults to 128,000 if not specified"
                                                        >
                                                            Max Input Tokens
                                                        </LabelWithTooltip>
                                                        <Input
                                                            id="custom-max-input"
                                                            type="number"
                                                            value={customModelForm.maxInputTokens}
                                                            onChange={(e) =>
                                                                setCustomModelForm((prev) => ({
                                                                    ...prev,
                                                                    maxInputTokens: e.target.value,
                                                                }))
                                                            }
                                                            placeholder="128000"
                                                            className="text-sm"
                                                            min="1"
                                                        />
                                                    </div>
                                                    <div className="space-y-2">
                                                        <LabelWithTooltip
                                                            htmlFor="custom-max-output"
                                                            tooltip="Maximum output tokens the model can generate. Uses provider's default if not specified"
                                                        >
                                                            Max Output Tokens
                                                        </LabelWithTooltip>
                                                        <Input
                                                            id="custom-max-output"
                                                            type="number"
                                                            value={customModelForm.maxOutputTokens}
                                                            onChange={(e) =>
                                                                setCustomModelForm((prev) => ({
                                                                    ...prev,
                                                                    maxOutputTokens: e.target.value,
                                                                }))
                                                            }
                                                            placeholder="Auto"
                                                            className="text-sm"
                                                            min="1"
                                                        />
                                                    </div>
                                                </div>
                                                <Button
                                                    onClick={addCustomModel}
                                                    size="sm"
                                                    className="w-full"
                                                >
                                                    Add Model
                                                </Button>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            ) : (
                                // All Models tab
                                <div className="space-y-6 pb-2">
                                    {Object.keys(providers).length === 0 ? (
                                        <div className="text-sm text-muted-foreground text-center py-8">
                                            No providers available
                                        </div>
                                    ) : (
                                        LLM_PROVIDERS.map((providerId) => {
                                            const provider = providers[providerId];
                                            if (!provider) return null;
                                            return (
                                                <ProviderSection
                                                    key={providerId}
                                                    providerId={providerId}
                                                    provider={provider}
                                                    models={provider.models}
                                                    favorites={favorites}
                                                    currentModel={currentLLM || undefined}
                                                    onToggleFavorite={toggleFavorite}
                                                    onUse={onPickModel}
                                                />
                                            );
                                        })
                                    )}
                                </div>
                            )}
                        </div>
                    </div>
                </DialogContent>
            </Dialog>

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

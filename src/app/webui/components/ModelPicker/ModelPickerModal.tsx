"use client";

import React, { useEffect, useMemo, useState, useCallback } from "react";
import Image from "next/image";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "../ui/dialog";
import { Button } from "../ui/button";
import { Label } from "../ui/label";
import { Alert, AlertDescription } from "../ui/alert";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select";
import { ApiKeyModal } from "../ApiKeyModal";
import { useChatContext } from "../hooks/ChatContext";
import { Bot, ChevronDown, ChevronUp, Loader2, Star, Lock, HelpCircle } from "lucide-react";
import { SearchBar } from "./SearchBar";
import { ProviderSection } from "./ProviderSection";
import { FAVORITES_STORAGE_KEY, CatalogResponse, ProviderCatalog, ModelInfo, favKey, validateBaseURL } from "./types";
import type { LLMRouter as SupportedRouter } from "@core/llm/registry.js";
import { Input } from "../ui/input";
import { cn } from "../../lib/utils";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "../ui/tooltip";
import type { LLMProvider } from "@core/llm/registry.js";
import { PROVIDER_LOGOS, needsDarkModeInversion, formatPricingLines } from "./constants";
import { CapabilityIcons } from "./CapabilityIcons";

interface CompactModelCardProps {
  provider: LLMProvider;
  model: ModelInfo;
  providerInfo: ProviderCatalog;
  isFavorite: boolean;
  isActive: boolean;
  onClick: () => void;
  onToggleFavorite: () => void;
}

function CompactModelCard({ provider, model, providerInfo, isFavorite, isActive, onClick, onToggleFavorite }: CompactModelCardProps) {
  const displayName = model.displayName || model.name;
  const hasApiKey = providerInfo.hasApiKey;
  
  // Build description lines for tooltip
  const priceLines = formatPricingLines(model.pricing || undefined);
  const descriptionLines = [
    `Max tokens: ${model.maxInputTokens.toLocaleString()}`,
    model.supportedFileTypes.length > 0 && `Supports: ${model.supportedFileTypes.join(', ')}`,
    !hasApiKey && '⚠️ API key required',
    ...priceLines
  ].filter(Boolean) as string[];

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <div
            onClick={onClick}
            className={cn(
              "w-full flex items-center gap-4 px-4 py-3 rounded-xl transition-all duration-150 cursor-pointer group",
              "hover:bg-accent/50 hover:shadow-md hover:scale-[1.01]",
              isActive && "bg-primary/10 shadow-md ring-2 ring-primary/20 scale-[1.01]",
              !hasApiKey && "opacity-60"
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
                    "object-contain",
                    // Apply invert filter in dark mode for monochrome logos
                    needsDarkModeInversion(provider) && "dark:invert dark:brightness-0 dark:contrast-200"
                  )}
                />
              ) : (
                <HelpCircle className="h-5 w-5 text-muted-foreground" />
              )}
            </div>
            
            {/* Model Name */}
            <div className="flex-1 text-left min-w-0">
              <div className="text-sm font-semibold text-foreground truncate">{displayName}</div>
              <div className="text-xs text-muted-foreground">{provider}</div>
            </div>
            
            {/* Capability Icons */}
            <CapabilityIcons 
              supportedFileTypes={model.supportedFileTypes}
              hasApiKey={hasApiKey}
            />
            
            {/* Favorite Star */}
            <button
              onClick={(e) => {
                e.stopPropagation();
                onToggleFavorite();
              }}
              className={cn(
                "flex-shrink-0 transition-all duration-200",
                "hover:scale-110 active:scale-95",
                isFavorite 
                  ? "text-yellow-500 hover:text-yellow-400" 
                  : "text-muted-foreground hover:text-yellow-500"
              )}
              aria-label={isFavorite ? "Remove from favorites" : "Add to favorites"}
            >
              <Star className={cn("h-4 w-4", isFavorite && "fill-current")} />
            </button>
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
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [providers, setProviders] = useState<Record<string, ProviderCatalog>>({});
  const [search, setSearch] = useState("");
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [selectedRouter, setSelectedRouter] = useState<SupportedRouter | "">("");
  const [baseURL, setBaseURL] = useState("");
  const [saving, setSaving] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [favoritesCollapsed, setFavoritesCollapsed] = useState(false);
  
  // API key modal
  const [keyModalOpen, setKeyModalOpen] = useState(false);
  const [pendingKeyProvider, setPendingKeyProvider] = useState<string | null>(null);
  const [pendingSelection, setPendingSelection] = useState<{ provider: string; model: string } | null>(null);

  const { currentSessionId, currentLLM, refreshCurrentLLM } = useChatContext();

  // When opening, initialize advanced panel inputs from current session LLM
  useEffect(() => {
    if (!open) return;
    if (currentLLM) {
      setSelectedRouter((currentLLM.router as SupportedRouter) || 'vercel');
      setBaseURL(currentLLM.baseURL || '');
    }
  }, [open, currentLLM]);

  // Load catalog when opening
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const catRes = await fetch('/api/llm/catalog');
        if (!cancelled) {
          if (catRes.ok) {
            const body = (await catRes.json()) as CatalogResponse;
            setProviders(body.providers || {});
          }
        }
      } catch (e) {
        if (!cancelled) setError('Failed to load catalog');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [open]);

  const [favorites, setFavorites] = useState<string[]>([]);
  
  // Load favorites from localStorage
  useEffect(() => {
    if (open) {
      try {
        const raw = localStorage.getItem(FAVORITES_STORAGE_KEY);
        setFavorites(raw ? (JSON.parse(raw) as string[]) : []);
      } catch {
        setFavorites([]);
      }
    }
  }, [open]);

  const toggleFavorite = useCallback((providerId: string, modelName: string) => {
    const key = favKey(providerId, modelName);
    setFavorites(prev => {
      const newFavs = prev.includes(key) 
        ? prev.filter(f => f !== key)
        : [...prev, key];
      localStorage.setItem(FAVORITES_STORAGE_KEY, JSON.stringify(newFavs));
      return newFavs;
    });
  }, []);

  function modelMatchesSearch(providerId: string, model: ModelInfo): boolean {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return (
      model.name.toLowerCase().includes(q) ||
      (model.displayName?.toLowerCase().includes(q) ?? false) ||
      providerId.toLowerCase().includes(q) ||
      (providers[providerId]?.name.toLowerCase().includes(q) ?? false)
    );
  }

  function pickRouterFor(providerId: string, model: ModelInfo): SupportedRouter {
    const currentRouter = (currentLLM?.router as SupportedRouter) || 'vercel';
    const providerRouters = providers[providerId]?.supportedRouters ?? ['vercel'];
    const modelRouters = model.supportedRouters ?? providerRouters;
    const preferred = selectedRouter || currentRouter;
    if (modelRouters.includes(preferred as SupportedRouter)) return preferred as SupportedRouter;
    return modelRouters[0] || providerRouters[0] || 'vercel';
  }

  async function performSwitch(providerId: string, model: ModelInfo, useBaseURL?: string) {
    setSaving(true);
    setError(null);
    try {
      const router = pickRouterFor(providerId, model);
      const body: Record<string, any> = { provider: providerId, model: model.name, router };
      if (useBaseURL && providers[providerId]?.supportsBaseURL) body.baseURL = useBaseURL;
      if (currentSessionId) body.sessionId = currentSessionId;

      const res = await fetch('/api/llm/switch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        const msg = (json?.issues && json.issues[0]?.message) || 'Failed to switch model';
        setError(msg);
        return;
      }
      // Update context config immediately so the trigger label updates
      await refreshCurrentLLM();
      // Close immediately for snappy feel
      setOpen(false);
    } catch {
      setError('Network error while switching');
    } finally {
      setSaving(false);
    }
  }

  function onPickModel(providerId: string, model: ModelInfo) {
    const provider = providers[providerId];
    if (!provider) return;
    if (provider.supportsBaseURL && baseURL) {
      const v = validateBaseURL(baseURL);
      if (!v.isValid) {
        setError(v.error || 'Invalid base URL');
        return;
      }
    }
    if (!provider.hasApiKey) {
      setPendingSelection({ provider: providerId, model: model.name });
      setPendingKeyProvider(providerId);
      setKeyModalOpen(true);
      return;
    }
    performSwitch(providerId, model, baseURL);
  }

  function onApiKeySaved(meta: { provider: string; envVar: string }) {
    setProviders((prev) => ({
      ...prev,
      [meta.provider]: prev[meta.provider]
        ? { ...prev[meta.provider], hasApiKey: true }
        : prev[meta.provider],
    }));
    setKeyModalOpen(false);
    if (pendingSelection) {
      const { provider, model } = pendingSelection;
      const m = providers[provider]?.models.find((x) => x.name === model);
      if (m) performSwitch(provider, m, baseURL);
      setPendingSelection(null);
    }
  }

  const providerIds = Object.keys(providers);
  const triggerLabel = currentLLM?.displayName || currentLLM?.model || 'Choose Model';

  // Build favorites list
  const favoriteModels = useMemo(() => {
    return favorites
      .map(key => {
        const [providerId, modelName] = key.split('|');
        const provider = providers[providerId];
        const model = provider?.models.find(m => m.name === modelName);
        if (!provider || !model) return null;
        return { providerId, provider, model };
      })
      .filter(Boolean) as Array<{ providerId: string; provider: ProviderCatalog; model: ModelInfo }>;
  }, [favorites, providers]);

  // Filter all models for search
  const filteredProviders = useMemo(() => {
    if (!search) return providers;
    const filtered: Record<string, ProviderCatalog> = {};
    providerIds.forEach(pid => {
      const matchingModels = providers[pid].models.filter(m => modelMatchesSearch(pid, m));
      if (matchingModels.length > 0) {
        filtered[pid] = {
          ...providers[pid],
          models: matchingModels
        };
      }
    });
    return filtered;
  }, [providers, search, providerIds]);

  const isCurrentModel = (providerId: string, modelName: string) => 
    currentLLM?.provider === providerId && currentLLM?.model === modelName;

  return (
    <>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger asChild>
          <Button 
            variant="ghost" 
            size="sm" 
            className="hidden lg:flex items-center gap-2 cursor-pointer" 
            title="Choose model"
          >
            {/* Provider logo (or fallback icon) */}
            {currentLLM?.provider && PROVIDER_LOGOS[currentLLM.provider as LLMProvider] ? (
              <Image
                src={PROVIDER_LOGOS[currentLLM.provider as LLMProvider]}
                alt={`${currentLLM.provider} logo`}
                width={16}
                height={16}
                className={cn(
                  "object-contain",
                  needsDarkModeInversion(currentLLM.provider as LLMProvider) && "dark:invert dark:brightness-0 dark:contrast-200"
                )}
              />
            ) : (
              <Bot className="h-4 w-4" />
            )}
            <span className="text-sm">{triggerLabel}</span>
            <ChevronDown className="h-3 w-3" />
          </Button>
        </DialogTrigger>

        <DialogContent className="max-w-4xl max-h-[85vh] overflow-hidden">
          <DialogHeader className="pb-4">
            <DialogTitle className="text-xl">Select Model</DialogTitle>
            <DialogDescription className="text-sm text-muted-foreground">
              Choose from your favorite models or explore all available options
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-6 overflow-y-auto pr-2">
            {error && (<Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>)}

            <SearchBar value={search} onChange={setSearch} placeholder="Search models, providers..." />

          {/* Favorites Section - Always visible when there are favorites */}
          {favoriteModels.length > 0 && !search && (
            <div className="space-y-3">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setFavoritesCollapsed(!favoritesCollapsed)}
                className="flex items-center justify-between w-full p-0 h-auto hover:bg-transparent"
              >
                <div className="flex items-center gap-2">
                  <Star className="h-4 w-4 text-yellow-500 fill-current" />
                  <span className="text-sm font-medium">Favorites</span>
                  <span className="text-xs text-muted-foreground">({favoriteModels.length})</span>
                </div>
                {favoritesCollapsed ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
              </Button>
              
              {!favoritesCollapsed && (
                <div className="space-y-1">
                  <div className="max-h-[280px] overflow-y-auto pr-1 space-y-1">
                    {favoriteModels.map(({ providerId, provider, model }) => (
                      <CompactModelCard
                        key={favKey(providerId, model.name)}
                        provider={providerId as LLMProvider}
                        model={model}
                        providerInfo={provider}
                        isFavorite={true}
                        isActive={isCurrentModel(providerId, model.name)}
                        onClick={() => onPickModel(providerId, model)}
                        onToggleFavorite={() => toggleFavorite(providerId, model.name)}
                      />
                    ))}
                  </div>
                  {favoriteModels.length > 6 && (
                    <div className="text-xs text-muted-foreground text-center">
                      Scroll to see all {favoriteModels.length} favorites
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Show All / Collapse Toggle */}
          {!search && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowAll(!showAll)}
              className="w-full justify-center gap-2"
            >
              {showAll ? (
                <>Hide All Models <ChevronUp className="h-4 w-4" /></>
              ) : (
                <>Show All Models <ChevronDown className="h-4 w-4" /></>
              )}
            </Button>
          )}

          {/* All Models Section - Show when searching or "Show All" is clicked */}
          {(showAll || search) && (
            <div className="space-y-6 max-h-[50vh] overflow-auto pr-1">
              {loading ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" /> Loading models...
                </div>
              ) : Object.keys(filteredProviders).length === 0 ? (
                <div className="text-sm text-muted-foreground text-center py-8">
                  {search ? 'No models found matching your search' : 'No providers available'}
                </div>
              ) : (
                Object.entries(filteredProviders).map(([providerId, provider]) => (
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
                ))
              )}
            </div>
          )}

            {/* Advanced Options */}
            <div className="space-y-3 border-t pt-4 mt-4">
              <Button 
                variant="ghost" 
                size="sm"
                onClick={() => setAdvancedOpen(!advancedOpen)} 
                className="flex items-center justify-between w-full p-0 h-auto hover:bg-transparent"
              >
                <span className="text-sm font-medium text-muted-foreground">Advanced Options</span>
                {advancedOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
              </Button>
              {advancedOpen && (
                <div className="space-y-4 pl-4 border-l-2 border-muted">
                  <div className="space-y-2">
                    <Label className="text-sm font-medium">Router</Label>
                    <Select value={selectedRouter} onValueChange={(v) => setSelectedRouter(v as SupportedRouter)}>
                      <SelectTrigger><SelectValue placeholder="Select router" /></SelectTrigger>
                      <SelectContent>
                        {Array.from(new Set(providerIds.flatMap((id) => providers[id].supportedRouters))).map((router) => (
                          <SelectItem key={router} value={router}>
                            <span className="capitalize">{router}</span>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label className="text-sm font-medium">Custom Base URL</Label>
                    <Input 
                      value={baseURL} 
                      onChange={(e) => setBaseURL(e.target.value)} 
                      placeholder="https://api.openai.com/v1" 
                      className="text-sm"
                    />
                    <div className="text-xs text-muted-foreground">Only used for providers that support baseURL.</div>
                  </div>
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

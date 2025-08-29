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
import { FAVORITES_STORAGE_KEY, CatalogResponse, ProviderCatalog, ModelInfo, favKey, validateBaseURL, SupportedRouter } from "./types";
import { Input } from "../ui/input";
import { cn } from "../../lib/utils";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "../ui/tooltip";
import type { LLMProvider } from "../../../../core/llm/registry.js";
import { PROVIDER_LOGOS, CAPABILITY_ICONS } from "./constants";

interface CompactModelCardProps {
  provider: string;
  model: ModelInfo;
  providerInfo: ProviderCatalog;
  isFavorite: boolean;
  isActive: boolean;
  onClick: () => void;
  onToggleFavorite: (e: React.MouseEvent) => void;
}

function CompactModelCard({ provider, model, providerInfo, isFavorite, isActive, onClick, onToggleFavorite }: CompactModelCardProps) {
  const displayName = model.displayName || model.name;
  const hasApiKey = providerInfo.hasApiKey;
  
  // Build description for tooltip
  const description = [
    `Max tokens: ${model.maxInputTokens.toLocaleString()}`,
    model.supportedFileTypes.length > 0 && `Supports: ${model.supportedFileTypes.join(', ')}`,
    !hasApiKey && '⚠️ API key required'
  ].filter(Boolean).join(' • ');

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            onClick={onClick}
            className={cn(
              "w-full flex items-center gap-3 px-3 py-2 rounded-lg transition-all duration-100",
              "hover:bg-accent hover:shadow-sm",
              isActive && "bg-accent shadow-sm ring-1 ring-accent-foreground/10",
              !hasApiKey && "opacity-60"
            )}
          >
            {/* Provider Logo */}
            <div className="w-5 h-5 flex-shrink-0 flex items-center justify-center">
              {PROVIDER_LOGOS[provider as LLMProvider] ? (
                <Image 
                  src={PROVIDER_LOGOS[provider as LLMProvider]} 
                  alt={`${provider} logo`} 
                  width={20} 
                  height={20}
                  className={cn(
                    "object-contain",
                    // Apply invert filter in dark mode for monochrome logos
                    provider !== 'google' && provider !== 'cohere' && "dark:invert dark:brightness-0 dark:contrast-200"
                  )}
                />
              ) : (
                <HelpCircle className="h-4 w-4 text-muted-foreground" />
              )}
            </div>
            
            {/* Model Name */}
            <div className="flex-1 text-left">
              <div className="text-sm font-medium">{displayName}</div>
            </div>
            
            {/* Capability Icons */}
            <div className="flex items-center gap-1 flex-shrink-0">
              {model.supportedFileTypes.includes('pdf') && (
                <span className="text-muted-foreground" title="PDF support">
                  {CAPABILITY_ICONS.pdf}
                </span>
              )}
              {model.supportedFileTypes.includes('audio') && (
                <span className="text-muted-foreground" title="Audio support">
                  {CAPABILITY_ICONS.audio}
                </span>
              )}
              {!hasApiKey && (
                <span className="text-muted-foreground" title="API key required">
                  <Lock className="h-3 w-3" />
                </span>
              )}
            </div>
            
            {/* Favorite Star */}
            <button
              onClick={onToggleFavorite}
              className="flex-shrink-0 text-muted-foreground hover:text-foreground transition-colors"
            >
              <Star className={cn("h-4 w-4", isFavorite && "fill-current text-yellow-500")} />
            </button>
          </button>
        </TooltipTrigger>
        <TooltipContent side="right" className="max-w-xs">
          <p className="text-xs">{description}</p>
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
          <Button variant="ghost" size="sm" className="hidden lg:flex items-center gap-2" title="Choose model">
            <Bot className="h-4 w-4" />
            <span className="text-sm">{triggerLabel}</span>
            <ChevronDown className="h-3 w-3" />
          </Button>
        </DialogTrigger>

        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Select Model</DialogTitle>
            <DialogDescription>Choose from your favorite models or explore all available options</DialogDescription>
          </DialogHeader>

          {error && (<Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>)}

          <SearchBar value={search} onChange={setSearch} placeholder="Search models, providers..." />

          {/* Favorites Section - Always visible when there are favorites */}
          {favoriteModels.length > 0 && !search && (
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Star className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm font-medium">Favorites</span>
              </div>
              <div className="grid gap-1">
                {favoriteModels.map(({ providerId, provider, model }) => (
                  <CompactModelCard
                    key={favKey(providerId, model.name)}
                    provider={providerId}
                    model={model}
                    providerInfo={provider}
                    isFavorite={true}
                    isActive={isCurrentModel(providerId, model.name)}
                    onClick={() => onPickModel(providerId, model)}
                    onToggleFavorite={(e) => {
                      e.stopPropagation();
                      toggleFavorite(providerId, model.name);
                    }}
                  />
                ))}
              </div>
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
          <div className="mt-4 space-y-3 border-t pt-3">
            <Button 
              variant="ghost" 
              size="sm"
              onClick={() => setAdvancedOpen(!advancedOpen)} 
              className="flex items-center justify-between w-full p-0 h-auto"
            >
              <span className="text-sm text-muted-foreground">Advanced Options</span>
              {advancedOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </Button>
            {advancedOpen && (
              <div className="space-y-4 pl-4 border-l">
                <div className="space-y-2">
                  <Label>Router</Label>
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
                  <Label>Custom Base URL</Label>
                  <Input value={baseURL} onChange={(e) => setBaseURL(e.target.value)} placeholder="https://api.openai.com/v1" />
                  <div className="text-xs text-muted-foreground">Only used for providers that support baseURL.</div>
                </div>
              </div>
            )}
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
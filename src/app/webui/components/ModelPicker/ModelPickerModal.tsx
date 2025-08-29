"use client";

import React, { useEffect, useMemo, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "../ui/dialog";
import { Button } from "../ui/button";
import { Label } from "../ui/label";
import { Alert, AlertDescription } from "../ui/alert";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select";
import { ApiKeyModal } from "../ApiKeyModal";
import { useChatContext } from "../hooks/ChatContext";
import { Bot, ChevronDown, ChevronUp, Loader2 } from "lucide-react";
import { SearchBar } from "./SearchBar";
import { FavoritesBar } from "./FavoritesBar";
import { ProviderSection } from "./ProviderSection";
import { FAVORITES_STORAGE_KEY, CatalogResponse, CurrentLLMConfigResponse, ProviderCatalog, ModelInfo, favKey, validateBaseURL, SupportedRouter } from "./types";
import { Input } from "../ui/input";

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
  const [success, setSuccess] = useState<string | null>(null);

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

  const favorites = useMemo(() => {
    try {
      const raw = localStorage.getItem(FAVORITES_STORAGE_KEY);
      return raw ? (JSON.parse(raw) as string[]) : [];
    } catch {
      return [];
    }
  }, [open]);

  function toggleFavorite(providerId: string, modelName: string) {
    try {
      const key = favKey(providerId, modelName);
      const set = new Set(favorites);
      if (set.has(key)) set.delete(key); else set.add(key);
      localStorage.setItem(FAVORITES_STORAGE_KEY, JSON.stringify(Array.from(set)));
    } catch {
      // ignore
    }
  }

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
    setSuccess(null);
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
      setSuccess(`Switched to ${providerId}/${model.name}`);
      setTimeout(() => setOpen(false), 800);
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
            <DialogTitle>Model Picker</DialogTitle>
            <DialogDescription>Search and choose a model; set a key if needed.</DialogDescription>
          </DialogHeader>

          {error && (<Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>)}
          {success && (<Alert className="border-green-200 bg-green-50 text-green-800"><AlertDescription>{success}</AlertDescription></Alert>)}

          <SearchBar value={search} onChange={setSearch} />

          <FavoritesBar 
            favorites={favorites}
            providers={providers}
            onPick={(pid, m) => {
              const model = providers[pid]?.models.find((x) => x.name === m);
              if (model) onPickModel(pid, model);
            }}
          />

          <div className="space-y-6 max-h-[60vh] overflow-auto pr-1">
            {loading ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>
            ) : providerIds.length === 0 ? (
              <div className="text-sm text-muted-foreground">No providers available.</div>
            ) : (
              providerIds.map((providerId) => (
                <ProviderSection
                  key={providerId}
                  providerId={providerId}
                  provider={providers[providerId]}
                  models={providers[providerId].models.filter((m) => (search ? (m.displayName?.toLowerCase().includes(search.toLowerCase()) || m.name.toLowerCase().includes(search.toLowerCase()) || providers[providerId].name.toLowerCase().includes(search.toLowerCase())) : true))}
                  favorites={favorites}
                  onToggleFavorite={(pid, m) => { toggleFavorite(pid, m); setSearch((s) => s); }}
                  onUse={onPickModel}
                />
              ))
            )}
          </div>

          <div className="mt-4 space-y-3">
            <Button variant="ghost" onClick={() => setAdvancedOpen((v) => !v)} className="flex items-center justify-between w-full p-0 h-auto">
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

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={saving}>Close</Button>
          </DialogFooter>
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

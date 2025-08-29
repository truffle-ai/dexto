"use client";

import React from 'react';
import { Badge } from "../ui/badge";
import type { ProviderCatalog, ModelInfo } from "./types";
import { ModelCard } from "./ModelCard";

type Props = {
  providerId: string;
  provider: ProviderCatalog;
  models: ModelInfo[];
  favorites: string[];
  onToggleFavorite: (providerId: string, modelName: string) => void;
  onUse: (providerId: string, model: ModelInfo) => void;
};

export function ProviderSection({ providerId, provider, models, favorites, onToggleFavorite, onUse }: Props) {
  if (models.length === 0) return null;
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div className="text-base font-medium">{provider.name}</div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          {provider.supportedRouters.map((r) => (
            <Badge key={r} variant="outline" className="capitalize">{r}</Badge>
          ))}
          {provider.supportsBaseURL && <Badge variant="secondary">baseURL</Badge>}
          {!provider.hasApiKey && (
            <Badge variant="destructive">Key Required</Badge>
          )}
        </div>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2">
        {models.map((model) => (
          <ModelCard
            key={model.name}
            providerId={providerId}
            model={model}
            isFavorite={favorites.includes(`${providerId}|${model.name}`)}
            onToggleFavorite={onToggleFavorite}
            onUse={onUse}
          />
        ))}
      </div>
    </div>
  );
}

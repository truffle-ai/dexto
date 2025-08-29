"use client";

import React from 'react';
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Star, StarOff } from "lucide-react";
import type { ModelInfo } from "./types";

type Props = {
  providerId: string;
  model: ModelInfo;
  isFavorite: boolean;
  onToggleFavorite: (providerId: string, modelName: string) => void;
  onUse: (providerId: string, model: ModelInfo) => void;
};

export function ModelCard({ providerId, model, isFavorite, onToggleFavorite, onUse }: Props) {
  return (
    <div className="border rounded-lg p-3 flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <div className="font-medium text-sm truncate" title={model.name}>{model.displayName || model.name}</div>
        <button className="text-muted-foreground" onClick={() => onToggleFavorite(providerId, model.name)} title={isFavorite ? "Unfavorite" : "Favorite"}>
          {isFavorite ? <Star className="h-4 w-4 fill-current" /> : <StarOff className="h-4 w-4" />}
        </button>
      </div>
      <div className="flex flex-wrap gap-1">
        {model.default && <Badge variant="secondary">default</Badge>}
        {model.supportedFileTypes.map((ft) => (
          <Badge key={ft} variant="outline">{ft}</Badge>
        ))}
      </div>
      <div className="flex items-center justify-between mt-1">
        <Button size="sm" onClick={() => onUse(providerId, model)}>
          Use
        </Button>
        <div className="text-xs text-muted-foreground">{model.maxInputTokens.toLocaleString()} tokens</div>
      </div>
    </div>
  );
}

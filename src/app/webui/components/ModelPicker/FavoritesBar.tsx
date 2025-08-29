"use client";

import React from 'react';
import { Button } from "../ui/button";
import type { ProviderCatalog } from "./types";

type Props = {
  favorites: string[];
  providers: Record<string, ProviderCatalog>;
  onPick: (providerId: string, modelName: string) => void;
};

export function FavoritesBar({ favorites, providers, onPick }: Props) {
  if (!favorites.length) return null;
  return (
    <div className="mb-4">
      <div className="text-sm font-medium mb-2">Favorites</div>
      <div className="flex flex-wrap gap-2">
        {favorites.map((key) => {
          const [providerId, modelName] = key.split('|');
          const provider = providers[providerId];
          const model = provider?.models.find((m) => m.name === modelName);
          if (!provider || !model) return null;
          return (
            <Button key={key} variant="secondary" size="sm" onClick={() => onPick(providerId, modelName)}>
              {provider.name} / {model.name}
            </Button>
          );
        })}
      </div>
    </div>
  );
}


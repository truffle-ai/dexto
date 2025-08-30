"use client";

import React from 'react';
import Image from "next/image";
import { Badge } from "../ui/badge";
import { Star, Lock, HelpCircle } from "lucide-react";
import type { ProviderCatalog, ModelInfo } from "./types";
import { cn } from "../../lib/utils";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "../ui/tooltip";
import type { LLMProvider } from "../../../../core/llm/registry.js";
import { PROVIDER_LOGOS, CAPABILITY_ICONS, needsDarkModeInversion, PROVIDER_PRICING_URLS, formatPricingLines } from "./constants";

type Props = {
  providerId: string;
  provider: ProviderCatalog;
  models: ModelInfo[];
  favorites: string[];
  currentModel?: { provider: string; model: string; displayName?: string };
  onToggleFavorite: (providerId: string, modelName: string) => void;
  onUse: (providerId: string, model: ModelInfo) => void;
};

export function ProviderSection({ providerId, provider, models, favorites, currentModel, onToggleFavorite, onUse }: Props) {
  if (models.length === 0) return null;
  
  const isCurrentModel = (modelName: string) => 
    currentModel?.provider === providerId && currentModel?.model === modelName;
  
  const isFavorite = (modelName: string) => 
    favorites.includes(`${providerId}|${modelName}`);

  return (
    <div className="space-y-3">
      {/* Provider Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-5 h-5 flex items-center justify-center">
            {PROVIDER_LOGOS[providerId as LLMProvider] ? (
              <Image 
                src={PROVIDER_LOGOS[providerId as LLMProvider]} 
                alt={`${providerId} logo`} 
                width={20} 
                height={20}
                className={cn(
                  "object-contain",
                  // Apply invert filter in dark mode for monochrome logos
                  needsDarkModeInversion(providerId as LLMProvider) && "dark:invert dark:brightness-0 dark:contrast-200"
                )}
              />
            ) : (
              <HelpCircle className="h-4 w-4 text-muted-foreground" />
            )}
          </div>
          <span className="text-base font-medium">{provider.name}</span>
        </div>
        <div className="flex items-center gap-2 text-xs">
          {provider.supportedRouters.map((r) => (
            <Badge key={r} variant="outline" className="capitalize text-xs">{r}</Badge>
          ))}
          {provider.supportsBaseURL && <Badge variant="secondary" className="text-xs">baseURL</Badge>}
          {!provider.hasApiKey && (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Badge variant="destructive" className="text-xs cursor-default">Key Required</Badge>
                </TooltipTrigger>
                <TooltipContent>
                  Click any {provider.name} model to setup the API key
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}
          {PROVIDER_PRICING_URLS[providerId as LLMProvider] && (
            <a
              href={PROVIDER_PRICING_URLS[providerId as LLMProvider]}
              target="_blank"
              rel="noopener noreferrer"
              className="text-muted-foreground hover:underline"
              title="View provider pricing"
            >
              Pricing ↗
            </a>
          )}
        </div>
      </div>
      
      {/* Models Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {models.map((model) => {
          const displayName = model.displayName || model.name;
          const isActive = isCurrentModel(model.name);
          const favorite = isFavorite(model.name);
          const hasApiKey = provider.hasApiKey;
          
          // Build description lines for tooltip
          const priceLines = formatPricingLines(model.pricing || undefined);
          const descriptionLines = [
            `Max tokens: ${model.maxInputTokens.toLocaleString()}`,
            model.supportedFileTypes.length > 0 && `Supports: ${model.supportedFileTypes.join(', ')}`,
            model.default && 'Default model',
            !hasApiKey && '⚠️ API key required',
            ...priceLines,
          ].filter(Boolean) as string[];
          
          return (
            <TooltipProvider key={model.name}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <div
                    onClick={() => onUse(providerId, model)}
                    className={cn(
                      "group relative flex items-center gap-3 px-3 py-2.5 rounded-lg border transition-all duration-100 cursor-pointer",
                      "hover:bg-accent hover:border-accent-foreground/20 hover:shadow-sm",
                      isActive && "bg-accent border-accent-foreground/20 shadow-sm ring-1 ring-accent-foreground/10",
                      !hasApiKey && "opacity-60"
                    )}
                    role="button"
                    tabIndex={0}
                  >
                    {/* Model Name and Badges */}
                    <div className="flex-1 text-left">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium">{displayName}</span>
                        {model.default && (
                          <Badge variant="secondary" className="text-[10px] px-1 py-0">default</Badge>
                        )}
                      </div>
                    </div>
                    
                    {/* Capability Icons */}
                    <div className="flex items-center gap-1.5">
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
                      {model.supportedFileTypes.includes('image') && (
                        <span className="text-muted-foreground" title="Image support">
                          {CAPABILITY_ICONS.image}
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
                      onClick={(e) => {
                        e.stopPropagation();
                        onToggleFavorite(providerId, model.name);
                      }}
                      className="flex-shrink-0 text-muted-foreground hover:text-foreground transition-colors"
                      aria-label={favorite ? "Remove from favorites" : "Add to favorites"}
                    >
                      <Star className={cn("h-4 w-4", favorite && "fill-current text-yellow-500")} />
                    </button>
                    
                    {/* Active Indicator */}
                    {isActive && (
                      <div className="absolute inset-y-0 left-0 w-0.5 bg-primary rounded-l-lg" />
                    )}
                  </div>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="max-w-xs">
                  <div className="text-xs space-y-0.5">
                    {descriptionLines.map((line, idx) => (
                      <div key={idx}>{line}</div>
                    ))}
                  </div>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          );
        })}
      </div>
    </div>
  );
}

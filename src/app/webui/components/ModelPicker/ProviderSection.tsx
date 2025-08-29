"use client";

import React from 'react';
import { Badge } from "../ui/badge";
import { Star, Eye, FileAudio, FileText, Brain, Image, Sparkles, FlaskConical, Zap, Lock } from "lucide-react";
import type { ProviderCatalog, ModelInfo } from "./types";
import { cn } from "../../lib/utils";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "../ui/tooltip";

// Provider logos mapping (same as in ModelPickerModal)
const PROVIDER_LOGOS: Record<string, string> = {
  openai: "🤖",
  anthropic: "🧠",
  google: "🔷",
  groq: "⚡",
  perplexity: "🔍",
  xai: "✖️",
  mistral: "Ⓜ️",
  openrouter: "🌐",
  'openai-compatible': "🔧",
};

// Model capability icons
const CAPABILITY_ICONS = {
  vision: <Eye className="h-3 w-3" />,
  image: <Image className="h-3 w-3" />,
  audio: <FileAudio className="h-3 w-3" />,
  pdf: <FileText className="h-3 w-3" />,
  reasoning: <Brain className="h-3 w-3" />,
  experimental: <FlaskConical className="h-3 w-3" />,
  new: <Sparkles className="h-3 w-3" />,
  realtime: <Zap className="h-3 w-3" />,
};

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
          <span className="text-lg">{PROVIDER_LOGOS[providerId] || "🤖"}</span>
          <span className="text-base font-medium">{provider.name}</span>
        </div>
        <div className="flex items-center gap-2 text-xs">
          {provider.supportedRouters.map((r) => (
            <Badge key={r} variant="outline" className="capitalize text-xs">{r}</Badge>
          ))}
          {provider.supportsBaseURL && <Badge variant="secondary" className="text-xs">baseURL</Badge>}
          {!provider.hasApiKey && (
            <Badge variant="destructive" className="text-xs">Key Required</Badge>
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
          
          // Build description for tooltip
          const description = [
            `Max tokens: ${model.maxInputTokens.toLocaleString()}`,
            model.supportedFileTypes.length > 0 && `Supports: ${model.supportedFileTypes.join(', ')}`,
            model.default && 'Default model',
            !hasApiKey && '⚠️ API key required'
          ].filter(Boolean).join(' • ');
          
          return (
            <TooltipProvider key={model.name}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    onClick={() => onUse(providerId, model)}
                    className={cn(
                      "group relative flex items-center gap-3 px-3 py-2.5 rounded-lg border transition-all duration-100",
                      "hover:bg-accent hover:border-accent-foreground/20 hover:shadow-sm",
                      isActive && "bg-accent border-accent-foreground/20 shadow-sm ring-1 ring-accent-foreground/10",
                      !hasApiKey && "opacity-60"
                    )}
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
                    >
                      <Star className={cn("h-4 w-4", favorite && "fill-current text-yellow-500")} />
                    </button>
                    
                    {/* Active Indicator */}
                    {isActive && (
                      <div className="absolute inset-y-0 left-0 w-0.5 bg-primary rounded-l-lg" />
                    )}
                  </button>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="max-w-xs">
                  <p className="text-xs">{description}</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          );
        })}
      </div>
    </div>
  );
}
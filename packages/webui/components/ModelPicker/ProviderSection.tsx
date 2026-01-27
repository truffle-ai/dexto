import React, { useState } from 'react';
import { Star, HelpCircle, ChevronDown, ChevronRight, ExternalLink } from 'lucide-react';
import type { ProviderCatalog, ModelInfo } from './types';
import { cn } from '../../lib/utils';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../ui/tooltip';
import type { LLMProvider } from '@dexto/core';
import {
    PROVIDER_LOGOS,
    needsDarkModeInversion,
    PROVIDER_PRICING_URLS,
    formatPricingLines,
} from './constants';
import { CapabilityIcons } from './CapabilityIcons';

type Props = {
    providerId: LLMProvider;
    provider: ProviderCatalog;
    models: ModelInfo[];
    favorites: string[];
    currentModel?: { provider: string; model: string; displayName?: string };
    onToggleFavorite: (providerId: LLMProvider, modelName: string) => void;
    onUse: (providerId: LLMProvider, model: ModelInfo) => void;
    defaultExpanded?: boolean;
};

export function ProviderSection({
    providerId,
    provider,
    models,
    favorites,
    currentModel,
    onToggleFavorite,
    onUse,
    defaultExpanded = true,
}: Props) {
    const [isExpanded, setIsExpanded] = useState(defaultExpanded);

    if (models.length === 0) return null;

    const isCurrentModel = (modelName: string) =>
        currentModel?.provider === providerId && currentModel?.model === modelName;

    const isFavorite = (modelName: string) => favorites.includes(`${providerId}|${modelName}`);

    const hasActiveModel = models.some((m) => isCurrentModel(m.name));

    return (
        <TooltipProvider>
            <div className="space-y-2">
                {/* Provider Header */}
                <button
                    onClick={() => setIsExpanded(!isExpanded)}
                    className={cn(
                        'w-full flex items-center justify-between p-3 rounded-xl transition-all duration-200',
                        'hover:bg-accent/50 group',
                        hasActiveModel && 'bg-primary/5'
                    )}
                >
                    <div className="flex items-center gap-3">
                        <div className="w-8 h-8 flex items-center justify-center rounded-lg bg-muted/50">
                            {PROVIDER_LOGOS[providerId] ? (
                                <img
                                    src={PROVIDER_LOGOS[providerId]}
                                    alt={`${providerId} logo`}
                                    width={20}
                                    height={20}
                                    className={cn(
                                        'object-contain',
                                        needsDarkModeInversion(providerId) &&
                                            'dark:invert dark:brightness-0 dark:contrast-200'
                                    )}
                                />
                            ) : (
                                <HelpCircle className="h-5 w-5 text-muted-foreground" />
                            )}
                        </div>
                        <div className="text-left">
                            <span className="text-sm font-semibold">{provider.name}</span>
                            <span className="text-xs text-muted-foreground ml-2">
                                {models.length} model{models.length !== 1 ? 's' : ''}
                            </span>
                        </div>
                    </div>
                    <div className="flex items-center gap-3">
                        {!provider.hasApiKey && (
                            <span className="text-xs px-2 py-1 rounded-md bg-amber-500/10 text-amber-500">
                                API Key Required
                            </span>
                        )}
                        {PROVIDER_PRICING_URLS[providerId] && (
                            <a
                                href={PROVIDER_PRICING_URLS[providerId]}
                                target="_blank"
                                rel="noopener noreferrer"
                                onClick={(e) => e.stopPropagation()}
                                className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity"
                            >
                                Pricing
                                <ExternalLink className="h-3 w-3" />
                            </a>
                        )}
                        {isExpanded ? (
                            <ChevronDown className="h-4 w-4 text-muted-foreground" />
                        ) : (
                            <ChevronRight className="h-4 w-4 text-muted-foreground" />
                        )}
                    </div>
                </button>

                {/* Models List */}
                {isExpanded && (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pl-2">
                        {models.map((model) => {
                            const displayName = model.displayName || model.name;
                            const isActive = isCurrentModel(model.name);
                            const favorite = isFavorite(model.name);
                            const hasApiKey = provider.hasApiKey;

                            // Build description lines for tooltip
                            const priceLines = formatPricingLines(model.pricing || undefined);
                            const descriptionLines = [
                                model.maxInputTokens &&
                                    `Max tokens: ${model.maxInputTokens.toLocaleString()}`,
                                Array.isArray(model.supportedFileTypes) &&
                                    model.supportedFileTypes.length > 0 &&
                                    `Supports: ${model.supportedFileTypes.join(', ')}`,
                                model.default && 'Default model',
                                !hasApiKey && 'API key required',
                                ...priceLines,
                            ].filter(Boolean) as string[];

                            return (
                                <Tooltip key={model.name}>
                                    <TooltipTrigger asChild>
                                        <div
                                            onClick={() => onUse(providerId, model)}
                                            onKeyDown={(e) => {
                                                const target = e.target as HTMLElement | null;
                                                if (target && target.closest('button')) return;

                                                const isEnter = e.key === 'Enter';
                                                const isSpace =
                                                    e.key === ' ' ||
                                                    e.key === 'Spacebar' ||
                                                    e.code === 'Space';

                                                if (isSpace) e.preventDefault();
                                                if (isEnter || isSpace) {
                                                    onUse(providerId, model);
                                                }
                                            }}
                                            className={cn(
                                                'group/card relative flex items-center gap-3 px-4 py-3 rounded-xl border transition-all duration-150 cursor-pointer outline-none',
                                                'hover:bg-accent/50 hover:border-accent-foreground/20 hover:shadow-sm',
                                                'focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50',
                                                isActive
                                                    ? 'bg-primary/5 border-primary/30 shadow-sm ring-1 ring-primary/20'
                                                    : 'border-border/40 bg-card/30',
                                                !hasApiKey && 'opacity-60'
                                            )}
                                            role="button"
                                            tabIndex={0}
                                        >
                                            {/* Model Name */}
                                            <div className="flex-1 text-left min-w-0">
                                                <div className="text-sm font-medium truncate">
                                                    {displayName}
                                                </div>
                                            </div>

                                            {/* Capability Icons */}
                                            <CapabilityIcons
                                                supportedFileTypes={model.supportedFileTypes}
                                                hasApiKey={hasApiKey}
                                            />

                                            {/* Favorite Star */}
                                            <button
                                                onKeyDown={(e) => {
                                                    const isSpace =
                                                        e.key === ' ' ||
                                                        e.key === 'Spacebar' ||
                                                        e.code === 'Space';
                                                    const isEnter = e.key === 'Enter';
                                                    if (isEnter || isSpace) {
                                                        e.stopPropagation();
                                                        if (isSpace) e.preventDefault();
                                                    }
                                                }}
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    onToggleFavorite(providerId, model.name);
                                                }}
                                                className={cn(
                                                    'flex-shrink-0 p-1.5 rounded-lg transition-all duration-200',
                                                    'hover:bg-accent hover:scale-110 active:scale-95',
                                                    'opacity-0 group-hover/card:opacity-100',
                                                    favorite && 'opacity-100'
                                                )}
                                                aria-label={
                                                    favorite
                                                        ? 'Remove from favorites'
                                                        : 'Add to favorites'
                                                }
                                            >
                                                <Star
                                                    className={cn(
                                                        'h-4 w-4 transition-colors',
                                                        favorite
                                                            ? 'fill-yellow-500 text-yellow-500'
                                                            : 'text-muted-foreground hover:text-yellow-500'
                                                    )}
                                                />
                                            </button>

                                            {/* Active Indicator */}
                                            {isActive && (
                                                <div className="absolute inset-y-2 left-0 w-1 bg-primary rounded-full" />
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
                            );
                        })}
                    </div>
                )}
            </div>
        </TooltipProvider>
    );
}

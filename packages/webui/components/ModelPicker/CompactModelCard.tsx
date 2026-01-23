import React from 'react';
import { Star, HelpCircle } from 'lucide-react';
import { cn } from '../../lib/utils';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../ui/tooltip';
import type { LLMProvider } from '@dexto/core';
import { PROVIDER_LOGOS, needsDarkModeInversion, formatPricingLines } from './constants';
import { CapabilityIcons } from './CapabilityIcons';
import type { ModelInfo, ProviderCatalog } from './types';

interface CompactModelCardProps {
    provider: LLMProvider;
    model: ModelInfo;
    providerInfo: ProviderCatalog;
    isFavorite: boolean;
    isActive: boolean;
    onClick: () => void;
    onToggleFavorite: () => void;
}

// Provider display name mapping
const PROVIDER_DISPLAY_NAMES: Record<string, string> = {
    anthropic: 'Claude',
    google: 'Gemini',
    openai: 'GPT',
    groq: 'Groq',
    xai: 'Grok',
    cohere: 'Cohere',
    'openai-compatible': 'Custom',
    dexto: 'Dexto',
};

// Providers that have multi-vendor models (don't strip provider prefixes from display name)
const MULTI_VENDOR_PROVIDERS = new Set([
    'openrouter',
    'dexto',
    'openai-compatible',
    'litellm',
    'glama',
    'bedrock',
    'vertex',
]);

export function CompactModelCard({
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
    const providerName = PROVIDER_DISPLAY_NAMES[provider] || provider;

    // Build description for tooltip
    const priceLines = formatPricingLines(model.pricing || undefined);
    const descriptionLines = [
        `Provider: ${providerInfo.name}`,
        model.maxInputTokens && `Max tokens: ${model.maxInputTokens.toLocaleString()}`,
        Array.isArray(model.supportedFileTypes) &&
            model.supportedFileTypes.length > 0 &&
            `Supports: ${model.supportedFileTypes.join(', ')}`,
        !hasApiKey && 'API key required',
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
                            'relative flex items-center gap-2.5 px-3 py-2 rounded-xl border transition-all duration-150 cursor-pointer group whitespace-nowrap',
                            'hover:bg-accent/50 hover:border-primary/30',
                            isActive
                                ? 'bg-primary/10 border-primary/40 shadow-sm'
                                : 'border-border/40 bg-card/60',
                            !hasApiKey && 'opacity-70'
                        )}
                        role="button"
                        tabIndex={0}
                    >
                        {/* Provider Logo */}
                        <div className="w-6 h-6 flex items-center justify-center flex-shrink-0">
                            {PROVIDER_LOGOS[provider] ? (
                                <img
                                    src={PROVIDER_LOGOS[provider]}
                                    alt={`${provider} logo`}
                                    width={20}
                                    height={20}
                                    className={cn(
                                        'object-contain',
                                        needsDarkModeInversion(provider) &&
                                            'dark:invert dark:brightness-0 dark:contrast-200'
                                    )}
                                />
                            ) : (
                                <HelpCircle className="h-4 w-4 text-muted-foreground" />
                            )}
                        </div>

                        {/* Model Name */}
                        <div className="flex flex-col min-w-0">
                            <span className="text-xs font-semibold text-foreground leading-tight truncate">
                                {providerName}
                            </span>
                            <span className="text-[10px] text-muted-foreground leading-tight truncate">
                                {MULTI_VENDOR_PROVIDERS.has(provider)
                                    ? displayName
                                    : displayName.replace(
                                          new RegExp(`^${providerName}\\s*`, 'i'),
                                          ''
                                      )}
                            </span>
                        </div>

                        {/* Capability Icons */}
                        <CapabilityIcons
                            supportedFileTypes={model.supportedFileTypes}
                            hasApiKey={hasApiKey}
                            size="sm"
                            className="flex-shrink-0"
                        />

                        {/* Favorite Star */}
                        <button
                            onClick={(e) => {
                                e.stopPropagation();
                                onToggleFavorite();
                            }}
                            className={cn(
                                'flex-shrink-0 p-0.5 rounded-full transition-all duration-200',
                                'hover:scale-110 active:scale-95',
                                'opacity-0 group-hover:opacity-100',
                                isFavorite && 'opacity-100'
                            )}
                            aria-label={isFavorite ? 'Remove from favorites' : 'Add to favorites'}
                        >
                            <Star
                                className={cn(
                                    'h-3.5 w-3.5 transition-all',
                                    isFavorite
                                        ? 'fill-yellow-400 text-yellow-400'
                                        : 'text-muted-foreground/50 hover:text-yellow-400'
                                )}
                            />
                        </button>
                    </div>
                </TooltipTrigger>
                <TooltipContent side="top" className="max-w-xs">
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

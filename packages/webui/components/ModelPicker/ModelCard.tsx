import React from 'react';
import { Star, HelpCircle, Lock, X, Pencil } from 'lucide-react';
import { cn } from '../../lib/utils';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../ui/tooltip';
import type { LLMProvider } from '@dexto/core';
import { PROVIDER_LOGOS, needsDarkModeInversion, formatPricingLines, hasLogo } from './constants';
import { CapabilityIcons } from './CapabilityIcons';
import type { ModelInfo, ProviderCatalog } from './types';

interface ModelCardProps {
    provider: LLMProvider;
    model: ModelInfo;
    providerInfo?: ProviderCatalog;
    isFavorite: boolean;
    isActive: boolean;
    onClick: () => void;
    onToggleFavorite: () => void;
    onDelete?: () => void;
    onEdit?: () => void;
    size?: 'sm' | 'md' | 'lg';
    isCustom?: boolean;
    /** Installed local model (downloaded via CLI) */
    isInstalled?: boolean;
}

// Provider display name mapping
const PROVIDER_DISPLAY_NAMES: Record<string, string> = {
    anthropic: 'Claude',
    google: 'Gemini',
    openai: 'GPT',
    groq: 'Groq',
    xai: 'Grok',
    cohere: 'Cohere',
    minimax: 'MiniMax',
    glm: 'GLM',
    openrouter: 'OpenRouter',
    'openai-compatible': 'Custom',
    litellm: 'LiteLLM',
    glama: 'Glama',
    local: 'Local',
    ollama: 'Ollama',
    dexto: 'Dexto',
};

// Parse display name into provider and model parts
function parseModelName(
    displayName: string,
    provider: string
): { providerName: string; modelName: string; suffix?: string } {
    const providerName = PROVIDER_DISPLAY_NAMES[provider] || provider;

    // For multi-vendor or custom model providers, show the full display name without parsing
    if (
        provider === 'openrouter' ||
        provider === 'dexto' ||
        provider === 'openai-compatible' ||
        provider === 'litellm' ||
        provider === 'glama' ||
        provider === 'bedrock' ||
        provider === 'vertex'
    ) {
        return { providerName, modelName: displayName };
    }

    // Extract suffix like (Reasoning) if present
    const suffixMatch = displayName.match(/\(([^)]+)\)$/);
    const suffix = suffixMatch ? suffixMatch[1] : undefined;
    const nameWithoutSuffix = suffix ? displayName.replace(/\s*\([^)]+\)$/, '') : displayName;

    // Try to extract model variant (remove provider prefix if present)
    let modelName = nameWithoutSuffix;
    const lowerName = nameWithoutSuffix.toLowerCase();
    const lowerProvider = providerName.toLowerCase();

    if (lowerName.startsWith(lowerProvider)) {
        modelName = nameWithoutSuffix.slice(providerName.length).trim();
    }

    // Clean up common patterns
    modelName = modelName.replace(/^[-\s]+/, '').replace(/^(claude|gemini|gpt|grok)\s*/i, '');

    return { providerName, modelName: modelName || nameWithoutSuffix, suffix };
}

export function ModelCard({
    provider,
    model,
    providerInfo,
    isFavorite,
    isActive,
    onClick,
    onToggleFavorite,
    onDelete,
    onEdit,
    size = 'md',
    isCustom = false,
    isInstalled = false,
}: ModelCardProps) {
    const displayName = model.displayName || model.name;
    // Local/ollama/installed models don't need API keys
    // Custom models are user-configured, so don't show lock (they handle their own auth)
    const noApiKeyNeeded = isInstalled || isCustom || provider === 'local' || provider === 'ollama';
    const hasApiKey = noApiKeyNeeded || (providerInfo?.hasApiKey ?? false);
    const { providerName, modelName, suffix } = parseModelName(displayName, provider);

    // Build description lines for tooltip
    const priceLines = formatPricingLines(model.pricing || undefined);
    const descriptionLines = [
        `Model: ${displayName}`,
        isInstalled
            ? 'Installed via CLI'
            : provider === 'local'
              ? 'Local Model'
              : provider === 'openai-compatible'
                ? 'Custom Model'
                : `Provider: ${providerInfo?.name}`,
        model.maxInputTokens && `Max tokens: ${model.maxInputTokens.toLocaleString()}`,
        Array.isArray(model.supportedFileTypes) &&
            model.supportedFileTypes.length > 0 &&
            `Supports: ${model.supportedFileTypes.join(', ')}`,
        !hasApiKey && 'API key required (click to add)',
        ...priceLines,
    ].filter(Boolean) as string[];

    const sizeClasses = {
        sm: 'px-2 py-4 h-[200px] w-full',
        md: 'px-3 py-5 h-[230px] w-full',
        lg: 'px-4 py-6 h-[275px] w-full',
    };

    const logoSizes = {
        sm: { width: 36, height: 36, container: 'w-10 h-10' },
        md: { width: 48, height: 48, container: 'w-14 h-14' },
        lg: { width: 60, height: 60, container: 'w-16 h-16' },
    };

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
                            'relative flex flex-col items-center rounded-2xl border-2 transition-all duration-200 cursor-pointer group overflow-hidden',
                            sizeClasses[size],
                            'hover:bg-accent/40 hover:border-primary/40 hover:shadow-lg hover:shadow-primary/5 hover:-translate-y-0.5',
                            isActive
                                ? 'bg-primary/10 border-primary shadow-lg shadow-primary/10'
                                : 'border-border/50 bg-card/60 backdrop-blur-sm',
                            !hasApiKey && 'opacity-70'
                        )}
                        role="button"
                        tabIndex={0}
                    >
                        {/* Lock Icon - Top Left (when no API key) */}
                        {!hasApiKey && (
                            <Tooltip>
                                <TooltipTrigger asChild>
                                    <div className="absolute top-2 left-2 p-1.5 rounded-full bg-amber-500/20 z-10">
                                        <Lock className="h-3.5 w-3.5 text-amber-500" />
                                    </div>
                                </TooltipTrigger>
                                <TooltipContent side="top" className="text-xs">
                                    Click to add API key
                                </TooltipContent>
                            </Tooltip>
                        )}

                        {/* Action Buttons - Top Left for custom/installed models */}
                        {(isCustom || isInstalled) && (onEdit || onDelete) && (
                            <div className="absolute top-2 left-2 flex gap-1 z-10 opacity-0 group-hover:opacity-100 transition-all duration-200">
                                {onEdit && (
                                    <button
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            onEdit();
                                        }}
                                        className={cn(
                                            'p-1.5 rounded-full transition-all duration-200',
                                            'hover:bg-primary/20 hover:scale-110 active:scale-95'
                                        )}
                                        aria-label={
                                            isInstalled
                                                ? 'Edit installed model'
                                                : 'Edit custom model'
                                        }
                                    >
                                        <Pencil className="h-4 w-4 text-muted-foreground/60 hover:text-primary" />
                                    </button>
                                )}
                                {onDelete && (
                                    <button
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            onDelete();
                                        }}
                                        className={cn(
                                            'p-1.5 rounded-full transition-all duration-200',
                                            'hover:bg-destructive/20 hover:scale-110 active:scale-95'
                                        )}
                                        aria-label={
                                            isInstalled
                                                ? 'Delete installed model'
                                                : 'Delete custom model'
                                        }
                                    >
                                        <X className="h-4 w-4 text-muted-foreground/60 hover:text-destructive" />
                                    </button>
                                )}
                            </div>
                        )}

                        {/* Favorite Star - Top Right */}
                        <button
                            onClick={(e) => {
                                e.stopPropagation();
                                onToggleFavorite();
                            }}
                            className={cn(
                                'absolute top-2 right-2 p-1.5 rounded-full transition-all duration-200 z-10',
                                'hover:bg-yellow-500/20 hover:scale-110 active:scale-95',
                                'opacity-0 group-hover:opacity-100',
                                isFavorite && 'opacity-100'
                            )}
                            aria-label={isFavorite ? 'Remove from favorites' : 'Add to favorites'}
                        >
                            <Star
                                className={cn(
                                    'h-4 w-4 transition-all duration-200',
                                    isFavorite
                                        ? 'fill-yellow-400 text-yellow-400 drop-shadow-[0_0_3px_rgba(250,204,21,0.5)]'
                                        : 'text-muted-foreground/60 hover:text-yellow-400'
                                )}
                            />
                        </button>

                        {/* Provider Logo */}
                        <div
                            className={cn(
                                'flex items-center justify-center rounded-xl bg-muted/60 mb-1.5',
                                logoSizes[size].container
                            )}
                        >
                            {hasLogo(provider) ? (
                                <img
                                    src={PROVIDER_LOGOS[provider]}
                                    alt={`${provider} logo`}
                                    width={logoSizes[size].width}
                                    height={logoSizes[size].height}
                                    className={cn(
                                        'object-contain',
                                        needsDarkModeInversion(provider) &&
                                            'dark:invert dark:brightness-0 dark:contrast-200'
                                    )}
                                />
                            ) : (
                                <HelpCircle className="h-6 w-6 text-muted-foreground" />
                            )}
                        </div>

                        {/* Model Name */}
                        <div className="text-center flex-1 flex flex-col min-w-0 w-full">
                            <div
                                className={cn(
                                    'font-bold text-foreground leading-tight',
                                    size === 'sm' ? 'text-base' : 'text-lg'
                                )}
                            >
                                {providerName}
                            </div>
                            <div
                                className={cn(
                                    'text-muted-foreground leading-tight mt-0.5 line-clamp-3',
                                    size === 'sm' ? 'text-sm' : 'text-base'
                                )}
                            >
                                {modelName}
                            </div>
                            {suffix && (
                                <div className="text-xs text-primary/90 font-medium mt-1">
                                    ({suffix})
                                </div>
                            )}
                        </div>

                        {/* Capability Icons - fixed height to ensure consistent card layout */}
                        <div className="mt-auto pt-2 h-8 flex items-center justify-center">
                            <CapabilityIcons
                                supportedFileTypes={model.supportedFileTypes}
                                hasApiKey={hasApiKey}
                                showLockIcon={false}
                                size={size === 'sm' ? 'sm' : 'md'}
                            />
                        </div>
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
}

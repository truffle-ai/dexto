import React from 'react';
import { Sparkles, FlaskConical, Zap } from 'lucide-react';
import type { LLMProvider } from '@dexto/core';

// Provider logo file mapping - single source of truth
// Empty string means "use Bot icon fallback" in components
export const PROVIDER_LOGOS: Record<LLMProvider, string> = {
    openai: '/logos/openai.svg',
    anthropic: '/logos/claude-color.svg',
    google: '/logos/gemini-color.svg',
    groq: '/logos/groq.svg',
    xai: '/logos/grok.svg',
    'openai-compatible': '/logos/openai.svg',
    cohere: '/logos/cohere-color.svg',
    openrouter: '/logos/openrouter.svg',
    litellm: '/logos/litellm.svg',
    glama: '/logos/glama.svg',
    vertex: '/logos/gemini-color.svg', // Vertex AI uses Gemini logo (primary model family)
    bedrock: '/logos/aws-color.svg',
    local: '', // Uses Bot icon fallback - local GGUF models via node-llama-cpp
    ollama: '/logos/ollama.svg', // Ollama server
    dexto: '/logos/dexto/dexto_logo_icon.svg', // Dexto gateway - use Dexto logo
};

// Provider pricing URLs (for quick access from Model Picker)
export const PROVIDER_PRICING_URLS: Partial<Record<LLMProvider, string>> = {
    openai: 'https://platform.openai.com/docs/pricing',
    anthropic: 'https://www.anthropic.com/pricing#api',
    google: 'https://ai.google.dev/gemini-api/docs/pricing',
    groq: 'https://groq.com/pricing/',
    xai: 'https://docs.x.ai/docs/models',
    cohere: 'https://cohere.com/pricing',
    openrouter: 'https://openrouter.ai/models',
    litellm: 'https://docs.litellm.ai/',
    glama: 'https://glama.ai/',
    vertex: 'https://cloud.google.com/vertex-ai/generative-ai/pricing',
    bedrock: 'https://aws.amazon.com/bedrock/pricing/',
    // 'openai-compatible' intentionally omitted (varies by vendor)
};

// Helper: Format pricing from per‑million to per‑thousand tokens
export function formatPricingLines(pricing?: {
    inputPerM?: number;
    outputPerM?: number;
    cacheReadPerM?: number;
    cacheWritePerM?: number;
    currency?: 'USD';
    unit?: 'per_million_tokens';
}): string[] {
    if (!pricing) return [];
    // Bail early if required pricing fields are missing
    if (pricing.inputPerM == null || pricing.outputPerM == null) return [];
    const currency = pricing.currency || 'USD';
    const cur = currency === 'USD' ? '$' : '';
    const lines: string[] = [];
    lines.push(
        `Cost: ${cur}${pricing.inputPerM.toFixed(2)} in / ${cur}${pricing.outputPerM.toFixed(2)} out per 1M tokens`
    );
    if (pricing.cacheReadPerM != null) {
        lines.push(`Cache read: ${cur}${pricing.cacheReadPerM.toFixed(2)} per 1M tokens`);
    }
    if (pricing.cacheWritePerM != null) {
        lines.push(`Cache write: ${cur}${pricing.cacheWritePerM.toFixed(2)} per 1M tokens`);
    }
    return lines;
}

// Logos that have hardcoded colors and don't need dark mode inversion
export const COLORED_LOGOS: readonly LLMProvider[] = [
    'google',
    'cohere',
    'anthropic',
    'vertex',
    'dexto',
] as const;

// Helper to check if a logo needs dark mode inversion
export const needsDarkModeInversion = (provider: LLMProvider): boolean => {
    return !COLORED_LOGOS.includes(provider);
};

// Helper to check if a provider has a logo
export const hasLogo = (provider: LLMProvider): boolean => {
    return !!PROVIDER_LOGOS[provider];
};

// Model capability icons - sleek emojis for current capabilities
export const CAPABILITY_ICONS = {
    // File type capabilities (what we currently use)
    image: <span className="text-sm">🖼️</span>,
    audio: <span className="text-sm">🎵</span>,
    pdf: <span className="text-sm">📄</span>,

    // Other capabilities we currently have
    reasoning: <span className="text-sm">🧠</span>,
    experimental: (
        <FlaskConical className="h-3.5 w-3.5 text-muted-foreground hover:text-amber-500 transition-colors cursor-help" />
    ),
    new: (
        <Sparkles className="h-3.5 w-3.5 text-muted-foreground hover:text-yellow-500 transition-colors cursor-help" />
    ),
    realtime: (
        <Zap className="h-3.5 w-3.5 text-muted-foreground hover:text-blue-500 transition-colors cursor-help" />
    ),
};

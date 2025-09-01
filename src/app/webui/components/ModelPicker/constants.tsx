import React from 'react';
import { Eye, FileAudio, FileText, Brain, Image, Sparkles, FlaskConical, Zap } from "lucide-react";
import type { LLMProvider } from "../../../../core/llm/registry.js";

// Provider logo file mapping - single source of truth
export const PROVIDER_LOGOS: Record<LLMProvider, string> = {
  openai: "/logos/openai.svg",
  anthropic: "/logos/claude-color.svg",
  google: "/logos/gemini-color.svg",
  groq: "/logos/groq.svg",
  xai: "/logos/grok.svg",
  'openai-compatible': "/logos/openai.svg",
  cohere: "/logos/cohere-color.svg",
};

// Provider pricing URLs (for quick access from Model Picker)
export const PROVIDER_PRICING_URLS: Partial<Record<LLMProvider, string>> = {
  openai: "https://platform.openai.com/docs/pricing",
  anthropic: "https://www.anthropic.com/pricing#api",
  google: "https://ai.google.dev/gemini-api/docs/pricing",
  groq: "https://groq.com/pricing/",
  xai: "https://docs.x.ai/docs/models",
  cohere: "https://cohere.com/pricing",
  // 'openai-compatible' intentionally omitted (varies by vendor)
};

// Helper: Format pricing from per‑million to per‑thousand tokens
export function formatPricingLines(pricing?: {
  inputPerM: number;
  outputPerM: number;
  cacheReadPerM?: number;
  cacheWritePerM?: number;
  currency?: 'USD';
  unit?: 'per_million_tokens';
}): string[] {
  if (!pricing) return [];
  const currency = pricing.currency || 'USD';
  const cur = currency === 'USD' ? '$' : '';
  const lines: string[] = [];
  lines.push(`Cost: ${cur}${pricing.inputPerM.toFixed(2)} in / ${cur}${pricing.outputPerM.toFixed(2)} out per 1M tokens`);
  if (pricing.cacheReadPerM != null) {
    lines.push(`Cache read: ${cur}${pricing.cacheReadPerM.toFixed(2)} per 1M tokens`);
  }
  if (pricing.cacheWritePerM != null) {
    lines.push(`Cache write: ${cur}${pricing.cacheWritePerM.toFixed(2)} per 1M tokens`);
  }
  return lines;
}

// Logos that have hardcoded colors and don't need dark mode inversion
export const COLORED_LOGOS: readonly LLMProvider[] = ['google', 'cohere', 'anthropic'] as const;

// Helper to check if a logo needs dark mode inversion
export const needsDarkModeInversion = (provider: LLMProvider): boolean => {
  return !COLORED_LOGOS.includes(provider);
};

// Model capability icons - enhanced with better visual design
export const CAPABILITY_ICONS = {
  vision: <Eye className="h-3.5 w-3.5" />,
  image: (
    <div className="w-3.5 h-3.5 rounded-sm bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center">
      <Image className="h-2 w-2 text-white" />
    </div>
  ),
  audio: (
    <div className="w-3.5 h-3.5 rounded-sm bg-gradient-to-br from-green-500 to-emerald-600 flex items-center justify-center">
      <FileAudio className="h-2 w-2 text-white" />
    </div>
  ),
  pdf: (
    <div className="w-3.5 h-3.5 rounded-sm bg-gradient-to-br from-red-500 to-orange-600 flex items-center justify-center">
      <FileText className="h-2 w-2 text-white" />
    </div>
  ),
  reasoning: (
    <div className="w-3.5 h-3.5 rounded-sm bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center">
      <Brain className="h-2 w-2 text-white" />
    </div>
  ),
  experimental: <FlaskConical className="h-3.5 w-3.5 text-orange-500" />,
  new: <Sparkles className="h-3.5 w-3.5 text-yellow-500" />,
  realtime: <Zap className="h-3.5 w-3.5 text-blue-500" />,
};

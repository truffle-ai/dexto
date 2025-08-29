import React from 'react';
import { Eye, FileAudio, FileText, Brain, Image, Sparkles, FlaskConical, Zap } from "lucide-react";
import type { LLMProvider } from "../../../../core/llm/registry.js";

// Provider logo file mapping - single source of truth
export const PROVIDER_LOGOS: Record<LLMProvider, string> = {
  openai: "/logos/openai.svg",
  anthropic: "/logos/anthropic.svg",
  google: "/logos/gemini-color.svg",
  groq: "/logos/groq.svg",
  xai: "/logos/grok.svg",
  'openai-compatible': "/logos/openai.svg",
  cohere: "/logos/cohere-color.svg",
};

// Logos that have hardcoded colors and don't need dark mode inversion
export const COLORED_LOGOS: readonly LLMProvider[] = ['google', 'cohere'] as const;

// Helper to check if a logo needs dark mode inversion
export const needsDarkModeInversion = (provider: LLMProvider): boolean => {
  return !COLORED_LOGOS.includes(provider);
};

// Model capability icons - single source of truth
export const CAPABILITY_ICONS = {
  vision: <Eye className="h-3 w-3" />,
  image: <Image className="h-3 w-3" />,
  audio: <FileAudio className="h-3 w-3" />,
  pdf: <FileText className="h-3 w-3" />,
  reasoning: <Brain className="h-3 w-3" />,
  experimental: <FlaskConical className="h-3 w-3" />,
  new: <Sparkles className="h-3 w-3" />,
  realtime: <Zap className="h-3 w-3" />,
};
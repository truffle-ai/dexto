import type { LLMProvider } from './types.js';

/**
 * Product-level curated model IDs per provider.
 *
 * This is intentionally explicit (no heuristics) so we can control what shows up in
 * onboarding and default pickers without listing the entire registry.
 *
 * Notes:
 * - IDs must match `ModelInfo.name` in the registry for that provider.
 * - IDs are validated in tests to ensure they exist (so curated UI/onboarding doesn’t silently go empty).
 */
export const CURATED_MODEL_IDS_BY_PROVIDER: Partial<Record<LLMProvider, string[]>> = {
    openai: [
        'gpt-5.2',
        'gpt-5.2-chat-latest',
        'gpt-5.2-pro',
        'gpt-5.3-codex',
        'gpt-5.2-codex',
        'gpt-5',
        'gpt-5-mini',
        'gpt-4.1',
        'gpt-4.1-mini',
        'gpt-4o',
    ],
    anthropic: [
        'claude-opus-4-6-20260205',
        'claude-opus-4-5-20251101',
        'claude-sonnet-4-5-20250929',
        'claude-sonnet-4-20250514',
        'claude-haiku-4-5-20251001',
    ],
    google: [
        'gemini-3-pro-preview',
        'gemini-3-flash-preview',
        'gemini-2.5-pro',
        'gemini-2.5-flash',
    ],
    vertex: [
        'gemini-3-pro-preview',
        'gemini-3-flash-preview',
        'gemini-2.5-pro',
        'gemini-2.5-flash',
    ],
    xai: ['grok-4', 'grok-3', 'grok-3-mini'],
    groq: ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant', 'qwen-qwq-32b'],
    cohere: ['command-a-03-2025', 'command-r-plus-08-2024', 'command-r-08-2024'],
    minimax: ['MiniMax-M2.1', 'MiniMax-M2'],
    glm: ['glm-4.7', 'glm-4.5'],
    bedrock: [
        'anthropic.claude-sonnet-4-5-20250929-v1:0',
        'anthropic.claude-haiku-4-5-20251001-v1:0',
        'amazon.nova-pro-v1:0',
    ],
    'dexto-nova': [
        'anthropic/claude-haiku-4.5',
        'anthropic/claude-sonnet-4.5',
        'anthropic/claude-opus-4.5',
        'openai/gpt-5.2',
        'openai/gpt-5.2-codex',
        'google/gemini-3-pro-preview',
        'google/gemini-3-flash-preview',
        'qwen/qwen3-coder:free',
        'deepseek/deepseek-r1-0528:free',
        'z-ai/glm-4.7',
        'minimax/minimax-m2.1',
        'moonshotai/kimi-k2.5',
    ],
};

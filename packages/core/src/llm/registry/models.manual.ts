import type { LLMProvider, SupportedFileType } from '../types.js';
import type { ModelInfo } from './index.js';

type ManualModelInfo = Omit<ModelInfo, 'supportedFileTypes'> & {
    supportedFileTypes: SupportedFileType[];
};

/**
 * Manually-maintained registry entries for models that we want to support even when models.dev
 * doesn't include them (e.g., legacy IDs used in configs/tests).
 *
 * Keep this list small and intentional.
 */
export const MANUAL_MODELS_BY_PROVIDER = {
    openai: [
        {
            name: 'gpt-4o-audio-preview',
            displayName: 'GPT-4o Audio Preview',
            maxInputTokens: 128000,
            supportedFileTypes: ['audio'],
            pricing: {
                inputPerM: 2.5,
                outputPerM: 10.0,
                cacheReadPerM: 1.25,
                currency: 'USD',
                unit: 'per_million_tokens',
            },
        } satisfies ManualModelInfo,
    ],
    minimax: [
        {
            name: 'MiniMax-M2.1',
            displayName: 'MiniMax-M2.1',
            maxInputTokens: 204800,
            supportedFileTypes: [],
            reasoning: true,
            supportsTemperature: true,
            supportsToolCall: true,
            releaseDate: '2025-12-23',
            modalities: {
                input: ['text'],
                output: ['text'],
            },
            pricing: {
                inputPerM: 0.3,
                outputPerM: 1.2,
                currency: 'USD',
                unit: 'per_million_tokens',
            },
        } satisfies ManualModelInfo,
        {
            name: 'MiniMax-M2.7',
            displayName: 'MiniMax-M2.7',
            maxInputTokens: 204800,
            supportedFileTypes: [],
            reasoning: true,
            supportsTemperature: true,
            supportsToolCall: true,
            default: true,
            releaseDate: '2026-03-18',
            modalities: {
                input: ['text'],
                output: ['text'],
            },
            pricing: {
                inputPerM: 0.3,
                outputPerM: 1.2,
                cacheReadPerM: 0.03,
                cacheWritePerM: 0.375,
                currency: 'USD',
                unit: 'per_million_tokens',
            },
        } satisfies ManualModelInfo,
        {
            name: 'MiniMax-M2.7-highspeed',
            displayName: 'MiniMax-M2.7-highspeed',
            maxInputTokens: 204800,
            supportedFileTypes: [],
            reasoning: true,
            supportsTemperature: true,
            supportsToolCall: true,
            releaseDate: '2026-03-18',
            modalities: {
                input: ['text'],
                output: ['text'],
            },
            pricing: {
                inputPerM: 0.6,
                outputPerM: 2.4,
                cacheReadPerM: 0.06,
                cacheWritePerM: 0.375,
                currency: 'USD',
                unit: 'per_million_tokens',
            },
        } satisfies ManualModelInfo,
    ],
} satisfies Partial<Record<LLMProvider, ModelInfo[]>>;

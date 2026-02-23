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
} as Partial<Record<LLMProvider, ModelInfo[]>>;

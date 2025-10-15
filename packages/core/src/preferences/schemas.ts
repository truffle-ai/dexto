// packages/core/src/preferences/schemas.ts

import { z } from 'zod';
import { isValidProviderModel, getSupportedModels } from '@core/llm/registry.js';
import { LLM_PROVIDERS } from '@core/llm/types.js';
import { NonEmptyTrimmed } from '@core/utils/result.js';
import { PreferenceErrorCode } from './error-codes.js';
import { ErrorScope, ErrorType } from '@core/errors/types.js';

export const PreferenceLLMSchema = z
    .object({
        provider: z.enum(LLM_PROVIDERS).describe('LLM provider (openai, anthropic, google, etc.)'),

        model: NonEmptyTrimmed.optional().describe('Model name for the provider'),

        apiKey: z
            .string()
            .regex(
                /^\$[A-Z_][A-Z0-9_]*$/,
                'Must be environment variable reference (e.g., $OPENAI_API_KEY)'
            )
            .describe('Environment variable reference for API key'),

        baseURL: z
            .string()
            .url()
            .optional()
            .describe('Base URL for API requests (required for openai-compatible provider)'),
    })
    .strict()
    .superRefine((data, ctx) => {
        const modelProvided = typeof data.model === 'string' && data.model.length > 0;

        // Allow model to be omitted for OpenRouter and Dexto (OpenRouter-compatible)
        // Model will fall back to agent-specific configuration
        if (data.provider !== 'openrouter' && data.provider !== 'dexto' && !modelProvided) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                path: ['model'],
                message: `Provider '${data.provider}' requires a model to be specified`,
                params: {
                    code: PreferenceErrorCode.MODEL_INCOMPATIBLE,
                    scope: ErrorScope.PREFERENCE,
                    type: ErrorType.USER,
                },
            });
            return;
        }

        if (modelProvided && !isValidProviderModel(data.provider, data.model!)) {
            const supportedModels = getSupportedModels(data.provider);
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                path: ['model'],
                message: `Model '${data.model}' is not supported by provider '${data.provider}'. Supported models: ${supportedModels.join(', ')}`,
                params: {
                    code: PreferenceErrorCode.MODEL_INCOMPATIBLE,
                    scope: ErrorScope.PREFERENCE,
                    type: ErrorType.USER,
                },
            });
        }

        // Validate baseURL is provided for openai-compatible provider
        if (data.provider === 'openai-compatible' && !data.baseURL) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                path: ['baseURL'],
                message: `Provider 'openai-compatible' requires a 'baseURL' to be specified`,
                params: {
                    code: PreferenceErrorCode.MISSING_BASE_URL,
                    scope: ErrorScope.PREFERENCE,
                    type: ErrorType.USER,
                },
            });
        }
    });

export const PreferenceDefaultsSchema = z
    .object({
        defaultAgent: z
            .string()
            .min(1)
            .describe('Default agent name for global CLI usage (required)'),
    })
    .strict();

export const PreferenceSetupSchema = z
    .object({
        completed: z.boolean().default(false).describe('Whether initial setup has been completed'),
    })
    .strict();

export const GlobalPreferencesSchema = z
    .object({
        llm: PreferenceLLMSchema.describe('LLM configuration preferences'),

        defaults: PreferenceDefaultsSchema.describe('Default behavior preferences (required)'),

        setup: PreferenceSetupSchema.default({ completed: false }).describe(
            'Setup completion tracking'
        ),
    })
    .strict();

// Output types
export type PreferenceLLM = z.output<typeof PreferenceLLMSchema>;
export type PreferenceDefaults = z.output<typeof PreferenceDefaultsSchema>;
export type PreferenceSetup = z.output<typeof PreferenceSetupSchema>;
export type GlobalPreferences = z.output<typeof GlobalPreferencesSchema>;

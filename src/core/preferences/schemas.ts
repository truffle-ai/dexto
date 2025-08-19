// src/core/preferences/schemas.ts

import { z } from 'zod';
import { LLM_PROVIDERS, isValidProviderModel } from '@core/llm/registry.js';
import { NonEmptyTrimmed } from '@core/utils/result.js';
import { PreferenceErrorCode } from './error-codes.js';
import { ErrorScope, ErrorType } from '@core/errors/types.js';

export const PreferenceLLMSchema = z
    .object({
        provider: z.enum(LLM_PROVIDERS).describe('LLM provider (openai, anthropic, google, etc.)'),

        model: NonEmptyTrimmed.describe('Model name for the provider'),

        apiKey: z
            .string()
            .regex(
                /^\$[A-Z_][A-Z0-9_]*$/,
                'Must be environment variable reference (e.g., $OPENAI_API_KEY)'
            )
            .describe('Environment variable reference for API key'),
    })
    .strict()
    .refine((data) => isValidProviderModel(data.provider, data.model), {
        message: 'Model is not compatible with the specified provider',
        path: ['model'], // Point error to model field
        params: {
            code: PreferenceErrorCode.MODEL_INCOMPATIBLE,
            scope: ErrorScope.PREFERENCE,
            type: ErrorType.USER,
        },
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

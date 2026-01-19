// packages/agent-management/src/preferences/schemas.ts

import { z } from 'zod';
import {
    isValidProviderModel,
    getSupportedModels,
    acceptsAnyModel,
    supportsCustomModels,
    supportsBaseURL,
} from '@dexto/core';
import { LLM_PROVIDERS } from '@dexto/core';
import { NonEmptyTrimmed } from '@dexto/core';
import { PreferenceErrorCode } from './error-codes.js';
import { ErrorType } from '@dexto/core';

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
            .optional()
            .describe(
                'Environment variable reference for API key (optional for local providers like Ollama)'
            ),

        baseURL: z
            .string()
            .url('Must be a valid URL (e.g., http://localhost:11434/v1)')
            .optional()
            .describe('Custom base URL for providers that support it (openai-compatible, litellm)'),

        reasoningEffort: z
            .enum(['none', 'minimal', 'low', 'medium', 'high', 'xhigh'])
            .optional()
            .describe(
                'Reasoning effort level for OpenAI reasoning models (o1, o3, codex, gpt-5.x). Auto-detected if not set.'
            ),
    })
    .strict()
    .superRefine((data, ctx) => {
        // NOTE: API key validation is intentionally NOT done here to allow saving
        // incomplete preferences. Users should be able to skip API key setup and
        // configure it later. The apiKeyPending flag in setup tracks this state.
        // Runtime validation happens when actually trying to use the LLM.

        // Skip model validation for providers that accept any model or support custom models
        const skipModelValidation =
            acceptsAnyModel(data.provider) || supportsCustomModels(data.provider);

        if (!skipModelValidation && !isValidProviderModel(data.provider, data.model)) {
            const supportedModels = getSupportedModels(data.provider);
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                path: ['model'],
                message: `Model '${data.model}' is not supported by provider '${data.provider}'. Supported models: ${supportedModels.join(', ')}`,
                params: {
                    code: PreferenceErrorCode.MODEL_INCOMPATIBLE,
                    scope: 'preference',
                    type: ErrorType.USER,
                },
            });
        }

        // Validate baseURL format if provided (but don't require it - allow incomplete setup)
        if (data.baseURL && !supportsBaseURL(data.provider)) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                path: ['baseURL'],
                message: `Provider '${data.provider}' does not support custom baseURL. Use 'openai-compatible' for custom endpoints.`,
                params: {
                    code: PreferenceErrorCode.INVALID_PREFERENCE_VALUE,
                    scope: 'preference',
                    type: ErrorType.USER,
                },
            });
        }
        // NOTE: baseURL requirement validation also relaxed - allow saving without baseURL
        // and let runtime validation catch missing baseURL when actually trying to connect.
    });

export const PreferenceDefaultsSchema = z
    .object({
        defaultAgent: z
            .string()
            .min(1)
            .describe('Default agent name for global CLI usage (required)'),

        defaultMode: z
            .enum(['cli', 'web', 'server', 'discord', 'telegram', 'mcp'])
            .default('web')
            .describe('Default run mode when --mode flag is not specified (default: web)'),
    })
    .strict();

export const PreferenceSetupSchema = z
    .object({
        completed: z.boolean().default(false).describe('Whether initial setup has been completed'),
        apiKeyPending: z
            .boolean()
            .default(false)
            .describe('Whether API key setup was skipped and needs to be configured later'),
        baseURLPending: z
            .boolean()
            .default(false)
            .describe('Whether baseURL setup was skipped and needs to be configured later'),
    })
    .strict();

export const PreferenceSoundsSchema = z
    .object({
        enabled: z.boolean().default(true).describe('Enable sound notifications (default: true)'),
        onApprovalRequired: z
            .boolean()
            .default(true)
            .describe(
                'Play sound when tool approval is required (default: true when sounds enabled)'
            ),
        onTaskComplete: z
            .boolean()
            .default(true)
            .describe('Play sound when agent task completes (default: true when sounds enabled)'),
    })
    .strict();

export const GlobalPreferencesSchema = z
    .object({
        llm: PreferenceLLMSchema.describe('LLM configuration preferences'),

        defaults: PreferenceDefaultsSchema.describe('Default behavior preferences (required)'),

        setup: PreferenceSetupSchema.default({ completed: false }).describe(
            'Setup completion tracking'
        ),

        sounds: PreferenceSoundsSchema.optional().describe(
            'Sound notification preferences (optional)'
        ),
    })
    .strict();

// Output types
export type PreferenceLLM = z.output<typeof PreferenceLLMSchema>;
export type PreferenceDefaults = z.output<typeof PreferenceDefaultsSchema>;
export type PreferenceSetup = z.output<typeof PreferenceSetupSchema>;
export type PreferenceSounds = z.output<typeof PreferenceSoundsSchema>;
export type GlobalPreferences = z.output<typeof GlobalPreferencesSchema>;

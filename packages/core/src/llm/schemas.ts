import { LLMErrorCode } from './error-codes.js';
import { ErrorScope, ErrorType } from '@core/errors/types.js';
import { DextoRuntimeError } from '@core/errors/index.js';
import { NonEmptyTrimmed, EnvExpandedString, OptionalURL } from '@core/utils/result.js';
import { getPrimaryApiKeyEnvVar } from '@core/utils/api-key-resolver.js';
import { z } from 'zod';
import {
    supportsBaseURL,
    requiresBaseURL,
    acceptsAnyModel,
    getSupportedModels,
    isValidProviderModel,
    getMaxInputTokensForModel,
} from './registry.js';
import { LLM_PROVIDERS } from './types.js';

/**
 * Default-free field definitions for LLM configuration.
 * Used to build both the full config schema (with defaults) and the updates schema (no defaults).
 */
const LLMConfigFields = {
    provider: z
        .enum(LLM_PROVIDERS)
        .describe("LLM provider (e.g., 'openai', 'anthropic', 'google', 'groq')"),

    model: NonEmptyTrimmed.describe('Specific model name for the selected provider'),

    // Expand $ENV refs and trim; final validation happens with provider context
    apiKey: EnvExpandedString().describe(
        'API key for provider; can be given directly or via $ENV reference'
    ),

    maxIterations: z.coerce.number().int().positive().describe('Max iterations for agentic loops'),

    baseURL: OptionalURL.describe(
        'Base URL for provider (e.g., https://api.openai.com/v1). Only certain providers support this.'
    ),

    maxInputTokens: z.coerce
        .number()
        .int()
        .positive()
        .optional()
        .describe('Max input tokens for history; required for unknown models'),

    maxOutputTokens: z.coerce
        .number()
        .int()
        .positive()
        .optional()
        .describe('Max tokens for model output'),

    temperature: z.coerce
        .number()
        .min(0)
        .max(1)
        .optional()
        .describe('Randomness: 0 deterministic, 1 creative'),

    allowedMediaTypes: z
        .array(z.string())
        .optional()
        .describe(
            'MIME type patterns for media expansion (e.g., "image/*", "application/pdf"). ' +
                'If omitted, uses model capabilities from registry. Supports wildcards.'
        ),
} as const;
/** Business rules + compatibility checks */

// Base LLM config object schema (before validation/branding) - can be extended
export const LLMConfigBaseSchema = z
    .object({
        provider: LLMConfigFields.provider,
        model: LLMConfigFields.model,
        apiKey: LLMConfigFields.apiKey,
        // Apply defaults only for complete config validation
        maxIterations: z.coerce.number().int().positive().default(50),
        baseURL: LLMConfigFields.baseURL,
        maxInputTokens: LLMConfigFields.maxInputTokens,
        maxOutputTokens: LLMConfigFields.maxOutputTokens,
        temperature: LLMConfigFields.temperature,
        allowedMediaTypes: LLMConfigFields.allowedMediaTypes,
    })
    .strict();

export const LLMConfigSchema = LLMConfigBaseSchema.superRefine((data, ctx) => {
    const baseURLIsSet = data.baseURL != null && data.baseURL.trim() !== '';
    const maxInputTokensIsSet = data.maxInputTokens != null;

    // API key validation with provider context
    if (!data.apiKey?.trim()) {
        const primaryVar = getPrimaryApiKeyEnvVar(data.provider);
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['apiKey'],
            message: `Missing API key for provider '${data.provider}' – set $${primaryVar}`,
            params: {
                code: LLMErrorCode.API_KEY_MISSING,
                scope: ErrorScope.LLM,
                type: ErrorType.USER,
                provider: data.provider,
                envVar: primaryVar,
            },
        });
    }

    if (baseURLIsSet) {
        if (!supportsBaseURL(data.provider)) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                path: ['provider'],
                message:
                    `Provider '${data.provider}' does not support baseURL. ` +
                    `Use an 'openai-compatible' provider if you need a custom base URL.`,
                params: {
                    code: LLMErrorCode.BASE_URL_INVALID,
                    scope: ErrorScope.LLM,
                    type: ErrorType.USER,
                },
            });
        }
    } else if (requiresBaseURL(data.provider)) {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['baseURL'],
            message: `Provider '${data.provider}' requires a 'baseURL'.`,
            params: {
                code: LLMErrorCode.BASE_URL_MISSING,
                scope: ErrorScope.LLM,
                type: ErrorType.USER,
            },
        });
    } else {
        if (!acceptsAnyModel(data.provider)) {
            const supportedModelsList = getSupportedModels(data.provider);
            if (!isValidProviderModel(data.provider, data.model)) {
                ctx.addIssue({
                    code: z.ZodIssueCode.custom,
                    path: ['model'],
                    message:
                        `Model '${data.model}' is not supported for provider '${data.provider}'. ` +
                        `Supported: ${supportedModelsList.join(', ')}`,
                    params: {
                        code: LLMErrorCode.MODEL_INCOMPATIBLE,
                        scope: ErrorScope.LLM,
                        type: ErrorType.USER,
                    },
                });
            }
        }

        if (maxInputTokensIsSet && !acceptsAnyModel(data.provider)) {
            try {
                const cap = getMaxInputTokensForModel(data.provider, data.model);
                if (data.maxInputTokens! > cap) {
                    ctx.addIssue({
                        code: z.ZodIssueCode.custom,
                        path: ['maxInputTokens'],
                        message:
                            `Max input tokens for model '${data.model}' is ${cap}. ` +
                            `You provided ${data.maxInputTokens}`,
                        params: {
                            code: LLMErrorCode.TOKENS_EXCEEDED,
                            scope: ErrorScope.LLM,
                            type: ErrorType.USER,
                        },
                    });
                }
            } catch (error: unknown) {
                if (
                    error instanceof DextoRuntimeError &&
                    error.code === LLMErrorCode.MODEL_UNKNOWN
                ) {
                    // Model not found in registry
                    ctx.addIssue({
                        code: z.ZodIssueCode.custom,
                        path: ['model'],
                        message: error.message,
                        params: {
                            code: error.code,
                            scope: error.scope,
                            type: error.type,
                        },
                    });
                } else {
                    // Unexpected error
                    const message =
                        error instanceof Error ? error.message : 'Unknown error occurred';
                    ctx.addIssue({
                        code: z.ZodIssueCode.custom,
                        path: ['model'],
                        message,
                        params: {
                            code: LLMErrorCode.REQUEST_INVALID_SCHEMA,
                            scope: ErrorScope.LLM,
                            type: ErrorType.SYSTEM,
                        },
                    });
                }
            }
        }
    }
    // Note: OpenRouter model validation happens in resolver.ts during switchLLM only
    // to avoid network calls during startup/serverless cold starts
}) // Brand the validated type so it can be distinguished at compile time
    .brand<'ValidatedLLMConfig'>();
// Input type and output types for the zod schema

export type LLMConfig = z.input<typeof LLMConfigSchema>;
export type ValidatedLLMConfig = z.output<typeof LLMConfigSchema>;
// PATCH-like schema for updates (switch flows)

// TODO: when moving to zod v4 we might be able to set this as strict
export const LLMUpdatesSchema = z
    .object({ ...LLMConfigFields })
    .partial()
    .superRefine((data, ctx) => {
        // Require at least one meaningful change field: model or provider
        if (!data.model && !data.provider) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: 'At least model or provider must be specified for LLM switch',
                path: [],
            });
        }
    });
export type LLMUpdates = z.input<typeof LLMUpdatesSchema>;
// Re-export context type from llm module
export type { LLMUpdateContext } from '../llm/types.js';

import { LLMErrorCode } from './error-codes.js';
import { ErrorScope, ErrorType } from '../errors/types.js';
import { DextoRuntimeError } from '../errors/index.js';
import { NonEmptyTrimmed, EnvExpandedString, OptionalURL } from '../utils/result.js';
import { z } from 'zod';
import {
    supportsBaseURL,
    acceptsAnyModel,
    supportsCustomModels,
    hasAllRegistryModelsSupport,
    getSupportedModels,
    isValidProviderModel,
    getMaxInputTokensForModel,
} from './registry/index.js';
import { LLM_PROVIDERS } from './types.js';

/**
 * Default maximum number of outer-loop iterations (tool-call steps) per agent turn.
 *
 * This is a safety guard against runaway tool loops.
 */
export const DEFAULT_MAX_ITERATIONS = 50;

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
    // Optional for providers that don't need API keys (Ollama, vLLM, etc.)
    apiKey: EnvExpandedString()
        .optional()
        .describe('API key for provider; can be given directly or via $ENV reference'),

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

    // Provider-specific options

    /**
     * OpenAI reasoning effort level for reasoning-capable models (o1, o3, codex, gpt-5.x).
     * Controls how many reasoning tokens the model generates before producing a response.
     * - 'none': No reasoning, fastest responses
     * - 'minimal': Barely any reasoning, very fast responses
     * - 'low': Light reasoning, fast responses
     * - 'medium': Balanced reasoning (OpenAI's recommended daily driver)
     * - 'high': Thorough reasoning for complex tasks
     * - 'xhigh': Extra high reasoning for quality-critical, non-latency-sensitive tasks
     */
    reasoningEffort: z
        .enum(['none', 'minimal', 'low', 'medium', 'high', 'xhigh'])
        .optional()
        .describe(
            'OpenAI reasoning effort level for reasoning models (o1, o3, codex). ' +
                "Options: 'none', 'minimal', 'low', 'medium' (recommended), 'high', 'xhigh'"
        ),
} as const;
/** Business rules + compatibility checks */

// Base LLM config object schema (before validation/branding) - can be extended
export const LLMConfigBaseSchema = z
    .object({
        provider: LLMConfigFields.provider,
        model: LLMConfigFields.model,
        // apiKey is optional at schema level - validated based on provider in superRefine
        apiKey: LLMConfigFields.apiKey,
        maxIterations: z.coerce
            .number()
            .int()
            .positive()
            .default(DEFAULT_MAX_ITERATIONS)
            .describe('Max outer-loop tool-call iterations per agent turn'),
        baseURL: LLMConfigFields.baseURL,
        maxInputTokens: LLMConfigFields.maxInputTokens,
        maxOutputTokens: LLMConfigFields.maxOutputTokens,
        temperature: LLMConfigFields.temperature,
        allowedMediaTypes: LLMConfigFields.allowedMediaTypes,
        // Provider-specific options
        reasoningEffort: LLMConfigFields.reasoningEffort,
    })
    .strict();

/**
 * LLM config schema.
 *
 * Notes:
 * - API keys and base URLs are validated at runtime (when creating a provider client), not at parse time.
 * - This keeps programmatic construction (code-first DI) ergonomic: you can omit credentials and rely on env.
 */
export const LLMConfigSchema = LLMConfigBaseSchema.superRefine((data, ctx) => {
    const baseURLIsSet = data.baseURL != null && data.baseURL.trim() !== '';
    const maxInputTokensIsSet = data.maxInputTokens != null;

    // Gateway providers require OpenRouter-format model IDs ("provider/model").
    // This avoids implicit transformation and makes the config unambiguous.
    if (hasAllRegistryModelsSupport(data.provider) && !data.model.includes('/')) {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['model'],
            message:
                `Provider '${data.provider}' requires OpenRouter-format model IDs (e.g. ` +
                `'openai/gpt-5-mini' or 'anthropic/claude-sonnet-4.5'). You provided '${data.model}'.`,
            params: {
                code: LLMErrorCode.MODEL_INCOMPATIBLE,
                scope: ErrorScope.LLM,
                type: ErrorType.USER,
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
    }

    // Model and token validation
    if (!baseURLIsSet || supportsBaseURL(data.provider)) {
        // Skip model validation for providers that accept any model OR support custom models
        if (!acceptsAnyModel(data.provider) && !supportsCustomModels(data.provider)) {
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

        // Skip token cap validation for providers that accept any model OR support custom models
        if (
            maxInputTokensIsSet &&
            !acceptsAnyModel(data.provider) &&
            !supportsCustomModels(data.provider)
        ) {
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
});

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

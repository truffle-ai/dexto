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
    supportsCustomModels,
    getSupportedModels,
    isValidProviderModel,
    getMaxInputTokensForModel,
    requiresApiKey,
} from './registry.js';
import { LLM_PROVIDERS } from './types.js';

/**
 * Options for LLM config validation
 */
export interface LLMValidationOptions {
    /**
     * When true, enforces API key and baseURL requirements.
     * When false (relaxed mode), allows missing API keys/baseURLs for interactive configuration.
     *
     * Use strict mode for:
     * - Server/API mode (headless, needs full config)
     * - MCP mode (headless)
     *
     * Use relaxed mode for:
     * - Web UI (user can configure via settings)
     * - CLI (user can configure interactively)
     *
     * @default true
     */
    strict?: boolean;
}

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
        // Apply defaults only for complete config validation
        maxIterations: z.coerce.number().int().positive().optional(),
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
 * Creates an LLM config schema with configurable validation strictness.
 *
 * @param options.strict - When true (default), enforces API key and baseURL requirements.
 *                         When false, allows missing credentials for interactive configuration.
 */
export function createLLMConfigSchema(options: LLMValidationOptions = {}) {
    const { strict = true } = options;

    return LLMConfigBaseSchema.superRefine((data, ctx) => {
        const baseURLIsSet = data.baseURL != null && data.baseURL.trim() !== '';
        const maxInputTokensIsSet = data.maxInputTokens != null;

        // API key validation with provider context
        // In relaxed mode, skip API key validation to allow launching app for interactive config
        // Skip validation for providers that don't require API keys:
        // - openai-compatible: local providers like Ollama, vLLM, LocalAI
        // - litellm: self-hosted proxy handles auth internally
        // - vertex: uses Google Cloud ADC
        // - bedrock: uses AWS credentials
        if (strict && requiresApiKey(data.provider) && !data.apiKey?.trim()) {
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
        } else if (strict && requiresBaseURL(data.provider)) {
            // In relaxed mode, skip baseURL requirement validation
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
        }

        // Model and token validation always runs (not affected by strict mode)
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
    }) // Brand the validated type so it can be distinguished at compile time
        .brand<'ValidatedLLMConfig'>();
}

/**
 * Default LLM config schema with strict validation (backwards compatible).
 * Use createLLMConfigSchema({ strict: false }) for relaxed validation.
 */
export const LLMConfigSchema = createLLMConfigSchema({ strict: true });

/**
 * Relaxed LLM config schema that allows missing API keys and baseURLs.
 * Use this for interactive modes (CLI, WebUI) where users can configure later.
 */
export const LLMConfigSchemaRelaxed = createLLMConfigSchema({ strict: false });

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

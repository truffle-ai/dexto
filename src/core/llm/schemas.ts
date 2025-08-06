import { LLMErrorCode } from './error-codes.js';
import { ErrorScope, ErrorType } from '@core/errors/types.js';
import { NonEmptyTrimmed, EnvExpandedString, OptionalURL } from '@core/utils/result.js';
import { getPrimaryApiKeyEnvVar } from '@core/utils/api-key-resolver.js';
import { z } from 'zod';
import {
    LLM_PROVIDERS,
    LLM_ROUTERS,
    supportsBaseURL,
    requiresBaseURL,
    acceptsAnyModel,
    getSupportedModels,
    isValidProviderModel,
    getMaxInputTokensForModel,
    isRouterSupportedForProvider,
    getSupportedRoutersForProvider,
} from './registry.js';

/** Core object with structural constraints and normalization */

export const LLMConfigBaseSchema = z
    .object({
        provider: z
            .enum(LLM_PROVIDERS)
            .describe("LLM provider (e.g., 'openai', 'anthropic', 'google', 'groq')"),

        model: NonEmptyTrimmed.describe('Specific model name for the selected provider'),

        // Expand $ENV refs and trim; validation moved to superRefine with provider context
        apiKey: EnvExpandedString().describe(
            'API key for provider; can be given directly or via $ENV reference'
        ),

        maxIterations: z.coerce
            .number()
            .int()
            .positive()
            .default(50)
            .describe('Max iterations for agentic loops, default 50'),

        router: z
            .enum(LLM_ROUTERS)
            .default('vercel')
            .describe('Router to use (vercel | in-built), default vercel'),

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
    })
    .strict();
/** Business rules + compatibility checks */

export const LLMConfigSchema = LLMConfigBaseSchema.superRefine((data, ctx) => {
    const baseURLIsSet = data.baseURL != null && data.baseURL.trim() !== '';
    const maxInputTokensIsSet = data.maxInputTokens != null;

    // API key validation with provider context
    if (!data.apiKey?.trim()) {
        const primaryVar = getPrimaryApiKeyEnvVar(data.provider);
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['apiKey'],
            message: `Missing API key for provider '${data.provider}' – set ${primaryVar} or pass --api-key`,
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
                // TODO: improve this
                const e = error as { name?: string; message?: string };
                const isUnknownModelError = e?.name === 'UnknownModelError';
                ctx.addIssue({
                    code: z.ZodIssueCode.custom,
                    path: ['model'],
                    message: e?.message ?? 'Unknown provider/model',
                    params: {
                        code: isUnknownModelError
                            ? LLMErrorCode.MODEL_UNKNOWN
                            : LLMErrorCode.REQUEST_INVALID_SCHEMA,
                        scope: ErrorScope.LLM,
                        type: ErrorType.USER,
                    },
                });
            }
        }
    }

    if (!isRouterSupportedForProvider(data.provider, data.router)) {
        const supportedRouters = getSupportedRoutersForProvider(data.provider);
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['router'],
            message:
                `Provider '${data.provider}' does not support router '${data.router}'. ` +
                `Supported: ${supportedRouters.join(', ')}`,
            params: {
                code: LLMErrorCode.ROUTER_UNSUPPORTED,
                scope: ErrorScope.LLM,
                type: ErrorType.USER,
            },
        });
    }
}) // Brand the validated type so it can be distinguished at compile time
    .brand<'ValidatedLLMConfig'>();
// Input type and output types for the zod schema

export type LLMConfig = z.input<typeof LLMConfigSchema>;
export type ValidatedLLMConfig = z.output<typeof LLMConfigSchema>;
// PATCH-like schema for updates (switch flows)

export const LLMUpdatesSchema = LLMConfigBaseSchema.partial().strict();
export type LLMUpdates = z.input<typeof LLMUpdatesSchema>;
// Re-export context type from llm module
export type { LLMUpdateContext } from '../llm/types.js';

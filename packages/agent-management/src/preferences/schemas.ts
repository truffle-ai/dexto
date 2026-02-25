// packages/agent-management/src/preferences/schemas.ts

import { z } from 'zod';
import {
    isValidProviderModel,
    getSupportedModels,
    acceptsAnyModel,
    supportsCustomModels,
    supportsBaseURL,
    getReasoningProfile,
    supportsReasoningVariant,
    LLM_PROVIDERS,
    NonEmptyTrimmed,
    ErrorType,
} from '@dexto/core';
import { PreferenceErrorCode } from './error-codes.js';

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

        reasoning: z
            .object({
                variant: z
                    .string()
                    .trim()
                    .min(1)
                    .describe(
                        'Reasoning variant. Use a model/provider-native variant from the active reasoning profile.'
                    ),
                budgetTokens: z
                    .number()
                    .int()
                    .positive()
                    .optional()
                    .describe(
                        'Advanced escape hatch for budget-based providers (e.g., Anthropic/Gemini/Bedrock/OpenRouter).'
                    ),
            })
            .strict()
            .optional()
            .describe('Reasoning configuration (tuning only; display is controlled separately).'),
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

        if (data.reasoning) {
            const profile = getReasoningProfile(data.provider, data.model);
            const variant = data.reasoning.variant;
            const budgetTokens = data.reasoning.budgetTokens;

            if (!supportsReasoningVariant(profile, variant)) {
                ctx.addIssue({
                    code: z.ZodIssueCode.custom,
                    path: ['reasoning', 'variant'],
                    message:
                        `Reasoning variant '${variant}' is not supported for provider '${data.provider}' ` +
                        `model '${data.model}'. Supported: ${profile.variants.map((entry) => entry.id).join(', ')}`,
                    params: {
                        code: PreferenceErrorCode.INVALID_PREFERENCE_VALUE,
                        scope: 'preference',
                        type: ErrorType.USER,
                    },
                });
            }

            if (typeof budgetTokens === 'number' && !profile.supportsBudgetTokens) {
                ctx.addIssue({
                    code: z.ZodIssueCode.custom,
                    path: ['reasoning', 'budgetTokens'],
                    message:
                        `Reasoning budgetTokens are not supported for provider '${data.provider}' ` +
                        `model '${data.model}'. Remove reasoning.budgetTokens to use provider defaults.`,
                    params: {
                        code: PreferenceErrorCode.INVALID_PREFERENCE_VALUE,
                        scope: 'preference',
                        type: ErrorType.USER,
                    },
                });
            }
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
        onStartup: z
            .boolean()
            .default(false)
            .describe('Play sound when the interactive CLI starts (default: false)'),
        startupSoundFile: z
            .string()
            .min(1)
            .optional()
            .describe('Startup sound file path relative to ~/.dexto/sounds (optional)'),
        onApprovalRequired: z
            .boolean()
            .default(true)
            .describe(
                'Play sound when tool approval is required (default: true when sounds enabled)'
            ),
        approvalSoundFile: z
            .string()
            .min(1)
            .optional()
            .describe('Approval sound file path relative to ~/.dexto/sounds (optional)'),
        onTaskComplete: z
            .boolean()
            .default(true)
            .describe('Play sound when agent task completes (default: true when sounds enabled)'),
        completeSoundFile: z
            .string()
            .min(1)
            .optional()
            .describe('Completion sound file path relative to ~/.dexto/sounds (optional)'),
    })
    .strict();

export const AgentToolPreferencesSchema = z
    .object({
        disabled: z
            .array(NonEmptyTrimmed)
            .default([])
            .describe('Tool names disabled for this agent (default: none)'),
    })
    .strict();

export const AgentPreferencesSchema = z
    .object({
        tools: AgentToolPreferencesSchema.default({ disabled: [] }).describe(
            'Tool availability preferences'
        ),
    })
    .strict();

export const GlobalPreferencesSchema = z
    .object({
        llm: PreferenceLLMSchema.describe('LLM configuration preferences'),

        defaults: PreferenceDefaultsSchema.describe('Default behavior preferences (required)'),

        setup: PreferenceSetupSchema.default({ completed: false }).describe(
            'Setup completion tracking'
        ),

        sounds: PreferenceSoundsSchema.default({}).describe(
            'Sound notification preferences (defaults applied for legacy preferences)'
        ),
    })
    .strict();

// Output types
export type PreferenceLLM = z.output<typeof PreferenceLLMSchema>;
export type PreferenceDefaults = z.output<typeof PreferenceDefaultsSchema>;
export type PreferenceSetup = z.output<typeof PreferenceSetupSchema>;
export type PreferenceSounds = z.output<typeof PreferenceSoundsSchema>;
export type AgentToolPreferences = z.output<typeof AgentToolPreferencesSchema>;
export type AgentPreferences = z.output<typeof AgentPreferencesSchema>;
export type GlobalPreferences = z.output<typeof GlobalPreferencesSchema>;

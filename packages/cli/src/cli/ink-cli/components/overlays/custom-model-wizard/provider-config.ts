/**
 * Provider configuration registry for the CustomModelWizard.
 * Each provider has its own config with display name, description, steps, and model builder.
 */

import type { CustomModel, CustomModelProvider } from '@dexto/agent-management';
import { CUSTOM_MODEL_PROVIDERS } from '@dexto/agent-management';
import { lookupOpenRouterModel, refreshOpenRouterModelCache } from '@dexto/core';
import type { ProviderConfig, WizardStep } from './types.js';
import { validators } from './types.js';

/**
 * Common API key step - reused across providers that support API keys.
 */
const API_KEY_STEP: WizardStep = {
    field: 'apiKey',
    label: 'API Key (optional)',
    placeholder: 'Enter API key for authentication',
    required: false,
};

/**
 * Common max input tokens step - reused across providers that support it.
 */
const MAX_INPUT_TOKENS_STEP: WizardStep = {
    field: 'maxInputTokens',
    label: 'Max Input Tokens (optional)',
    placeholder: 'e.g., 128000 (leave blank for default)',
    required: false,
    validate: validators.positiveNumber,
};

/**
 * Common display name step.
 */
const DISPLAY_NAME_STEP: WizardStep = {
    field: 'displayName',
    label: 'Display Name (optional)',
    placeholder: 'e.g., My Custom Model',
    required: false,
};

/**
 * Provider configuration registry.
 * Keys are CustomModelProvider values.
 */
export const PROVIDER_CONFIGS: Record<CustomModelProvider, ProviderConfig> = {
    'openai-compatible': {
        displayName: 'OpenAI-Compatible',
        description: 'Custom or self-hosted endpoints (vLLM, LM Studio)',
        steps: [
            {
                field: 'name',
                label: 'Model Name',
                placeholder: 'e.g., llama-3-70b, mixtral-8x7b',
                required: true,
                validate: validators.required('Model name'),
            },
            {
                field: 'baseURL',
                label: 'API Base URL',
                placeholder: 'e.g., http://localhost:11434/v1',
                required: true,
                validate: validators.url,
            },
            { ...DISPLAY_NAME_STEP, placeholder: 'e.g., My Local Llama 3' },
            MAX_INPUT_TOKENS_STEP,
            API_KEY_STEP,
        ],
        buildModel: (values, provider) => {
            const model: CustomModel = {
                name: values.name || '',
                provider,
            };
            if (values.baseURL) {
                model.baseURL = values.baseURL;
            }
            if (values.displayName?.trim()) {
                model.displayName = values.displayName.trim();
            }
            if (values.maxInputTokens?.trim()) {
                model.maxInputTokens = parseInt(values.maxInputTokens, 10);
            }
            return model;
        },
    },

    openrouter: {
        displayName: 'OpenRouter',
        description: '100+ cloud models via unified API',
        steps: [
            {
                field: 'name',
                label: 'OpenRouter Model ID',
                placeholder: 'e.g., anthropic/claude-3.5-sonnet, openai/gpt-4o',
                required: true,
                validate: validators.slashFormat,
            },
            { ...DISPLAY_NAME_STEP, placeholder: 'e.g., Claude 3.5 Sonnet' },
            {
                ...API_KEY_STEP,
                placeholder: 'Saved as OPENROUTER_API_KEY if not set, otherwise per-model',
            },
        ],
        buildModel: (values, provider) => {
            const model: CustomModel = {
                name: values.name || '',
                provider,
            };
            if (values.displayName?.trim()) {
                model.displayName = values.displayName.trim();
            }
            return model;
        },
        asyncValidation: {
            field: 'name',
            validate: async (modelId: string) => {
                let status = lookupOpenRouterModel(modelId);

                // If cache is stale/empty, try to refresh
                if (status === 'unknown') {
                    try {
                        await refreshOpenRouterModelCache();
                        status = lookupOpenRouterModel(modelId);
                    } catch {
                        // Network failed - allow the model (graceful degradation)
                        return null;
                    }
                }

                if (status === 'invalid') {
                    return `Model '${modelId}' not found in OpenRouter. Check the model ID at https://openrouter.ai/models`;
                }

                return null;
            },
        },
    },

    glama: {
        displayName: 'Glama',
        description: 'OpenAI-compatible gateway',
        steps: [
            {
                field: 'name',
                label: 'Glama Model ID',
                placeholder: 'e.g., openai/gpt-4o, anthropic/claude-3-sonnet',
                required: true,
                validate: validators.slashFormat,
            },
            { ...DISPLAY_NAME_STEP, placeholder: 'e.g., GPT-4o via Glama' },
            {
                ...API_KEY_STEP,
                placeholder: 'Saved as GLAMA_API_KEY if not set, otherwise per-model',
            },
        ],
        buildModel: (values, provider) => {
            const model: CustomModel = {
                name: values.name || '',
                provider,
            };
            if (values.displayName?.trim()) {
                model.displayName = values.displayName.trim();
            }
            return model;
        },
    },

    litellm: {
        displayName: 'LiteLLM',
        description: 'Unified proxy for 100+ providers',
        steps: [
            {
                field: 'name',
                label: 'Model Name',
                placeholder: 'e.g., gpt-4, claude-3-sonnet, bedrock/anthropic.claude-v2',
                required: true,
                validate: validators.required('Model name'),
            },
            {
                field: 'baseURL',
                label: 'LiteLLM Proxy URL',
                placeholder: 'e.g., http://localhost:4000',
                required: true,
                validate: validators.url,
            },
            { ...DISPLAY_NAME_STEP, placeholder: 'e.g., My LiteLLM GPT-4' },
            MAX_INPUT_TOKENS_STEP,
            {
                ...API_KEY_STEP,
                placeholder: 'Saved as LITELLM_API_KEY if not set, otherwise per-model',
            },
        ],
        buildModel: (values, provider) => {
            const model: CustomModel = {
                name: values.name || '',
                provider,
            };
            if (values.baseURL) {
                model.baseURL = values.baseURL;
            }
            if (values.displayName?.trim()) {
                model.displayName = values.displayName.trim();
            }
            if (values.maxInputTokens?.trim()) {
                model.maxInputTokens = parseInt(values.maxInputTokens, 10);
            }
            return model;
        },
    },

    bedrock: {
        displayName: 'AWS Bedrock',
        description: 'Custom model IDs via AWS credentials',
        steps: [
            {
                field: 'name',
                label: 'Bedrock Model ID',
                placeholder: 'e.g., anthropic.claude-3-haiku-20240307-v1:0',
                required: true,
                validate: validators.required('Model ID'),
            },
            { ...DISPLAY_NAME_STEP, placeholder: 'e.g., Claude 3 Haiku' },
            {
                ...MAX_INPUT_TOKENS_STEP,
                placeholder: 'e.g., 200000 (leave blank for default)',
            },
            // NO apiKey step - Bedrock uses AWS credentials from environment
        ],
        buildModel: (values, provider) => {
            const model: CustomModel = {
                name: values.name || '',
                provider,
            };
            if (values.displayName?.trim()) {
                model.displayName = values.displayName.trim();
            }
            if (values.maxInputTokens?.trim()) {
                model.maxInputTokens = parseInt(values.maxInputTokens, 10);
            }
            return model;
        },
        setupInfo: {
            title: 'AWS Bedrock Setup',
            description:
                'Bedrock uses AWS credentials from your environment. Ensure AWS_REGION and either AWS_BEARER_TOKEN_BEDROCK or IAM credentials are set.',
            docsUrl: 'https://docs.dexto.ai/guides/supported-llm-providers#amazon-bedrock',
        },
    },

    ollama: {
        displayName: 'Ollama',
        description: 'Local Ollama server models',
        steps: [
            {
                field: 'name',
                label: 'Model Name',
                placeholder: 'e.g., llama3.3:70b, qwen3n:e2b',
                required: true,
                validate: validators.required('Model name'),
            },
            {
                field: 'baseURL',
                label: 'Ollama Server URL (optional)',
                placeholder: 'Default: http://localhost:11434',
                required: false,
                validate: (value) => {
                    if (!value?.trim()) return null;
                    return validators.url(value);
                },
            },
            { ...DISPLAY_NAME_STEP, placeholder: 'e.g., Llama 3.3 70B' },
            MAX_INPUT_TOKENS_STEP,
        ],
        buildModel: (values, provider) => {
            const model: CustomModel = {
                name: values.name || '',
                provider,
            };
            if (values.baseURL?.trim()) {
                model.baseURL = values.baseURL.trim();
            }
            if (values.displayName?.trim()) {
                model.displayName = values.displayName.trim();
            }
            if (values.maxInputTokens?.trim()) {
                model.maxInputTokens = parseInt(values.maxInputTokens, 10);
            }
            return model;
        },
        setupInfo: {
            title: 'Ollama Setup',
            description:
                'Add custom Ollama models by name. Ensure Ollama is running (default: http://localhost:11434). Pull models with: ollama pull <model>',
            docsUrl: 'https://docs.dexto.ai/guides/supported-llm-providers#ollama',
        },
    },

    local: {
        displayName: 'Local (node-llama)',
        description: 'Custom GGUF models via node-llama-cpp',
        steps: [
            {
                field: 'name',
                label: 'Model ID or Path',
                placeholder: 'e.g., llama-3.3-8b-q4 or /path/to/model.gguf',
                required: true,
                validate: validators.required('Model ID or path'),
            },
            { ...DISPLAY_NAME_STEP, placeholder: 'e.g., My Custom Llama' },
            MAX_INPUT_TOKENS_STEP,
        ],
        buildModel: (values, provider) => {
            const model: CustomModel = {
                name: values.name || '',
                provider,
            };
            if (values.displayName?.trim()) {
                model.displayName = values.displayName.trim();
            }
            if (values.maxInputTokens?.trim()) {
                model.maxInputTokens = parseInt(values.maxInputTokens, 10);
            }
            return model;
        },
        setupInfo: {
            title: 'Local Models Setup',
            description:
                'Add custom GGUF models by ID (from registry) or absolute file path. Ensure node-llama-cpp is installed and GPU acceleration is configured.',
            docsUrl: 'https://docs.dexto.ai/guides/supported-llm-providers#local-models',
        },
    },

    vertex: {
        displayName: 'Google Vertex AI',
        description: 'Custom Vertex model IDs',
        steps: [
            {
                field: 'name',
                label: 'Vertex Model ID',
                placeholder: 'e.g., gemini-2.0-flash-exp, claude-4-5-sonnet@20250929',
                required: true,
                validate: validators.required('Model ID'),
            },
            { ...DISPLAY_NAME_STEP, placeholder: 'e.g., Gemini 2.0 Flash Exp' },
            {
                ...MAX_INPUT_TOKENS_STEP,
                placeholder: 'e.g., 1048576 (leave blank for default)',
            },
        ],
        buildModel: (values, provider) => {
            const model: CustomModel = {
                name: values.name || '',
                provider,
            };
            if (values.displayName?.trim()) {
                model.displayName = values.displayName.trim();
            }
            if (values.maxInputTokens?.trim()) {
                model.maxInputTokens = parseInt(values.maxInputTokens, 10);
            }
            return model;
        },
        setupInfo: {
            title: 'Google Vertex AI Setup',
            description:
                'Vertex AI uses Google Cloud Application Default Credentials (ADC). Set GOOGLE_VERTEX_PROJECT and optionally GOOGLE_VERTEX_LOCATION. Run: gcloud auth application-default login',
            docsUrl: 'https://docs.dexto.ai/guides/supported-llm-providers#google-vertex-ai',
        },
    },
};

/**
 * Get provider config by provider type.
 */
export function getProviderConfig(provider: CustomModelProvider): ProviderConfig {
    return PROVIDER_CONFIGS[provider];
}

/**
 * Get display label for provider selection menu.
 * Format: "DisplayName (description)"
 */
export function getProviderLabel(provider: CustomModelProvider): string {
    const config = PROVIDER_CONFIGS[provider];
    return `${config.displayName} (${config.description})`;
}

/**
 * Get all available provider types.
 */
export function getAvailableProviders(): readonly CustomModelProvider[] {
    return CUSTOM_MODEL_PROVIDERS;
}

/**
 * Check if a provider has async validation.
 */
export function hasAsyncValidation(provider: CustomModelProvider): boolean {
    return !!PROVIDER_CONFIGS[provider].asyncValidation;
}

/**
 * Run async validation for a provider's field if applicable.
 */
export async function runAsyncValidation(
    provider: CustomModelProvider,
    field: string,
    value: string
): Promise<string | null> {
    const config = PROVIDER_CONFIGS[provider];
    if (config.asyncValidation && config.asyncValidation.field === field) {
        return config.asyncValidation.validate(value);
    }
    return null;
}

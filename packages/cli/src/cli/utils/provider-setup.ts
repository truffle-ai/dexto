// packages/cli/src/cli/utils/provider-setup.ts

import chalk from 'chalk';
import open from 'open';
import { type LLMProvider, LLM_PROVIDERS } from '@dexto/llm';
import { getPrimaryApiKeyEnvVar } from '@dexto/agent-management';

/**
 * Provider category for organizing the selection menu
 */
type ProviderCategory = 'recommended' | 'local' | 'cloud' | 'gateway' | 'enterprise';

/**
 * Extended provider information for setup
 */
interface ProviderOption {
    value: LLMProvider;
    label: string;
    hint: string;
    category: ProviderCategory;
    apiKeyUrl?: string;
    apiKeyPrefix?: string;
    apiKeyMinLength?: number;
    requiresBaseURL?: boolean;
    envVar: string;
    free?: boolean;
}

/**
 * Provider configuration registry
 * Organized by category for better UX
 *
 * Note: dexto-nova is NOT included here - it's a transparent routing layer,
 * not a user-selectable provider. When logged into Dexto, requests are
 * automatically routed through the Dexto gateway.
 */
const PROVIDER_REGISTRY: Partial<Record<LLMProvider, ProviderOption>> = {
    google: {
        value: 'google',
        label: 'Google Gemini',
        hint: 'Free tier, 1M+ context, multimodal',
        category: 'recommended',
        apiKeyUrl: 'https://aistudio.google.com/apikey',
        apiKeyPrefix: 'AIza',
        apiKeyMinLength: 20,
        envVar: 'GOOGLE_API_KEY',
        free: true,
    },
    groq: {
        value: 'groq',
        label: 'Groq',
        hint: 'Free tier, ultra-fast inference',
        category: 'recommended',
        apiKeyUrl: 'https://console.groq.com/keys',
        apiKeyPrefix: 'gsk_',
        apiKeyMinLength: 40,
        envVar: 'GROQ_API_KEY',
        free: true,
    },
    // Local providers - run AI completely on your machine
    local: {
        value: 'local',
        label: 'Local Models',
        hint: 'Run Llama, Qwen, Mistral locally - Free, private, offline',
        category: 'local',
        envVar: '', // No API key required
        free: true,
    },
    ollama: {
        value: 'ollama',
        label: 'Ollama',
        hint: 'Use Ollama server for local inference',
        category: 'local',
        envVar: '', // No API key required (optional OLLAMA_API_KEY for remote)
        free: true,
    },
    openai: {
        value: 'openai',
        label: 'OpenAI',
        hint: 'GPT-4o, GPT-5, o1/o3 reasoning',
        category: 'cloud',
        apiKeyUrl: 'https://platform.openai.com/api-keys',
        apiKeyPrefix: 'sk-',
        apiKeyMinLength: 40,
        envVar: 'OPENAI_API_KEY',
    },
    anthropic: {
        value: 'anthropic',
        label: 'Anthropic',
        hint: 'Claude 4.5, best for coding',
        category: 'cloud',
        apiKeyUrl: 'https://console.anthropic.com/settings/keys',
        apiKeyPrefix: 'sk-ant-',
        apiKeyMinLength: 40,
        envVar: 'ANTHROPIC_API_KEY',
    },
    xai: {
        value: 'xai',
        label: 'xAI',
        hint: 'Grok models',
        category: 'cloud',
        apiKeyUrl: 'https://console.x.ai/team/default/api-keys',
        envVar: 'XAI_API_KEY',
    },
    cohere: {
        value: 'cohere',
        label: 'Cohere',
        hint: 'Command models, RAG-optimized',
        category: 'cloud',
        apiKeyUrl: 'https://dashboard.cohere.com/api-keys',
        envVar: 'COHERE_API_KEY',
    },
    minimax: {
        value: 'minimax',
        label: 'MiniMax',
        hint: 'M2.1 coding-focused models',
        category: 'cloud',
        apiKeyUrl: 'https://platform.minimax.io/docs/faq/about-apis',
        envVar: 'MINIMAX_API_KEY',
    },
    glm: {
        value: 'glm',
        label: 'GLM (Zhipu)',
        hint: 'GLM-4.7 series models',
        category: 'cloud',
        apiKeyUrl: 'https://open.bigmodel.cn/',
        envVar: 'ZHIPU_API_KEY',
    },
    openrouter: {
        value: 'openrouter',
        label: 'OpenRouter',
        hint: '100+ models, unified API',
        category: 'gateway',
        apiKeyUrl: 'https://openrouter.ai/keys',
        apiKeyPrefix: 'sk-or-',
        apiKeyMinLength: 40,
        envVar: 'OPENROUTER_API_KEY',
    },
    glama: {
        value: 'glama',
        label: 'Glama',
        hint: 'OpenAI-compatible gateway',
        category: 'gateway',
        apiKeyUrl: 'https://glama.ai/settings/api-keys',
        envVar: 'GLAMA_API_KEY',
    },
    litellm: {
        value: 'litellm',
        label: 'LiteLLM',
        hint: 'Self-hosted proxy for 100+ providers',
        category: 'gateway',
        requiresBaseURL: true,
        envVar: 'LITELLM_API_KEY',
    },
    'openai-compatible': {
        value: 'openai-compatible',
        label: 'OpenAI-Compatible',
        hint: 'Ollama, vLLM, LocalAI, or any OpenAI-format API',
        category: 'gateway',
        requiresBaseURL: true,
        envVar: 'OPENAI_COMPATIBLE_API_KEY',
    },
    vertex: {
        value: 'vertex',
        label: 'Google Vertex AI',
        hint: 'GCP-hosted Gemini & Claude (uses ADC)',
        category: 'enterprise',
        apiKeyUrl: 'https://console.cloud.google.com/apis/credentials',
        envVar: 'GOOGLE_VERTEX_PROJECT',
    },
    bedrock: {
        value: 'bedrock',
        label: 'AWS Bedrock',
        hint: 'AWS-hosted Claude & Nova (uses AWS creds)',
        category: 'enterprise',
        apiKeyUrl: 'https://console.aws.amazon.com/bedrock',
        envVar: 'AWS_ACCESS_KEY_ID',
    },
};

/**
 * Get provider display name
 */
export function getProviderDisplayName(provider: LLMProvider | string): string {
    if (provider === 'dexto-nova') return 'Dexto';
    if (isLLMProvider(provider)) {
        return PROVIDER_REGISTRY[provider]?.label || provider;
    }
    return provider;
}

function isLLMProvider(value: string): value is LLMProvider {
    return (LLM_PROVIDERS as readonly string[]).includes(value);
}

/**
 * Get provider option info
 */
export function getProviderInfo(provider: LLMProvider): ProviderOption | undefined {
    return PROVIDER_REGISTRY[provider];
}

/**
 * Validates API key format for a provider with detailed error messages
 */
export function validateApiKeyFormat(
    apiKey: string,
    provider: LLMProvider
): { valid: boolean; error?: string } {
    const info = PROVIDER_REGISTRY[provider];
    const trimmed = apiKey.trim();

    if (!trimmed) {
        return { valid: false, error: 'API key cannot be empty' };
    }

    // Check minimum length if specified
    if (info?.apiKeyMinLength && trimmed.length < info.apiKeyMinLength) {
        return {
            valid: false,
            error: `API key seems too short (expected ${info.apiKeyMinLength}+ characters, got ${trimmed.length})`,
        };
    }

    // Check prefix if specified
    if (info?.apiKeyPrefix && !trimmed.startsWith(info.apiKeyPrefix)) {
        const prefixLen = info.apiKeyPrefix.length;
        return {
            valid: false,
            error: `Invalid format: ${getProviderDisplayName(provider)} keys start with "${info.apiKeyPrefix}" (got "${trimmed.slice(0, prefixLen)}...")`,
        };
    }

    return { valid: true };
}

/**
 * Legacy validation function for backwards compatibility
 */
export function isValidApiKeyFormat(apiKey: string, provider: LLMProvider): boolean {
    return validateApiKeyFormat(apiKey, provider).valid;
}

/**
 * Gets provider-specific instructions for API key setup
 */
export function getProviderInstructions(
    provider: LLMProvider
): { title: string; content: string; url?: string | undefined } | null {
    const info = PROVIDER_REGISTRY[provider];
    if (!info) return null;

    const freeTag = info.free ? chalk.green(' (Free)') : '';
    const title = `${getProviderDisplayName(provider)} API Key${freeTag}`;

    let content = '';

    if (info.apiKeyUrl) {
        content += `1. Visit: ${chalk.cyan(info.apiKeyUrl)}\n`;
        content += `2. Sign in to your account\n`;
        content += `3. Create a new API key\n`;
        content += `4. Copy and paste it below\n`;
    } else if (info.requiresBaseURL) {
        content += `This provider requires a custom endpoint URL.\n`;
        content += `You'll configure both the URL and API key in the next steps.\n`;
    }

    if (info.apiKeyPrefix) {
        content += `\n${chalk.gray(`Key format: ${info.apiKeyPrefix}...`)}`;
    }

    return { title, content, url: info.apiKeyUrl };
}

/**
 * Open the API key URL in the browser
 */
export async function openApiKeyUrl(provider: LLMProvider): Promise<boolean> {
    const info = PROVIDER_REGISTRY[provider];
    if (!info?.apiKeyUrl) return false;

    try {
        await open(info.apiKeyUrl);
        return true;
    } catch {
        return false;
    }
}

/**
 * Get environment variable name for provider's API key.
 * Uses the canonical env var from the core api-key-resolver.
 */
export function getProviderEnvVar(provider: LLMProvider): string {
    return getPrimaryApiKeyEnvVar(provider);
}

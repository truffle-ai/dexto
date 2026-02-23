// packages/cli/src/cli/utils/api-key-verification.ts

import type { LLMProvider } from '@dexto/core';
import { logger } from '@dexto/core';

export interface VerificationResult {
    success: boolean;
    error?: string;
    modelUsed?: string;
}

/**
 * Verify an API key by making a minimal test request to the provider.
 * Uses provider-specific endpoints for efficient validation.
 *
 * @param provider - The LLM provider
 * @param apiKey - The API key to verify
 * @param model - Optional specific model to test with
 * @returns Verification result
 */
export async function verifyApiKey(
    provider: LLMProvider,
    apiKey: string,
    _model?: string
): Promise<VerificationResult> {
    try {
        switch (provider) {
            case 'openai':
                return await verifyOpenAI(apiKey);
            case 'anthropic':
                return await verifyAnthropic(apiKey);
            case 'google':
                return await verifyGoogle(apiKey);
            case 'groq':
                return await verifyGroq(apiKey);
            case 'xai':
                return await verifyXAI(apiKey);
            case 'cohere':
                return await verifyCohere(apiKey);
            case 'openrouter':
                return await verifyOpenRouter(apiKey);
            case 'glama':
                return await verifyGlama(apiKey);
            case 'minimax':
                return await verifyMiniMax(apiKey);
            case 'zhipuai':
            case 'zhipuai-coding-plan':
            case 'zai':
            case 'zai-coding-plan':
                return await verifyGLM(apiKey);
            case 'openai-compatible':
            case 'litellm':
                // For custom endpoints, we can't verify without a baseURL
                // Just do basic format check
                return { success: true, modelUsed: 'custom' };
            case 'google-vertex':
            case 'google-vertex-anthropic':
            case 'amazon-bedrock':
                // These use cloud credentials, not API keys
                // Skip verification
                return { success: true, modelUsed: 'cloud-auth' };
            default:
                // Unknown provider - skip verification
                return { success: true, modelUsed: 'unknown' };
        }
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        logger.debug(`API key verification failed for ${provider}: ${errorMessage}`);
        return { success: false, error: errorMessage };
    }
}

/**
 * Verify OpenAI API key using the models endpoint
 */
async function verifyOpenAI(apiKey: string): Promise<VerificationResult> {
    const response = await fetch('https://api.openai.com/v1/models', {
        method: 'GET',
        headers: {
            Authorization: `Bearer ${apiKey}`,
        },
    });

    if (response.ok) {
        return { success: true, modelUsed: 'models-list' };
    }

    const error = await parseErrorResponse(response);
    return { success: false, error };
}

/**
 * Verify Anthropic API key using a minimal messages request
 */
async function verifyAnthropic(apiKey: string): Promise<VerificationResult> {
    // Anthropic doesn't have a models endpoint, so we make a minimal request
    // that will fail fast if the key is invalid
    const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
            model: 'claude-3-5-haiku-20241022',
            max_tokens: 1,
            messages: [{ role: 'user', content: 'hi' }],
        }),
    });

    // 200 = success, 400 = bad request (but key is valid), 401/403 = invalid key
    if (response.ok || response.status === 400) {
        return { success: true, modelUsed: 'claude-3-5-haiku-20241022' };
    }

    const error = await parseErrorResponse(response);
    return { success: false, error };
}

/**
 * Verify Google AI API key using the models endpoint
 */
async function verifyGoogle(apiKey: string): Promise<VerificationResult> {
    const response = await fetch(
        `https://generativelanguage.googleapis.com/v1/models?key=${apiKey}`,
        {
            method: 'GET',
        }
    );

    if (response.ok) {
        return { success: true, modelUsed: 'models-list' };
    }

    const error = await parseErrorResponse(response);
    return { success: false, error };
}

/**
 * Verify Groq API key using the models endpoint
 */
async function verifyGroq(apiKey: string): Promise<VerificationResult> {
    const response = await fetch('https://api.groq.com/openai/v1/models', {
        method: 'GET',
        headers: {
            Authorization: `Bearer ${apiKey}`,
        },
    });

    if (response.ok) {
        return { success: true, modelUsed: 'models-list' };
    }

    const error = await parseErrorResponse(response);
    return { success: false, error };
}

/**
 * Verify xAI API key using the models endpoint
 */
async function verifyXAI(apiKey: string): Promise<VerificationResult> {
    const response = await fetch('https://api.x.ai/v1/models', {
        method: 'GET',
        headers: {
            Authorization: `Bearer ${apiKey}`,
        },
    });

    if (response.ok) {
        return { success: true, modelUsed: 'models-list' };
    }

    const error = await parseErrorResponse(response);
    return { success: false, error };
}

/**
 * Verify Cohere API key using a check-api-key endpoint or models list
 */
async function verifyCohere(apiKey: string): Promise<VerificationResult> {
    const response = await fetch('https://api.cohere.com/v2/models', {
        method: 'GET',
        headers: {
            Authorization: `Bearer ${apiKey}`,
        },
    });

    if (response.ok) {
        return { success: true, modelUsed: 'models-list' };
    }

    const error = await parseErrorResponse(response);
    return { success: false, error };
}

/**
 * Verify OpenRouter API key using the auth endpoint
 */
async function verifyOpenRouter(apiKey: string): Promise<VerificationResult> {
    const response = await fetch('https://openrouter.ai/api/v1/auth/key', {
        method: 'GET',
        headers: {
            Authorization: `Bearer ${apiKey}`,
        },
    });

    if (response.ok) {
        return { success: true, modelUsed: 'auth-check' };
    }

    const error = await parseErrorResponse(response);
    return { success: false, error };
}

/**
 * Verify Glama API key using the models endpoint
 */
async function verifyGlama(apiKey: string): Promise<VerificationResult> {
    const response = await fetch('https://glama.ai/api/gateway/openai/v1/models', {
        method: 'GET',
        headers: {
            Authorization: `Bearer ${apiKey}`,
        },
    });

    if (response.ok) {
        return { success: true, modelUsed: 'models-list' };
    }

    const error = await parseErrorResponse(response);
    return { success: false, error };
}

/**
 * Verify MiniMax API key using the OpenAI-compatible models endpoint
 */
async function verifyMiniMax(apiKey: string): Promise<VerificationResult> {
    const response = await fetch('https://api.minimax.chat/v1/models', {
        method: 'GET',
        headers: {
            Authorization: `Bearer ${apiKey}`,
        },
    });

    if (response.ok) {
        return { success: true, modelUsed: 'models-list' };
    }

    const error = await parseErrorResponse(response);
    return { success: false, error };
}

/**
 * Verify GLM (Zhipu) API key using the OpenAI-compatible models endpoint
 */
async function verifyGLM(apiKey: string): Promise<VerificationResult> {
    const response = await fetch('https://open.bigmodel.cn/api/paas/v4/models', {
        method: 'GET',
        headers: {
            Authorization: `Bearer ${apiKey}`,
        },
    });

    if (response.ok) {
        return { success: true, modelUsed: 'models-list' };
    }

    const error = await parseErrorResponse(response);
    return { success: false, error };
}

/**
 * Parse error response from provider API
 */
async function parseErrorResponse(response: Response): Promise<string> {
    const status = response.status;

    // Common status codes
    if (status === 401) {
        return 'Invalid API key - authentication failed';
    }
    if (status === 403) {
        return 'API key does not have permission to access this resource';
    }
    if (status === 429) {
        return 'Rate limit exceeded - but API key appears valid';
    }

    // Try to parse JSON error
    try {
        const json = await response.json();
        const message = json.error?.message || json.message || json.detail || JSON.stringify(json);
        return `API error (${status}): ${message}`;
    } catch {
        return `API error (${status}): ${response.statusText}`;
    }
}

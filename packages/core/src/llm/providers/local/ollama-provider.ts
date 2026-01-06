/* global TextDecoder */
/**
 * Ollama provider for local model inference.
 *
 * Uses Ollama's OpenAI-compatible API for seamless integration
 * with the Vercel AI SDK.
 */

import { createOpenAI } from '@ai-sdk/openai';
import type { LanguageModel } from 'ai';
import type { OllamaModelInfo, OllamaStatus } from './types.js';
import { LocalModelError } from './errors.js';

/**
 * Default Ollama server URL.
 */
export const DEFAULT_OLLAMA_URL = 'http://localhost:11434';

/**
 * Ollama configuration options.
 */
export interface OllamaConfig {
    /** Ollama server base URL (default: http://localhost:11434) */
    baseURL?: string;
}

/**
 * Check if the Ollama server is running.
 */
export async function checkOllamaStatus(
    baseURL: string = DEFAULT_OLLAMA_URL
): Promise<OllamaStatus> {
    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 5000);

        const response = await fetch(`${baseURL}/api/version`, {
            signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
            return {
                running: false,
                url: baseURL,
                error: `HTTP ${response.status}: ${response.statusText}`,
            };
        }

        const data = (await response.json()) as { version?: string };

        // Fetch available models
        const models = await listOllamaModels(baseURL);

        const status: OllamaStatus = {
            running: true,
            url: baseURL,
            models,
        };

        if (data.version) {
            status.version = data.version;
        }

        return status;
    } catch (error) {
        const errorMessage =
            error instanceof Error
                ? error.name === 'AbortError'
                    ? 'Connection timed out'
                    : error.message
                : 'Unknown error';

        return {
            running: false,
            url: baseURL,
            error: errorMessage,
        };
    }
}

/**
 * List available models on the Ollama server.
 */
export async function listOllamaModels(
    baseURL: string = DEFAULT_OLLAMA_URL
): Promise<OllamaModelInfo[]> {
    try {
        const response = await fetch(`${baseURL}/api/tags`);

        if (!response.ok) {
            return [];
        }

        const data = (await response.json()) as {
            models?: Array<{
                name: string;
                size: number;
                digest: string;
                modified_at: string;
                details?: {
                    family?: string;
                    parameter_size?: string;
                    quantization_level?: string;
                };
            }>;
        };

        return (data.models ?? []).map((model) => {
            const modelInfo: OllamaModelInfo = {
                name: model.name,
                size: model.size,
                digest: model.digest,
                modifiedAt: model.modified_at,
            };

            if (model.details) {
                const details: NonNullable<OllamaModelInfo['details']> = {};
                if (model.details.family) {
                    details.family = model.details.family;
                }
                if (model.details.parameter_size) {
                    details.parameterSize = model.details.parameter_size;
                }
                if (model.details.quantization_level) {
                    details.quantizationLevel = model.details.quantization_level;
                }
                if (Object.keys(details).length > 0) {
                    modelInfo.details = details;
                }
            }

            return modelInfo;
        });
    } catch {
        return [];
    }
}

/**
 * Check if a specific model is available on Ollama.
 */
export async function isOllamaModelAvailable(
    modelName: string,
    baseURL: string = DEFAULT_OLLAMA_URL
): Promise<boolean> {
    const models = await listOllamaModels(baseURL);
    return models.some(
        (m) =>
            m.name === modelName ||
            m.name.startsWith(`${modelName}:`) ||
            modelName.startsWith(`${m.name}:`)
    );
}

/**
 * Pull a model from the Ollama registry.
 * Returns a stream of progress events.
 *
 * @param modelName - Name of the model to pull
 * @param baseURL - Ollama server URL (default: http://localhost:11434)
 * @param onProgress - Optional callback for progress updates
 * @param signal - Optional AbortSignal for cancellation
 */
export async function pullOllamaModel(
    modelName: string,
    baseURL: string = DEFAULT_OLLAMA_URL,
    onProgress?: (progress: { status: string; completed?: number; total?: number }) => void,
    signal?: AbortSignal
): Promise<void> {
    try {
        const fetchOptions: RequestInit = {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: modelName }),
        };
        if (signal) {
            fetchOptions.signal = signal;
        }
        const response = await fetch(`${baseURL}/api/pull`, fetchOptions);

        if (!response.ok) {
            throw LocalModelError.ollamaPullFailed(
                modelName,
                `HTTP ${response.status}: ${response.statusText}`
            );
        }

        const reader = response.body?.getReader();
        if (!reader) {
            throw LocalModelError.ollamaPullFailed(modelName, 'No response body');
        }

        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });

            // Ollama sends newline-delimited JSON
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';

            for (const line of lines) {
                if (!line.trim()) continue;
                try {
                    const progress = JSON.parse(line) as {
                        status: string;
                        completed?: number;
                        total?: number;
                        error?: string;
                    };

                    if (progress.error) {
                        throw LocalModelError.ollamaPullFailed(modelName, progress.error);
                    }

                    onProgress?.(progress);
                } catch (e) {
                    if (e instanceof Error && e.message.includes('ollamaPullFailed')) {
                        throw e;
                    }
                    // Ignore JSON parse errors
                }
            }
        }
    } catch (error) {
        if (error instanceof Error && error.message.includes('ECONNREFUSED')) {
            throw LocalModelError.ollamaNotRunning(baseURL);
        }
        throw error;
    }
}

/**
 * Create an Ollama language model using the OpenAI-compatible API.
 */
export function createOllamaModel(modelName: string, config: OllamaConfig = {}): LanguageModel {
    const { baseURL = DEFAULT_OLLAMA_URL } = config;

    // Ollama's OpenAI-compatible endpoint is at /v1
    const openai = createOpenAI({
        baseURL: `${baseURL}/v1`,
        apiKey: 'ollama', // Ollama doesn't require an API key, but the SDK requires a non-empty string
    });

    return openai(modelName);
}

/**
 * Create an Ollama model with status validation.
 * Throws if Ollama is not running or model is not available.
 */
export async function createValidatedOllamaModel(
    modelName: string,
    config: OllamaConfig = {}
): Promise<LanguageModel> {
    const { baseURL = DEFAULT_OLLAMA_URL } = config;

    // Check if Ollama is running
    const status = await checkOllamaStatus(baseURL);
    if (!status.running) {
        throw LocalModelError.ollamaNotRunning(baseURL);
    }

    // Check if model is available
    const isAvailable = await isOllamaModelAvailable(modelName, baseURL);
    if (!isAvailable) {
        throw LocalModelError.ollamaModelNotFound(modelName);
    }

    return createOllamaModel(modelName, config);
}

/**
 * Get information about a specific Ollama model.
 */
export async function getOllamaModelInfo(
    modelName: string,
    baseURL: string = DEFAULT_OLLAMA_URL
): Promise<OllamaModelInfo | null> {
    const models = await listOllamaModels(baseURL);
    return (
        models.find(
            (m) =>
                m.name === modelName ||
                m.name.startsWith(`${modelName}:`) ||
                modelName.startsWith(`${m.name}:`)
        ) ?? null
    );
}

/**
 * Delete a model from Ollama.
 */
export async function deleteOllamaModel(
    modelName: string,
    baseURL: string = DEFAULT_OLLAMA_URL
): Promise<boolean> {
    try {
        const response = await fetch(`${baseURL}/api/delete`, {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: modelName }),
        });

        return response.ok;
    } catch {
        return false;
    }
}

/**
 * Generate embeddings using Ollama.
 * Uses the /api/embed endpoint which supports batch processing.
 *
 * Note: Reserved for future RAG/vector search functionality.
 */
export async function generateOllamaEmbeddings(
    modelName: string,
    input: string | string[],
    baseURL: string = DEFAULT_OLLAMA_URL
): Promise<number[][]> {
    const inputs = Array.isArray(input) ? input : [input];

    // Use /api/embed endpoint which accepts arrays for batch processing
    const response = await fetch(`${baseURL}/api/embed`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            model: modelName,
            input: inputs,
        }),
    });

    if (!response.ok) {
        throw LocalModelError.ollamaApiError(`HTTP ${response.status}: ${response.statusText}`);
    }

    const data = (await response.json()) as { embeddings: number[][] };
    return data.embeddings;
}

/**
 * Vercel AI SDK adapter for node-llama-cpp.
 *
 * This module creates a LanguageModelV2 implementation that wraps node-llama-cpp,
 * allowing local GGUF models to be used with the Vercel AI SDK.
 */

/* global ReadableStream, ReadableStreamDefaultController */

import type {
    LanguageModelV2,
    LanguageModelV2CallOptions,
    LanguageModelV2StreamPart,
    LanguageModelV2Content,
    LanguageModelV2FinishReason,
    LanguageModelV2Usage,
    LanguageModelV2CallWarning,
} from '@ai-sdk/provider';
import {
    loadModel,
    isNodeLlamaCppInstalled,
    type ModelSession,
    type LoadedModel,
} from './node-llama-provider.js';
import { LocalModelError } from './errors.js';
import { getLocalModelById } from './registry.js';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

/**
 * Configuration for the local model AI SDK adapter.
 */
export interface LocalModelAdapterConfig {
    /** Model ID from the local registry */
    modelId: string;
    /** Direct path to model file (optional, overrides modelId lookup) */
    modelPath?: string;
    /** Context window size (default: 4096) */
    contextSize?: number;
    /** Number of GPU layers to offload (-1 = all, 0 = CPU only) */
    gpuLayers?: number;
    /** Number of CPU threads */
    threads?: number;
}

/**
 * Installed model info structure (matches agent-management schema)
 */
interface InstalledModelInfo {
    id: string;
    filePath: string;
    sizeBytes: number;
    downloadedAt: string;
}

/**
 * Model state structure (matches agent-management schema)
 */
interface ModelState {
    version: string;
    installed: Record<string, InstalledModelInfo>;
    activeModelId?: string;
}

/**
 * Get the models directory path.
 */
function getModelsDirectory(): string {
    return path.join(os.homedir(), '.dexto', 'models');
}

/**
 * Read installed models from state file.
 * This is a standalone implementation that doesn't depend on agent-management.
 */
function getInstalledModelInfo(modelId: string): InstalledModelInfo | null {
    const stateFile = path.join(getModelsDirectory(), 'state.json');

    try {
        if (!fs.existsSync(stateFile)) {
            return null;
        }

        const content = fs.readFileSync(stateFile, 'utf-8');
        const state: ModelState = JSON.parse(content);

        return state.installed[modelId] ?? null;
    } catch {
        return null;
    }
}

/**
 * Custom model info structure (matches agent-management schema)
 */
interface CustomModelInfo {
    name: string;
    provider: string;
    filePath?: string;
    displayName?: string;
    maxInputTokens?: number;
}

/**
 * Custom models storage structure
 */
interface CustomModelsStorage {
    version: number;
    models: CustomModelInfo[];
}

/**
 * Read custom models from custom-models.json.
 * This is a standalone implementation that doesn't depend on agent-management.
 * Used to resolve custom GGUF file paths for local models.
 */
function getCustomModelFilePath(modelId: string): string | null {
    const customModelsFile = path.join(getModelsDirectory(), 'custom-models.json');

    try {
        if (!fs.existsSync(customModelsFile)) {
            return null;
        }

        const content = fs.readFileSync(customModelsFile, 'utf-8');
        const storage: CustomModelsStorage = JSON.parse(content);

        // Find a custom model with matching name and local provider
        const customModel = storage.models.find(
            (m) => m.name === modelId && m.provider === 'local' && m.filePath
        );

        return customModel?.filePath ?? null;
    } catch {
        return null;
    }
}

/**
 * Create a Vercel AI SDK compatible LanguageModelV2 from a local GGUF model.
 * This is a synchronous function that returns a LanguageModel with lazy initialization.
 * The actual model loading happens on first use.
 */
export function createLocalLanguageModel(config: LocalModelAdapterConfig): LanguageModelV2 {
    return new LocalLanguageModel(config);
}

/**
 * LanguageModelV2 implementation for local GGUF models.
 * Uses lazy initialization - model is loaded on first use.
 */
class LocalLanguageModel implements LanguageModelV2 {
    readonly specificationVersion = 'v2' as const;
    readonly provider = 'local';
    readonly modelId: string;

    // Local models don't support URL-based content natively
    readonly supportedUrls: Record<string, RegExp[]> = {};

    private config: LocalModelAdapterConfig;
    private session: ModelSession | null = null;
    private loadedModel: LoadedModel | null = null;
    private initPromise: Promise<void> | null = null;
    private deviceName: string = 'Local';

    constructor(config: LocalModelAdapterConfig) {
        this.modelId = config.modelId;
        this.config = config;
    }

    /**
     * Initialize the model lazily on first use.
     */
    private async ensureInitialized(): Promise<void> {
        if (this.session) {
            return;
        }

        if (this.initPromise) {
            return this.initPromise;
        }

        this.initPromise = this.initialize();
        return this.initPromise;
    }

    private async initialize(): Promise<void> {
        const {
            modelId,
            modelPath: directPath,
            contextSize, // Let node-llama-cpp default to "auto" if not specified
            gpuLayers = -1,
            threads,
        } = this.config;

        // Check if node-llama-cpp is installed
        const isInstalled = await isNodeLlamaCppInstalled();
        if (!isInstalled) {
            throw LocalModelError.nodeLlamaNotInstalled();
        }

        // Resolve model path
        let modelPath: string;

        if (directPath) {
            // Use directly provided path
            modelPath = directPath;
        } else {
            // Look up installed model by ID (from state.json - downloaded models)
            const installedModel = getInstalledModelInfo(modelId);
            if (installedModel) {
                modelPath = installedModel.filePath;
            } else {
                // Check custom models (from custom-models.json - user-provided GGUF paths)
                const customPath = getCustomModelFilePath(modelId);
                if (customPath) {
                    modelPath = customPath;
                } else {
                    // Try to get from registry for a better error message
                    const registryModel = getLocalModelById(modelId);
                    if (!registryModel) {
                        throw LocalModelError.modelNotFound(modelId);
                    }
                    throw LocalModelError.modelNotDownloaded(modelId);
                }
            }
        }

        // Build config object, only including optional fields if defined
        const loadConfig: {
            modelPath: string;
            contextSize?: number;
            gpuLayers: number;
            threads?: number;
        } = {
            modelPath,
            gpuLayers,
        };

        if (contextSize !== undefined) {
            loadConfig.contextSize = contextSize;
        }
        if (threads !== undefined) {
            loadConfig.threads = threads;
        }

        // Load the model
        this.loadedModel = await loadModel(loadConfig);

        this.deviceName = this.loadedModel.gpuInfo.deviceName || 'Local';

        // Create a session for this model
        this.session = await this.loadedModel.createSession();
    }

    /**
     * Non-streaming text generation (V2 interface).
     */
    async doGenerate(options: LanguageModelV2CallOptions) {
        await this.ensureInitialized();

        const prompt = this.formatPrompt(options);
        const maxTokens = options.maxOutputTokens ?? 1024;
        const temperature = options.temperature ?? 0.7;

        // Build prompt options, only including signal if defined
        const promptOptions: {
            maxTokens: number;
            temperature: number;
            signal?: AbortSignal;
        } = {
            maxTokens,
            temperature,
        };

        if (options.abortSignal) {
            promptOptions.signal = options.abortSignal;
        }

        const response = await this.session!.prompt(prompt, promptOptions);

        // Estimate token counts (rough approximation)
        const inputTokens = Math.ceil(prompt.length / 4);
        const outputTokens = Math.ceil(response.length / 4);

        const content: LanguageModelV2Content[] = [{ type: 'text', text: response }];
        const finishReason: LanguageModelV2FinishReason = 'stop';
        const usage: LanguageModelV2Usage = {
            inputTokens,
            outputTokens,
            totalTokens: inputTokens + outputTokens,
        };
        const warnings: LanguageModelV2CallWarning[] = [];

        return {
            content,
            finishReason,
            usage,
            providerMetadata: {
                local: {
                    device: this.deviceName,
                },
            },
            warnings,
        };
    }

    /**
     * Streaming text generation (V2 interface).
     */
    async doStream(options: LanguageModelV2CallOptions) {
        await this.ensureInitialized();

        const prompt = this.formatPrompt(options);
        const maxTokens = options.maxOutputTokens ?? 1024;
        const temperature = options.temperature ?? 0.7;

        const inputTokens = Math.ceil(prompt.length / 4);
        let outputTokens = 0;

        const session = this.session!;
        const textId = 'text-0';

        // Build prompt options for streaming
        const streamPromptOptions: {
            maxTokens: number;
            temperature: number;
            signal?: AbortSignal;
            onToken: (token: string) => void;
        } = {
            maxTokens,
            temperature,
            onToken: (_token: string) => {
                // Will be set up in the stream
            },
        };

        if (options.abortSignal) {
            streamPromptOptions.signal = options.abortSignal;
        }

        // Need to capture controller reference for the onToken callback
        let controller: ReadableStreamDefaultController<LanguageModelV2StreamPart>;

        const stream = new ReadableStream<LanguageModelV2StreamPart>({
            async start(ctrl) {
                controller = ctrl;

                // Emit stream-start
                controller.enqueue({
                    type: 'stream-start',
                    warnings: [],
                });

                // Emit text-start
                controller.enqueue({
                    type: 'text-start',
                    id: textId,
                });

                try {
                    // Set up the onToken callback to emit text-delta
                    streamPromptOptions.onToken = (token: string) => {
                        outputTokens += 1;
                        controller.enqueue({
                            type: 'text-delta',
                            id: textId,
                            delta: token,
                        });
                    };

                    await session.prompt(prompt, streamPromptOptions);

                    // Emit text-end
                    controller.enqueue({
                        type: 'text-end',
                        id: textId,
                    });

                    // Send finish event
                    controller.enqueue({
                        type: 'finish',
                        finishReason: 'stop',
                        usage: {
                            inputTokens,
                            outputTokens,
                            totalTokens: inputTokens + outputTokens,
                        },
                    });

                    controller.close();
                } catch (error) {
                    if (error instanceof Error && error.name === 'AbortError') {
                        // Emit text-end on abort
                        controller.enqueue({
                            type: 'text-end',
                            id: textId,
                        });

                        controller.enqueue({
                            type: 'finish',
                            finishReason: 'stop',
                            usage: {
                                inputTokens,
                                outputTokens,
                                totalTokens: inputTokens + outputTokens,
                            },
                        });
                        controller.close();
                    } else {
                        controller.enqueue({
                            type: 'error',
                            error,
                        });
                        controller.close();
                    }
                }
            },
        });

        return {
            stream,
        };
    }

    /**
     * Format the prompt from AI SDK message format.
     */
    private formatPrompt(options: LanguageModelV2CallOptions): string {
        const parts: string[] = [];

        // Handle prompt messages
        if (options.prompt && Array.isArray(options.prompt)) {
            for (const message of options.prompt) {
                if (message.role === 'system') {
                    // System message content is a string
                    parts.push(`System: ${message.content}`);
                } else if (message.role === 'user') {
                    // User message content is an array of parts
                    if (Array.isArray(message.content)) {
                        const textParts = message.content
                            .filter((p): p is { type: 'text'; text: string } => p.type === 'text')
                            .map((p) => p.text);
                        if (textParts.length > 0) {
                            parts.push(`User: ${textParts.join('\n')}`);
                        }
                    }
                } else if (message.role === 'assistant') {
                    // Assistant message content is an array of parts
                    if (Array.isArray(message.content)) {
                        const textParts = message.content
                            .filter((p): p is { type: 'text'; text: string } => p.type === 'text')
                            .map((p) => p.text);
                        if (textParts.length > 0) {
                            parts.push(`Assistant: ${textParts.join('\n')}`);
                        }
                    }
                }
            }
        }

        parts.push('Assistant:');
        return parts.join('\n\n');
    }
}

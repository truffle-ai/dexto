/**
 * node-llama-cpp provider for native local model execution.
 *
 * This module provides utilities for loading and using GGUF models via node-llama-cpp.
 * Since node-llama-cpp is an optional dependency, all functions handle the case
 * where it's not installed gracefully.
 *
 * For Vercel AI SDK integration, we recommend using Ollama which provides
 * an OpenAI-compatible API that works seamlessly with the SDK.
 */

import type { GPUInfo } from './types.js';
import { LocalModelError } from './errors.js';
import { detectGPU } from './gpu-detector.js';
import { getDextoGlobalPath } from '../../../utils/path.js';
import { createRequire } from 'module';
import * as path from 'path';

/**
 * Get the global deps path where node-llama-cpp may be installed.
 */
function getGlobalNodeLlamaCppPath(): string {
    return path.join(getDextoGlobalPath('deps'), 'node_modules', 'node-llama-cpp');
}

/**
 * Check if node-llama-cpp is installed.
 * Checks both standard node resolution (for dev/projects) and global deps (~/.dexto/deps).
 */
export async function isNodeLlamaCppInstalled(): Promise<boolean> {
    // Try 1: Standard node resolution (works in dev mode, dexto-project with local install)
    try {
        // @ts-ignore - Optional dependency may not be installed (TS2307 in CI)
        await import('node-llama-cpp');
        return true;
    } catch {
        // Continue to fallback
    }

    // Try 2: Global deps location (~/.dexto/deps/node_modules/node-llama-cpp)
    try {
        const globalPath = getGlobalNodeLlamaCppPath();
        const require = createRequire(import.meta.url);
        require.resolve(globalPath);
        return true;
    } catch {
        return false;
    }
}

/**
 * Dynamically import node-llama-cpp.
 * Returns null if not installed.
 * Checks both standard node resolution and global deps (~/.dexto/deps).
 */
// Using Record type for dynamic import result since we can't type node-llama-cpp at compile time
async function importNodeLlamaCpp(): Promise<Record<string, unknown> | null> {
    // Try 1: Standard node resolution (works in dev mode, dexto-project with local install)
    try {
        // @ts-ignore - Optional dependency may not be installed (TS2307 in CI)
        return await import('node-llama-cpp');
    } catch {
        // Continue to fallback
    }

    // Try 2: Global deps location (~/.dexto/deps/node_modules/node-llama-cpp)
    try {
        const globalPath = getGlobalNodeLlamaCppPath();
        // Use dynamic import with full path to entry point (ES modules don't support directory imports)
        const entryPoint = path.join(globalPath, 'dist', 'index.js');
        // @ts-ignore - Dynamic path import
        return await import(entryPoint);
    } catch {
        return null;
    }
}

/**
 * Throws an error indicating node-llama-cpp needs to be installed.
 */
export function requireNodeLlamaCpp(): never {
    throw LocalModelError.nodeLlamaNotInstalled();
}

/**
 * Configuration for the node-llama-cpp model.
 */
export interface NodeLlamaConfig {
    /** Path to the .gguf model file */
    modelPath: string;
    /** Number of GPU layers to offload (-1 = all, 0 = CPU only) */
    gpuLayers?: number;
    /** Context window size */
    contextSize?: number;
    /** Number of CPU threads */
    threads?: number;
    /** Batch size for inference */
    batchSize?: number;
    /** Whether to use Flash Attention (if available) */
    flashAttention?: boolean;
}

/**
 * Model session interface for node-llama-cpp.
 * This provides a simplified interface for text generation.
 */
export interface ModelSession {
    /** Generate a response from a prompt */
    prompt(
        text: string,
        options?: {
            maxTokens?: number;
            temperature?: number;
            topP?: number;
            signal?: AbortSignal;
            onToken?: (token: string) => void;
        }
    ): Promise<string>;

    /** Dispose the session and free resources */
    dispose(): Promise<void>;
}

/**
 * Loaded model interface.
 */
export interface LoadedModel {
    /** Model file path */
    modelPath: string;
    /** GPU info used for loading */
    gpuInfo: GPUInfo;
    /** Create a new chat session */
    createSession(): Promise<ModelSession>;
    /** Dispose the model and free resources */
    dispose(): Promise<void>;
}

// Cache for loaded models
const modelCache = new Map<string, Promise<LoadedModel>>();

/**
 * Load a GGUF model using node-llama-cpp.
 *
 * @throws {DextoRuntimeError} If node-llama-cpp is not installed
 */
export async function loadModel(config: NodeLlamaConfig): Promise<LoadedModel> {
    const { modelPath, gpuLayers = -1, contextSize, threads, batchSize = 512 } = config;

    // Check cache first
    const cacheKey = `${modelPath}:${gpuLayers}:${contextSize}`;
    const cached = modelCache.get(cacheKey);
    if (cached) {
        return cached;
    }

    // Create loading promise
    const loadPromise = (async (): Promise<LoadedModel> => {
        // Try to import node-llama-cpp
        const nodeLlama = await importNodeLlamaCpp();
        if (!nodeLlama) {
            throw LocalModelError.nodeLlamaNotInstalled();
        }

        try {
            // Detect GPU for optimal configuration
            const gpuInfo = await detectGPU();

            // Access getLlama from dynamic import (cast to function type)
            const getLlama = nodeLlama['getLlama'] as (config: {
                logLevel: unknown;
                gpu: boolean | string;
            }) => Promise<{
                loadModel: (config: { modelPath: string; gpuLayers: number | string }) => Promise<{
                    createContext: (options: Record<string, unknown>) => Promise<{
                        getSequence: () => unknown;
                        dispose: () => Promise<void>;
                    }>;
                    dispose: () => Promise<void>;
                }>;
            }>;
            const LlamaLogLevel = nodeLlama['LlamaLogLevel'] as { warn: unknown };
            const LlamaChatSession = nodeLlama['LlamaChatSession'] as new (options: {
                contextSequence: unknown;
            }) => {
                prompt: (
                    text: string,
                    options: {
                        maxTokens: number;
                        temperature: number;
                        topP: number;
                        signal?: AbortSignal;
                        stopOnAbortSignal: boolean;
                        trimWhitespaceSuffix: boolean;
                        onTextChunk?: (text: string) => void;
                    }
                ) => Promise<string>;
            };

            // Initialize llama.cpp runtime
            const llama = await getLlama({
                logLevel: LlamaLogLevel.warn,
                gpu: gpuInfo.backend === 'cpu' ? false : 'auto',
            });

            // Load the model
            const model = await llama.loadModel({
                modelPath,
                gpuLayers: gpuLayers === -1 ? 'auto' : gpuLayers,
            });

            // Create context with specified options
            // contextSize defaults to "auto" in node-llama-cpp, which uses the model's
            // training context and auto-retries with smaller sizes on failure
            const contextOptions: Record<string, unknown> = {
                batchSize,
            };
            if (contextSize !== undefined) {
                contextOptions.contextSize = contextSize;
            }
            if (threads !== undefined) {
                contextOptions.threads = threads;
            }

            const context = await model.createContext(contextOptions);

            return {
                modelPath,
                gpuInfo,
                async createSession(): Promise<ModelSession> {
                    const session = new LlamaChatSession({
                        contextSequence: context.getSequence(),
                    });

                    return {
                        async prompt(text, options = {}): Promise<string> {
                            const {
                                maxTokens = 1024,
                                temperature = 0.7,
                                topP = 0.9,
                                signal,
                                onToken,
                            } = options;

                            // Build options object, only including optional properties if defined
                            const promptOptions: {
                                maxTokens: number;
                                temperature: number;
                                topP: number;
                                stopOnAbortSignal: boolean;
                                trimWhitespaceSuffix: boolean;
                                signal?: AbortSignal;
                                onTextChunk?: (text: string) => void;
                            } = {
                                maxTokens,
                                temperature,
                                topP,
                                stopOnAbortSignal: true,
                                trimWhitespaceSuffix: true,
                            };

                            if (signal) {
                                promptOptions.signal = signal;
                            }
                            if (onToken) {
                                promptOptions.onTextChunk = onToken;
                            }

                            const response = await session.prompt(text, promptOptions);

                            return response;
                        },
                        async dispose(): Promise<void> {
                            // Session cleanup is handled by context disposal
                        },
                    };
                },
                async dispose(): Promise<void> {
                    await context.dispose();
                    await model.dispose();
                    modelCache.delete(cacheKey);
                },
            };
        } catch (error) {
            modelCache.delete(cacheKey);
            if (error instanceof Error && 'code' in error) {
                throw error; // Re-throw DextoRuntimeError
            }
            throw LocalModelError.modelLoadFailed(
                modelPath,
                error instanceof Error ? error.message : String(error)
            );
        }
    })();

    modelCache.set(cacheKey, loadPromise);
    return loadPromise;
}

/**
 * Unload a model and free resources.
 * Removes all cache entries for the given model path (across different configs).
 */
export async function unloadModel(modelPath: string): Promise<void> {
    for (const [key, loadPromise] of modelCache.entries()) {
        // Cache key format is "modelPath:gpuLayers:contextSize"
        const keyModelPath = key.split(':')[0];
        if (keyModelPath === modelPath) {
            try {
                const loaded = await loadPromise;
                await loaded.dispose();
            } catch {
                // Ignore errors during unload
            }
            modelCache.delete(key);
        }
    }
}

/**
 * Unload all models and free resources.
 */
export async function unloadAllModels(): Promise<void> {
    for (const [key, loadPromise] of modelCache.entries()) {
        try {
            const loaded = await loadPromise;
            await loaded.dispose();
        } catch {
            // Ignore errors during unload
        }
        modelCache.delete(key);
    }
}

/**
 * Check if a model is currently loaded.
 */
export function isModelLoaded(modelPath: string): boolean {
    for (const key of modelCache.keys()) {
        // Cache key format is "modelPath:gpuLayers:contextSize"
        const keyModelPath = key.split(':')[0];
        if (keyModelPath === modelPath) {
            return true;
        }
    }
    return false;
}

/**
 * Get the number of currently loaded models.
 */
export function getLoadedModelCount(): number {
    return modelCache.size;
}

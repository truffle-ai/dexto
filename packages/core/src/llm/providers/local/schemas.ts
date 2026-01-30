/**
 * Zod schemas for local model configuration validation.
 */

import { z } from 'zod';

/**
 * GPU backend options.
 */
export const GPUBackendSchema = z.enum(['metal', 'cuda', 'vulkan', 'cpu']);

/**
 * Quantization type options.
 */
export const QuantizationTypeSchema = z.enum([
    'Q2_K',
    'Q3_K_S',
    'Q3_K_M',
    'Q3_K_L',
    'Q4_0',
    'Q4_K_S',
    'Q4_K_M',
    'Q5_0',
    'Q5_K_S',
    'Q5_K_M',
    'Q6_K',
    'Q8_0',
    'F16',
    'F32',
]);

/**
 * Local model category options.
 */
export const LocalModelCategorySchema = z.enum([
    'general',
    'coding',
    'reasoning',
    'small',
    'vision',
]);

/**
 * Model source options.
 */
export const ModelSourceSchema = z.enum(['huggingface', 'ollama']);

/**
 * Model download status.
 */
export const ModelDownloadStatusSchema = z.enum([
    'pending',
    'downloading',
    'verifying',
    'complete',
    'error',
]);

/**
 * Schema for local model info (registry entry).
 */
export const LocalModelInfoSchema = z
    .object({
        id: z.string().min(1).describe('Unique model identifier'),
        name: z.string().min(1).describe('Human-readable display name'),
        description: z.string().describe('Short description of model capabilities'),
        huggingfaceId: z.string().min(1).describe('HuggingFace repository ID'),
        filename: z.string().min(1).describe('GGUF filename to download'),
        quantization: QuantizationTypeSchema.describe('Quantization level'),
        sizeBytes: z.number().int().positive().describe('File size in bytes'),
        contextLength: z.number().int().positive().describe('Maximum context window'),
        categories: z.array(LocalModelCategorySchema).describe('Model categories'),
        minVRAM: z.number().positive().optional().describe('Minimum VRAM in GB'),
        minRAM: z.number().positive().optional().describe('Minimum RAM in GB'),
        recommended: z.boolean().optional().describe('Whether model is featured'),
        author: z.string().optional().describe('Model author/organization'),
        license: z.string().optional().describe('License type'),
        supportsVision: z.boolean().optional().describe('Whether model supports images'),
        supportsTools: z.boolean().optional().describe('Whether model supports function calling'),
    })
    .strict();

/**
 * Schema for model download progress.
 */
export const ModelDownloadProgressSchema = z
    .object({
        modelId: z.string().min(1),
        status: ModelDownloadStatusSchema,
        bytesDownloaded: z.number().int().nonnegative(),
        totalBytes: z.number().int().nonnegative(),
        percentage: z.number().min(0).max(100),
        speed: z.number().nonnegative().optional(),
        eta: z.number().nonnegative().optional(),
        error: z.string().optional(),
    })
    .strict();

/**
 * Schema for GPU info.
 */
export const GPUInfoSchema = z
    .object({
        backend: GPUBackendSchema,
        available: z.boolean(),
        deviceName: z.string().optional(),
        vramMB: z.number().int().nonnegative().optional(),
        driverVersion: z.string().optional(),
    })
    .strict();

/**
 * Schema for local LLM configuration.
 */
export const LocalLLMConfigSchema = z
    .object({
        provider: z.enum(['local', 'ollama']),
        model: z.string().min(1).describe('Model ID or GGUF path'),
        gpuLayers: z.number().int().optional().describe('GPU layers (-1=auto, 0=CPU)'),
        contextSize: z.number().int().positive().optional().describe('Override context size'),
        threads: z.number().int().positive().optional().describe('CPU threads'),
        batchSize: z.number().int().positive().optional().describe('Inference batch size'),
        modelPath: z.string().optional().describe('Resolved path to model file'),
    })
    .strict();

/**
 * Schema for installed model metadata.
 */
export const InstalledModelSchema = z
    .object({
        id: z.string().min(1),
        filePath: z.string().min(1),
        sizeBytes: z.number().int().positive(),
        downloadedAt: z.string().datetime(),
        lastUsedAt: z.string().datetime().optional(),
        sha256: z.string().optional(),
        source: ModelSourceSchema,
    })
    .strict();

/**
 * Schema for model state (persisted state file).
 */
export const ModelStateSchema = z
    .object({
        version: z.string().default('1.0'),
        installed: z.record(z.string(), InstalledModelSchema).default({}),
        activeModelId: z.string().optional(),
        downloadQueue: z.array(z.string()).default([]),
    })
    .strict();

/**
 * Schema for model download options.
 */
export const ModelDownloadOptionsSchema = z
    .object({
        modelId: z.string().min(1),
        outputDir: z.string().optional(),
        showProgress: z.boolean().default(true),
        hfToken: z.string().optional(),
    })
    .strict();

/**
 * Schema for Ollama model info (from API).
 */
export const OllamaModelInfoSchema = z
    .object({
        name: z.string().min(1),
        size: z.number().int().nonnegative(),
        digest: z.string(),
        modifiedAt: z.string(),
        details: z
            .object({
                family: z.string().optional(),
                parameterSize: z.string().optional(),
                quantizationLevel: z.string().optional(),
            })
            .optional(),
    })
    .strict();

/**
 * Schema for Ollama server status.
 */
export const OllamaStatusSchema = z
    .object({
        running: z.boolean(),
        url: z.string().url(),
        version: z.string().optional(),
        models: z.array(OllamaModelInfoSchema).optional(),
        error: z.string().optional(),
    })
    .strict();

// Export inferred types for convenience
export type LocalModelInfoInput = z.input<typeof LocalModelInfoSchema>;
export type ModelDownloadProgressInput = z.input<typeof ModelDownloadProgressSchema>;
export type GPUInfoInput = z.input<typeof GPUInfoSchema>;
export type LocalLLMConfigInput = z.input<typeof LocalLLMConfigSchema>;
export type InstalledModelInput = z.input<typeof InstalledModelSchema>;
export type ModelStateInput = z.input<typeof ModelStateSchema>;

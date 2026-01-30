/**
 * Custom Models Persistence
 *
 * Manages saved custom model configurations for openai-compatible and openrouter providers.
 * Stored in ~/.dexto/models/custom-models.json
 */

import { z } from 'zod';
import { promises as fs } from 'fs';
import * as path from 'path';
import { getDextoGlobalPath } from '../utils/path.js';
import { REASONING_PRESETS } from '@dexto/core';

/** Providers that support custom models */
export const CUSTOM_MODEL_PROVIDERS = [
    'openai-compatible',
    'openrouter',
    'litellm',
    'glama',
    'bedrock',
    'ollama',
    'local',
    'vertex',
    'dexto',
] as const;
export type CustomModelProvider = (typeof CUSTOM_MODEL_PROVIDERS)[number];

/**
 * Schema for a saved custom model configuration.
 * - openai-compatible: requires baseURL, optional per-model apiKey
 * - openrouter: baseURL is auto-injected, maxInputTokens from registry
 * - litellm: requires baseURL, uses LITELLM_API_KEY or per-model override
 * - glama: fixed baseURL, uses GLAMA_API_KEY or per-model override
 * - bedrock: no baseURL, uses AWS credentials from environment
 * - ollama: optional baseURL (defaults to http://localhost:11434)
 * - local: no baseURL, uses local GGUF files via node-llama-cpp
 * - vertex: no baseURL, uses Google Cloud ADC
 * - dexto: OpenRouter gateway using Dexto credits, requires auth login, uses OpenRouter model IDs
 *
 * TODO: For hosted deployments, API keys should be stored in a secure
 * key management service (e.g., AWS Secrets Manager, HashiCorp Vault)
 * rather than in the local JSON file. Current approach is suitable for
 * local CLI usage where the file is in ~/.dexto/ (user-private).
 */
export const CustomModelSchema = z
    .object({
        name: z.string().min(1),
        provider: z.enum(CUSTOM_MODEL_PROVIDERS).default('openai-compatible'),
        baseURL: z.string().url().optional(),
        displayName: z.string().optional(),
        maxInputTokens: z.number().int().positive().optional(),
        maxOutputTokens: z.number().int().positive().optional(),
        // Optional per-model API key. For openai-compatible this is the primary key source.
        // For litellm/glama/openrouter this overrides the provider-level env var key.
        apiKey: z.string().optional(),
        // File path for local GGUF models. Required when provider is 'local'.
        // Stores the absolute path to the .gguf file on disk.
        filePath: z.string().optional(),
        reasoning: z
            .object({
                preset: z.enum(REASONING_PRESETS).default('auto'),
                budgetTokens: z.number().int().positive().optional(),
            })
            .strict()
            .optional(),
    })
    .superRefine((data, ctx) => {
        // baseURL is required for openai-compatible and litellm
        if (
            (data.provider === 'openai-compatible' || data.provider === 'litellm') &&
            !data.baseURL
        ) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                path: ['baseURL'],
                message: `Base URL is required for ${data.provider} provider`,
            });
        }
        // filePath is required for local provider
        if (data.provider === 'local' && !data.filePath) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                path: ['filePath'],
                message: 'File path is required for local provider',
            });
        }
        // filePath must end with .gguf for local provider
        if (data.provider === 'local' && data.filePath && !data.filePath.endsWith('.gguf')) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                path: ['filePath'],
                message: 'File path must be a .gguf file',
            });
        }
    });

export type CustomModel = z.output<typeof CustomModelSchema>;

const StorageSchema = z.object({
    version: z.literal(1),
    models: z.array(CustomModelSchema),
});

/**
 * Get the path to the custom models storage file.
 */
export function getCustomModelsPath(): string {
    return getDextoGlobalPath('models', 'custom-models.json');
}

/**
 * Load custom models from storage.
 */
export async function loadCustomModels(): Promise<CustomModel[]> {
    const filePath = getCustomModelsPath();

    try {
        const content = await fs.readFile(filePath, 'utf-8');
        const parsed = StorageSchema.safeParse(JSON.parse(content));
        if (!parsed.success) {
            console.warn(
                `[custom-models] Failed to parse ${filePath}: ${parsed.error.issues.map((i) => i.message).join(', ')}`
            );
            return [];
        }
        return parsed.data.models;
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
            return [];
        }
        throw error;
    }
}

/**
 * Save a custom model to storage.
 */
export async function saveCustomModel(model: CustomModel): Promise<void> {
    const parsed = CustomModelSchema.safeParse(model);
    if (!parsed.success) {
        throw new Error(`Invalid model: ${parsed.error.issues.map((i) => i.message).join(', ')}`);
    }

    const models = await loadCustomModels();
    const existingIndex = models.findIndex((m) => m.name === parsed.data.name);

    if (existingIndex >= 0) {
        models[existingIndex] = parsed.data;
    } else {
        models.push(parsed.data);
    }

    await writeCustomModels(models);
}

/**
 * Delete a custom model by name.
 */
export async function deleteCustomModel(name: string): Promise<boolean> {
    const models = await loadCustomModels();
    const filtered = models.filter((m) => m.name !== name);

    if (filtered.length === models.length) {
        return false;
    }

    await writeCustomModels(filtered);
    return true;
}

/**
 * Get a specific custom model by name.
 */
export async function getCustomModel(name: string): Promise<CustomModel | null> {
    const models = await loadCustomModels();
    return models.find((m) => m.name === name) ?? null;
}

async function writeCustomModels(models: CustomModel[]): Promise<void> {
    const filePath = getCustomModelsPath();
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, JSON.stringify({ version: 1, models }, null, 2), 'utf-8');
}

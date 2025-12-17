/**
 * Custom Models Persistence
 *
 * Manages saved openai-compatible model configurations.
 * Stored in ~/.dexto/models/custom-models.json
 */

import { z } from 'zod';
import { promises as fs } from 'fs';
import * as path from 'path';
import { getDextoGlobalPath } from '../utils/path.js';

/**
 * Schema for a saved openai-compatible model configuration.
 */
export const CustomModelSchema = z.object({
    name: z.string().min(1),
    baseURL: z.string().url(),
    displayName: z.string().optional(),
    maxInputTokens: z.number().int().positive().optional(),
    maxOutputTokens: z.number().int().positive().optional(),
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
        return parsed.success ? parsed.data.models : [];
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

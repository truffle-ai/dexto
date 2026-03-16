/**
 * Path resolver for local model storage.
 *
 * Models are stored globally at ~/.dexto/models/ to be shared across projects.
 * This avoids duplicating large model files for each project.
 */

import * as path from 'path';
import { promises as fs } from 'fs';
import { homedir } from 'os';

/**
 * Get the base models directory path.
 * Always returns global path: ~/.dexto/models/
 */
export function getModelsDirectory(): string {
    return path.join(homedir(), '.dexto', 'models');
}

/**
 * Get the path to a specific model file.
 * @param modelId Model ID from registry
 * @param filename GGUF filename
 */
export function getModelFilePath(modelId: string, filename: string): string {
    return path.join(getModelsDirectory(), modelId, filename);
}

/**
 * Get the path to a model's directory.
 * @param modelId Model ID from registry
 */
export function getModelDirectory(modelId: string): string {
    return path.join(getModelsDirectory(), modelId);
}

/**
 * Get the path to the model state file.
 * Stores download status, hashes, and usage metadata.
 */
export function getModelStatePath(): string {
    return path.join(getModelsDirectory(), 'state.json');
}

/**
 * Get the path to the model picker state file.
 * Stores recents/favorites shared by CLI and WebUI.
 */
export function getModelPickerStatePath(): string {
    return path.join(getModelsDirectory(), 'model-picker-state.json');
}

/**
 * Get the path to the model download temp directory.
 * Used for in-progress downloads.
 */
export function getModelTempDirectory(): string {
    return path.join(getModelsDirectory(), '.tmp');
}

/**
 * Ensure the models directory and subdirectories exist.
 */
export async function ensureModelsDirectory(): Promise<void> {
    const modelsDir = getModelsDirectory();
    const tempDir = getModelTempDirectory();

    await fs.mkdir(modelsDir, { recursive: true });
    await fs.mkdir(tempDir, { recursive: true });
}

/**
 * Ensure a specific model's directory exists.
 * @param modelId Model ID from registry
 */
export async function ensureModelDirectory(modelId: string): Promise<string> {
    const modelDir = getModelDirectory(modelId);
    await fs.mkdir(modelDir, { recursive: true });
    return modelDir;
}

/**
 * Check if a model file exists at the expected path.
 * @param modelId Model ID from registry
 * @param filename GGUF filename
 */
export async function modelFileExists(modelId: string, filename: string): Promise<boolean> {
    const filePath = getModelFilePath(modelId, filename);
    try {
        await fs.access(filePath);
        return true;
    } catch {
        return false;
    }
}

/**
 * Get file size of an installed model.
 * @param modelId Model ID from registry
 * @param filename GGUF filename
 * @returns File size in bytes, or null if file doesn't exist
 */
export async function getModelFileSize(modelId: string, filename: string): Promise<number | null> {
    const filePath = getModelFilePath(modelId, filename);
    try {
        const stats = await fs.stat(filePath);
        return stats.size;
    } catch {
        return null;
    }
}

/**
 * Delete a model's directory and all its files.
 * @param modelId Model ID to delete
 * @returns True if deleted, false if not found
 */
export async function deleteModelDirectory(modelId: string): Promise<boolean> {
    const modelDir = getModelDirectory(modelId);
    try {
        await fs.rm(modelDir, { recursive: true, force: true });
        return true;
    } catch {
        return false;
    }
}

/**
 * List all model directories in the models folder.
 * @returns Array of model IDs (directory names)
 */
export async function listModelDirectories(): Promise<string[]> {
    const modelsDir = getModelsDirectory();
    try {
        const entries = await fs.readdir(modelsDir, { withFileTypes: true });
        return entries.filter((e) => e.isDirectory() && !e.name.startsWith('.')).map((e) => e.name);
    } catch {
        return [];
    }
}

/**
 * Get disk usage statistics for the models directory.
 * @returns Total bytes used by models, or 0 if directory doesn't exist
 */
export async function getModelsDiskUsage(): Promise<number> {
    const modelsDir = getModelsDirectory();

    async function getDirSize(dir: string): Promise<number> {
        let size = 0;
        try {
            const entries = await fs.readdir(dir, { withFileTypes: true });
            for (const entry of entries) {
                const entryPath = path.join(dir, entry.name);
                if (entry.isDirectory()) {
                    size += await getDirSize(entryPath);
                } else if (entry.isFile()) {
                    const stats = await fs.stat(entryPath);
                    size += stats.size;
                }
            }
        } catch {
            // Ignore errors for inaccessible directories
        }
        return size;
    }

    return getDirSize(modelsDir);
}

/**
 * Format bytes to human-readable string.
 * @param bytes Number of bytes
 * @returns Formatted string (e.g., "4.5 GB")
 */
export function formatSize(bytes: number): string {
    if (bytes === 0) return '0 B';

    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    const k = 1024;
    const i = Math.floor(Math.log(bytes) / Math.log(k));

    return `${(bytes / Math.pow(k, i)).toFixed(1)} ${units[i]}`;
}

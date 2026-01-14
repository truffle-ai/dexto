/**
 * Model state manager for tracking downloaded local models.
 *
 * Persists model metadata to ~/.dexto/models/state.json including:
 * - Which models are installed
 * - File paths and sizes
 * - Download timestamps
 * - Usage tracking
 *
 * Note: ModelSource and InstalledModel types here intentionally differ from
 * packages/core/src/llm/providers/local/types.ts. This package extends the core
 * types with agent-management specific needs:
 * - ModelSource adds 'manual' for user-placed model files
 * - InstalledModel adds 'filename' for file system operations (isModelInstalled, syncStateWithFilesystem)
 */

import { promises as fs } from 'fs';
import {
    getModelStatePath,
    ensureModelsDirectory,
    modelFileExists,
    getModelFilePath,
} from './path-resolver.js';

/**
 * Source of the model download.
 */
export type ModelSource = 'huggingface' | 'manual';

/**
 * Installed model metadata.
 */
export interface InstalledModel {
    /** Model ID from registry */
    id: string;

    /** Absolute path to the .gguf file */
    filePath: string;

    /** File size in bytes */
    sizeBytes: number;

    /** When the model was downloaded (ISO timestamp) */
    downloadedAt: string;

    /** When the model was last used (ISO timestamp) */
    lastUsedAt?: string;

    /** SHA-256 hash of the file for integrity verification */
    sha256?: string;

    /** Source of the download */
    source: ModelSource;

    /** GGUF filename */
    filename: string;
}

/**
 * Persisted model state.
 */
export interface ModelState {
    /** Schema version for migrations */
    version: string;

    /** Map of model ID to installed model info */
    installed: Record<string, InstalledModel>;

    /** Currently active/selected model ID */
    activeModelId?: string;

    /** Queue of model IDs pending download */
    downloadQueue: string[];
}

const CURRENT_VERSION = '1.0';

/**
 * Create default empty state.
 */
function createDefaultState(): ModelState {
    // Note: activeModelId is intentionally omitted (not set to undefined)
    // due to exactOptionalPropertyTypes
    return {
        version: CURRENT_VERSION,
        installed: {},
        downloadQueue: [],
    };
}

/**
 * Load model state from disk.
 * Returns default state if file doesn't exist.
 */
export async function loadModelState(): Promise<ModelState> {
    const statePath = getModelStatePath();

    try {
        const content = await fs.readFile(statePath, 'utf-8');
        const state = JSON.parse(content) as ModelState;

        // Handle version migrations if needed
        if (state.version !== CURRENT_VERSION) {
            return migrateState(state);
        }

        return state;
    } catch (error) {
        // File doesn't exist or is invalid - return default
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
            return createDefaultState();
        }

        // Invalid JSON - reset to default
        console.warn('Invalid model state file, resetting to default');
        return createDefaultState();
    }
}

/**
 * Save model state to disk.
 */
export async function saveModelState(state: ModelState): Promise<void> {
    await ensureModelsDirectory();
    const statePath = getModelStatePath();
    await fs.writeFile(statePath, JSON.stringify(state, null, 2), 'utf-8');
}

/**
 * Migrate state from older versions.
 */
function migrateState(state: ModelState): ModelState {
    // Currently no migrations needed
    return {
        ...state,
        version: CURRENT_VERSION,
    };
}

/**
 * Add an installed model to state.
 *
 * Note: These operations are not atomic. Ensure single-threaded access
 * or implement file locking for concurrent usage scenarios.
 */
export async function addInstalledModel(model: InstalledModel): Promise<void> {
    const state = await loadModelState();
    state.installed[model.id] = model;
    await saveModelState(state);
}

/**
 * Remove an installed model from state.
 *
 * Note: These operations are not atomic. Ensure single-threaded access
 * or implement file locking for concurrent usage scenarios.
 */
export async function removeInstalledModel(modelId: string): Promise<boolean> {
    const state = await loadModelState();

    if (!state.installed[modelId]) {
        return false;
    }

    delete state.installed[modelId];

    // Clear active model if it was removed
    if (state.activeModelId === modelId) {
        delete state.activeModelId;
    }

    // Remove from download queue if present
    state.downloadQueue = state.downloadQueue.filter((id) => id !== modelId);

    await saveModelState(state);
    return true;
}

/**
 * Get installed model info.
 */
export async function getInstalledModel(modelId: string): Promise<InstalledModel | null> {
    const state = await loadModelState();
    return state.installed[modelId] ?? null;
}

/**
 * Get all installed models.
 */
export async function getAllInstalledModels(): Promise<InstalledModel[]> {
    const state = await loadModelState();
    return Object.values(state.installed);
}

/**
 * Check if a model is installed.
 */
export async function isModelInstalled(modelId: string): Promise<boolean> {
    const model = await getInstalledModel(modelId);
    if (!model) {
        return false;
    }

    // Verify file still exists
    return modelFileExists(modelId, model.filename);
}

/**
 * Update last used timestamp for a model.
 */
export async function updateModelLastUsed(modelId: string): Promise<void> {
    const state = await loadModelState();
    const model = state.installed[modelId];

    if (model) {
        model.lastUsedAt = new Date().toISOString();
        await saveModelState(state);
    }
}

/**
 * Set the active model.
 */
export async function setActiveModel(modelId: string | undefined): Promise<void> {
    const state = await loadModelState();
    if (modelId === undefined) {
        delete state.activeModelId;
    } else {
        state.activeModelId = modelId;
    }
    await saveModelState(state);
}

/**
 * Get the active model ID.
 */
export async function getActiveModelId(): Promise<string | undefined> {
    const state = await loadModelState();
    return state.activeModelId;
}

/**
 * Get the active model info.
 */
export async function getActiveModel(): Promise<InstalledModel | null> {
    const activeId = await getActiveModelId();
    if (!activeId) {
        return null;
    }
    return getInstalledModel(activeId);
}

/**
 * Add a model to the download queue.
 */
export async function addToDownloadQueue(modelId: string): Promise<void> {
    const state = await loadModelState();

    if (!state.downloadQueue.includes(modelId)) {
        state.downloadQueue.push(modelId);
        await saveModelState(state);
    }
}

/**
 * Remove a model from the download queue.
 */
export async function removeFromDownloadQueue(modelId: string): Promise<void> {
    const state = await loadModelState();
    state.downloadQueue = state.downloadQueue.filter((id) => id !== modelId);
    await saveModelState(state);
}

/**
 * Get the download queue.
 */
export async function getDownloadQueue(): Promise<string[]> {
    const state = await loadModelState();
    return [...state.downloadQueue];
}

/**
 * Sync state with actual filesystem.
 * Removes entries for models that no longer exist on disk.
 */
export async function syncStateWithFilesystem(): Promise<{
    removed: string[];
    kept: string[];
}> {
    const state = await loadModelState();
    const removed: string[] = [];
    const kept: string[] = [];

    for (const [modelId, model] of Object.entries(state.installed)) {
        const exists = await modelFileExists(modelId, model.filename);
        if (exists) {
            kept.push(modelId);
        } else {
            removed.push(modelId);
            delete state.installed[modelId];
        }
    }

    // Clear active model if it was removed
    if (state.activeModelId && removed.includes(state.activeModelId)) {
        delete state.activeModelId;
    }

    if (removed.length > 0) {
        await saveModelState(state);
    }

    return { removed, kept };
}

/**
 * Get total size of all installed models.
 */
export async function getTotalInstalledSize(): Promise<number> {
    const state = await loadModelState();
    return Object.values(state.installed).reduce((total, model) => total + model.sizeBytes, 0);
}

/**
 * Get count of installed models.
 */
export async function getInstalledModelCount(): Promise<number> {
    const state = await loadModelState();
    return Object.keys(state.installed).length;
}

/**
 * Register a manually added model file.
 * Used when user places a GGUF file directly in the models directory.
 */
export async function registerManualModel(
    modelId: string,
    filename: string,
    sizeBytes: number,
    sha256?: string
): Promise<void> {
    const filePath = getModelFilePath(modelId, filename);

    const model: InstalledModel = {
        id: modelId,
        filePath,
        sizeBytes,
        downloadedAt: new Date().toISOString(),
        source: 'manual',
        filename,
    };

    // Only add sha256 if provided (exactOptionalPropertyTypes)
    if (sha256 !== undefined) {
        model.sha256 = sha256;
    }

    await addInstalledModel(model);
}

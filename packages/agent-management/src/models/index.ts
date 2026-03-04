/**
 * Model management for local GGUF models.
 *
 * This module handles:
 * - Path resolution for ~/.dexto/models/
 * - State tracking for installed models
 * - Download queue management
 */

// Path resolver
export {
    getModelsDirectory,
    getModelFilePath,
    getModelDirectory,
    getModelStatePath,
    getModelPickerStatePath,
    getModelTempDirectory,
    ensureModelsDirectory,
    ensureModelDirectory,
    modelFileExists,
    getModelFileSize,
    deleteModelDirectory,
    listModelDirectories,
    getModelsDiskUsage,
    formatSize,
} from './path-resolver.js';

// State manager
export {
    type ModelSource,
    type InstalledModel,
    type ModelState,
    loadModelState,
    saveModelState,
    addInstalledModel,
    removeInstalledModel,
    getInstalledModel,
    getAllInstalledModels,
    isModelInstalled,
    updateModelLastUsed,
    setActiveModel,
    getActiveModelId,
    getActiveModel,
    addToDownloadQueue,
    removeFromDownloadQueue,
    getDownloadQueue,
    syncStateWithFilesystem,
    getTotalInstalledSize,
    getInstalledModelCount,
    registerManualModel,
} from './state-manager.js';

// Model picker state manager
export {
    MODEL_PICKER_STATE_VERSION,
    MODEL_PICKER_RECENTS_LIMIT,
    MODEL_PICKER_FAVORITES_LIMIT,
    toModelPickerKey,
    pruneModelPickerState,
    loadModelPickerState,
    saveModelPickerState,
    recordRecentModel,
    toggleFavoriteModel,
    setFavoriteModels,
    type ModelPickerModel,
    type ModelPickerEntry,
    type ModelPickerState,
    type SetFavoriteModelsInput,
} from './model-picker-state.js';

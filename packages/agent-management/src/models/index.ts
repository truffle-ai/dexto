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

/**
 * Native local model support via node-llama-cpp and Ollama.
 *
 * This module provides:
 * - Local model registry with curated GGUF models
 * - GPU detection (Metal/CUDA/Vulkan)
 * - Model downloading with progress
 * - node-llama-cpp provider for native GGUF execution
 * - Ollama provider for Ollama server integration
 */

// Types
export * from './types.js';

// Error codes and factory
export { LocalModelErrorCode } from './error-codes.js';
export { LocalModelError } from './errors.js';

// Schemas
export {
    GPUBackendSchema,
    QuantizationTypeSchema,
    LocalModelCategorySchema,
    ModelSourceSchema,
    ModelDownloadStatusSchema,
    LocalModelInfoSchema,
    ModelDownloadProgressSchema,
    GPUInfoSchema,
    LocalLLMConfigSchema,
    InstalledModelSchema,
    ModelStateSchema,
    ModelDownloadOptionsSchema,
    OllamaModelInfoSchema,
    OllamaStatusSchema,
} from './schemas.js';

// Registry
export {
    LOCAL_MODEL_REGISTRY,
    getAllLocalModels,
    getLocalModelById,
    getLocalModelsByCategory,
    getRecommendedLocalModels,
    getModelsForVRAM,
    getModelsForRAM,
    searchLocalModels,
    getDefaultLocalModelId,
} from './registry.js';

// GPU Detection
export {
    detectGPU,
    formatGPUInfo,
    isBackendAvailable,
    getAvailableBackends,
} from './gpu-detector.js';

// Downloader
export {
    downloadModel,
    downloadModelFromUrl,
    calculateFileHash,
    checkDiskSpace,
    validateDiskSpace,
    cleanupPartialDownload,
    isDownloadInProgress,
    getPartialDownloadProgress,
    type DownloadEvents,
    type DownloadOptions,
    type DownloadResult,
} from './downloader.js';

// Ollama Provider
export {
    DEFAULT_OLLAMA_URL,
    checkOllamaStatus,
    listOllamaModels,
    isOllamaModelAvailable,
    pullOllamaModel,
    createOllamaModel,
    createValidatedOllamaModel,
    getOllamaModelInfo,
    deleteOllamaModel,
    generateOllamaEmbeddings,
    type OllamaConfig,
} from './ollama-provider.js';

// node-llama-cpp Provider
export {
    isNodeLlamaCppInstalled,
    requireNodeLlamaCpp,
    loadModel,
    unloadModel,
    unloadAllModels,
    isModelLoaded,
    getLoadedModelCount,
    type NodeLlamaConfig,
    type ModelSession,
    type LoadedModel,
} from './node-llama-provider.js';

// AI SDK Adapter
export { createLocalLanguageModel, type LocalModelAdapterConfig } from './ai-sdk-adapter.js';

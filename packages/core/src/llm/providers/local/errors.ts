/**
 * Error factory for local model errors.
 * Follows the project's error factory pattern.
 */

import { DextoRuntimeError } from '../../../errors/DextoRuntimeError.js';
import { ErrorType } from '../../../errors/types.js';
import { LocalModelErrorCode } from './error-codes.js';

const SCOPE = 'local-models';

/**
 * Error factory for local model operations.
 */
export const LocalModelError = {
    // Installation errors
    nodeLlamaNotInstalled(): DextoRuntimeError {
        return new DextoRuntimeError(
            LocalModelErrorCode.NODE_LLAMA_NOT_INSTALLED,
            SCOPE,
            ErrorType.NOT_FOUND,
            'node-llama-cpp is not installed. Run `dexto setup` and select "local" provider to install it.',
            {},
            'Run `dexto setup` and select "local" provider to install local model support'
        );
    },

    nodeLlamaInstallFailed(error: string): DextoRuntimeError {
        return new DextoRuntimeError(
            LocalModelErrorCode.NODE_LLAMA_INSTALL_FAILED,
            SCOPE,
            ErrorType.THIRD_PARTY,
            `Failed to install node-llama-cpp: ${error}`,
            { error },
            'Check your Node.js version and try again. CMake may be required for your platform.'
        );
    },

    cmakeNotFound(): DextoRuntimeError {
        return new DextoRuntimeError(
            LocalModelErrorCode.CMAKE_NOT_FOUND,
            SCOPE,
            ErrorType.NOT_FOUND,
            'CMake is required to build node-llama-cpp from source but was not found.',
            {},
            'Install CMake: brew install cmake (macOS), apt install cmake (Linux), or download from cmake.org (Windows)'
        );
    },

    // Download errors
    downloadFailed(modelId: string, error: string): DextoRuntimeError {
        return new DextoRuntimeError(
            LocalModelErrorCode.DOWNLOAD_FAILED,
            SCOPE,
            ErrorType.THIRD_PARTY,
            `Failed to download model '${modelId}': ${error}`,
            { modelId, error },
            'Check your internet connection and try again'
        );
    },

    downloadInterrupted(modelId: string): DextoRuntimeError {
        return new DextoRuntimeError(
            LocalModelErrorCode.DOWNLOAD_INTERRUPTED,
            SCOPE,
            ErrorType.THIRD_PARTY,
            `Download of model '${modelId}' was interrupted`,
            { modelId },
            'Run the download command again to resume'
        );
    },

    hashMismatch(modelId: string, expected: string, actual: string): DextoRuntimeError {
        return new DextoRuntimeError(
            LocalModelErrorCode.DOWNLOAD_HASH_MISMATCH,
            SCOPE,
            ErrorType.USER,
            `Downloaded model '${modelId}' has invalid hash. Expected: ${expected}, Got: ${actual}`,
            { modelId, expected, actual },
            'Delete the file and download again'
        );
    },

    insufficientDiskSpace(modelId: string, required: number, available: number): DextoRuntimeError {
        const requiredGB = (required / (1024 * 1024 * 1024)).toFixed(1);
        const availableGB = (available / (1024 * 1024 * 1024)).toFixed(1);
        return new DextoRuntimeError(
            LocalModelErrorCode.INSUFFICIENT_DISK_SPACE,
            SCOPE,
            ErrorType.USER,
            `Insufficient disk space to download '${modelId}'. Required: ${requiredGB}GB, Available: ${availableGB}GB`,
            { modelId, required, available },
            'Free up disk space or choose a smaller model'
        );
    },

    hfAuthRequired(modelId: string): DextoRuntimeError {
        return new DextoRuntimeError(
            LocalModelErrorCode.HF_AUTH_REQUIRED,
            SCOPE,
            ErrorType.FORBIDDEN,
            `Model '${modelId}' is a gated model and requires HuggingFace authentication`,
            { modelId },
            'Set HF_TOKEN environment variable or run `huggingface-cli login`'
        );
    },

    // Model errors
    modelNotFound(modelId: string): DextoRuntimeError {
        return new DextoRuntimeError(
            LocalModelErrorCode.MODEL_NOT_FOUND,
            SCOPE,
            ErrorType.NOT_FOUND,
            `Model '${modelId}' not found in local model registry`,
            { modelId },
            'Run `dexto setup` and select "local" to see available models'
        );
    },

    modelNotDownloaded(modelId: string): DextoRuntimeError {
        return new DextoRuntimeError(
            LocalModelErrorCode.MODEL_NOT_DOWNLOADED,
            SCOPE,
            ErrorType.NOT_FOUND,
            `Model '${modelId}' is not downloaded. Download it first.`,
            { modelId },
            'Run `dexto setup` and select "local" to download models'
        );
    },

    modelLoadFailed(modelId: string, error: string): DextoRuntimeError {
        return new DextoRuntimeError(
            LocalModelErrorCode.MODEL_LOAD_FAILED,
            SCOPE,
            ErrorType.THIRD_PARTY,
            `Failed to load model '${modelId}': ${error}`,
            { modelId, error },
            'The model file may be corrupted. Try re-downloading it.'
        );
    },

    modelCorrupt(modelId: string, filePath: string): DextoRuntimeError {
        return new DextoRuntimeError(
            LocalModelErrorCode.MODEL_CORRUPT,
            SCOPE,
            ErrorType.USER,
            `Model file for '${modelId}' appears to be corrupted`,
            { modelId, filePath },
            `Delete ${filePath} and download the model again`
        );
    },

    contextTooLarge(modelId: string, requested: number, maxSupported: number): DextoRuntimeError {
        return new DextoRuntimeError(
            LocalModelErrorCode.CONTEXT_TOO_LARGE,
            SCOPE,
            ErrorType.USER,
            `Requested context size ${requested} exceeds model's maximum of ${maxSupported}`,
            { modelId, requested, maxSupported },
            `Use a context size of ${maxSupported} or less`
        );
    },

    // GPU errors
    gpuNotAvailable(): DextoRuntimeError {
        return new DextoRuntimeError(
            LocalModelErrorCode.GPU_NOT_AVAILABLE,
            SCOPE,
            ErrorType.NOT_FOUND,
            'No GPU acceleration available. Running on CPU.',
            {},
            'For better performance, ensure GPU drivers are installed'
        );
    },

    insufficientVRAM(modelId: string, required: number, available: number): DextoRuntimeError {
        return new DextoRuntimeError(
            LocalModelErrorCode.INSUFFICIENT_VRAM,
            SCOPE,
            ErrorType.USER,
            `Model '${modelId}' requires ${required}GB VRAM but only ${available}GB available`,
            { modelId, required, available },
            'Use a smaller quantization or reduce GPU layers'
        );
    },

    gpuDriverError(error: string): DextoRuntimeError {
        return new DextoRuntimeError(
            LocalModelErrorCode.GPU_DRIVER_ERROR,
            SCOPE,
            ErrorType.THIRD_PARTY,
            `GPU driver error: ${error}`,
            { error },
            'Update your GPU drivers'
        );
    },

    // Ollama errors
    ollamaNotRunning(url: string): DextoRuntimeError {
        return new DextoRuntimeError(
            LocalModelErrorCode.OLLAMA_NOT_RUNNING,
            SCOPE,
            ErrorType.THIRD_PARTY,
            `Ollama server is not running at ${url}`,
            { url },
            'Start Ollama with `ollama serve` or ensure it is running'
        );
    },

    ollamaModelNotFound(modelName: string): DextoRuntimeError {
        return new DextoRuntimeError(
            LocalModelErrorCode.OLLAMA_MODEL_NOT_FOUND,
            SCOPE,
            ErrorType.NOT_FOUND,
            `Model '${modelName}' not found on Ollama server`,
            { modelName },
            `Pull the model with \`ollama pull ${modelName}\``
        );
    },

    ollamaPullFailed(modelName: string, error: string): DextoRuntimeError {
        return new DextoRuntimeError(
            LocalModelErrorCode.OLLAMA_PULL_FAILED,
            SCOPE,
            ErrorType.THIRD_PARTY,
            `Failed to pull model '${modelName}' from Ollama: ${error}`,
            { modelName, error },
            'Check your internet connection and Ollama server status'
        );
    },

    ollamaApiError(error: string): DextoRuntimeError {
        return new DextoRuntimeError(
            LocalModelErrorCode.OLLAMA_API_ERROR,
            SCOPE,
            ErrorType.THIRD_PARTY,
            `Ollama API error: ${error}`,
            { error },
            'Check Ollama server logs for details'
        );
    },
};

/**
 * Error codes for local model operations.
 * Format: LOCAL_XXX where XXX groups by category:
 * - 001-009: Installation errors
 * - 010-019: Download errors
 * - 020-029: Model errors
 * - 030-039: GPU errors
 * - 040-049: Ollama errors
 */

export const LOCAL_MODEL_ERROR_CODES = [
    'LOCAL_001',
    'LOCAL_002',
    'LOCAL_003',
    'LOCAL_004',
    'LOCAL_010',
    'LOCAL_011',
    'LOCAL_012',
    'LOCAL_013',
    'LOCAL_014',
    'LOCAL_015',
    'LOCAL_020',
    'LOCAL_021',
    'LOCAL_022',
    'LOCAL_023',
    'LOCAL_024',
    'LOCAL_025',
    'LOCAL_030',
    'LOCAL_031',
    'LOCAL_032',
    'LOCAL_033',
    'LOCAL_034',
    'LOCAL_035',
    'LOCAL_040',
    'LOCAL_041',
    'LOCAL_042',
    'LOCAL_043',
    'LOCAL_044',
] as const;

export type LocalModelErrorCode = (typeof LOCAL_MODEL_ERROR_CODES)[number];

const LocalModelErrorCodeValues = {
    // Installation errors (001-009)
    /** node-llama-cpp package is not installed */
    NODE_LLAMA_NOT_INSTALLED: 'LOCAL_001',
    /** Failed to install node-llama-cpp */
    NODE_LLAMA_INSTALL_FAILED: 'LOCAL_002',
    /** CMake not found (required for building from source) */
    CMAKE_NOT_FOUND: 'LOCAL_003',
    /** Build from source failed */
    BUILD_FAILED: 'LOCAL_004',

    // Download errors (010-019)
    /** Model download failed */
    DOWNLOAD_FAILED: 'LOCAL_010',
    /** Download was interrupted */
    DOWNLOAD_INTERRUPTED: 'LOCAL_011',
    /** Downloaded file hash doesn't match expected */
    DOWNLOAD_HASH_MISMATCH: 'LOCAL_012',
    /** Insufficient disk space for download */
    INSUFFICIENT_DISK_SPACE: 'LOCAL_013',
    /** HuggingFace authentication required for gated model */
    HF_AUTH_REQUIRED: 'LOCAL_014',
    /** Network error during download */
    NETWORK_ERROR: 'LOCAL_015',

    // Model errors (020-029)
    /** Model not found in registry */
    MODEL_NOT_FOUND: 'LOCAL_020',
    /** Model not downloaded locally */
    MODEL_NOT_DOWNLOADED: 'LOCAL_021',
    /** Failed to load model */
    MODEL_LOAD_FAILED: 'LOCAL_022',
    /** Model file is corrupted */
    MODEL_CORRUPT: 'LOCAL_023',
    /** Invalid GGUF format */
    INVALID_GGUF: 'LOCAL_024',
    /** Model context too large for available memory */
    CONTEXT_TOO_LARGE: 'LOCAL_025',

    // GPU errors (030-039)
    /** No GPU acceleration available */
    GPU_NOT_AVAILABLE: 'LOCAL_030',
    /** Insufficient VRAM for model */
    INSUFFICIENT_VRAM: 'LOCAL_031',
    /** GPU driver error */
    GPU_DRIVER_ERROR: 'LOCAL_032',
    /** Metal not available (macOS only) */
    METAL_NOT_AVAILABLE: 'LOCAL_033',
    /** CUDA not available */
    CUDA_NOT_AVAILABLE: 'LOCAL_034',
    /** Vulkan not available */
    VULKAN_NOT_AVAILABLE: 'LOCAL_035',

    // Ollama errors (040-049)
    /** Ollama server is not running */
    OLLAMA_NOT_RUNNING: 'LOCAL_040',
    /** Model not found on Ollama server */
    OLLAMA_MODEL_NOT_FOUND: 'LOCAL_041',
    /** Failed to pull model from Ollama */
    OLLAMA_PULL_FAILED: 'LOCAL_042',
    /** Ollama API error */
    OLLAMA_API_ERROR: 'LOCAL_043',
    /** Ollama version incompatible */
    OLLAMA_VERSION_INCOMPATIBLE: 'LOCAL_044',
} as const satisfies Record<string, LocalModelErrorCode>;

export { LocalModelErrorCodeValues as LocalModelErrorCode };

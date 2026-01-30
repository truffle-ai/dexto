/**
 * Types for native local model support via node-llama-cpp and Ollama.
 */

/**
 * GPU acceleration backends supported by node-llama-cpp.
 * - metal: Apple Silicon (M1/M2/M3) via Metal API
 * - cuda: NVIDIA GPUs via CUDA
 * - vulkan: Cross-platform GPU acceleration
 * - cpu: CPU-only execution (fallback)
 */
export type GPUBackend = 'metal' | 'cuda' | 'vulkan' | 'cpu';

/**
 * Common GGUF quantization types.
 * Lower quantization = smaller file size, slightly lower quality.
 * Q4_K_M is a good balance for most use cases.
 */
export type QuantizationType =
    | 'Q2_K'
    | 'Q3_K_S'
    | 'Q3_K_M'
    | 'Q3_K_L'
    | 'Q4_0'
    | 'Q4_K_S'
    | 'Q4_K_M'
    | 'Q5_0'
    | 'Q5_K_S'
    | 'Q5_K_M'
    | 'Q6_K'
    | 'Q8_0'
    | 'F16'
    | 'F32';

/**
 * Categories for organizing local models in the UI.
 */
export type LocalModelCategory = 'general' | 'coding' | 'reasoning' | 'small' | 'vision';

/**
 * Model source - where the model can be downloaded from.
 */
export type ModelSource = 'huggingface' | 'ollama';

/**
 * Curated local model entry from the registry.
 * These are pre-vetted models with known configurations.
 */
export interface LocalModelInfo {
    /** Unique identifier (e.g., 'llama-3.3-8b-q4') */
    id: string;

    /** Human-readable display name */
    name: string;

    /** Short description of the model's capabilities */
    description: string;

    /** HuggingFace repository ID (e.g., 'bartowski/Llama-3.3-8B-Instruct-GGUF') */
    huggingfaceId: string;

    /** Filename of the GGUF file to download */
    filename: string;

    /** Quantization level */
    quantization: QuantizationType;

    /** Expected file size in bytes (for progress estimation) */
    sizeBytes: number;

    /** Maximum context window size in tokens */
    contextLength: number;

    /** Model categories for filtering */
    categories: LocalModelCategory[];

    /** Minimum VRAM required in GB (for GPU inference) */
    minVRAM?: number;

    /** Minimum RAM required in GB (for CPU inference) */
    minRAM?: number;

    /** Whether this model is recommended (featured in UI) */
    recommended?: boolean;

    /** Model author/organization */
    author?: string;

    /** License type (e.g., 'llama3.3', 'apache-2.0', 'mit') */
    license?: string;

    /** Whether model supports vision/images */
    supportsVision?: boolean;

    /** Whether model supports tool/function calling */
    supportsTools?: boolean;
}

/**
 * State of a model download.
 */
export type ModelDownloadStatus = 'pending' | 'downloading' | 'verifying' | 'complete' | 'error';

/**
 * Progress information for a model download.
 * Emitted via events during download.
 */
export interface ModelDownloadProgress {
    /** Model ID being downloaded */
    modelId: string;

    /** Current download status */
    status: ModelDownloadStatus;

    /** Bytes downloaded so far */
    bytesDownloaded: number;

    /** Total file size in bytes */
    totalBytes: number;

    /** Download progress as percentage (0-100) */
    percentage: number;

    /** Download speed in bytes per second */
    speed?: number;

    /** Estimated time remaining in seconds */
    eta?: number;

    /** Error message if status is 'error' */
    error?: string;
}

/**
 * GPU detection result.
 */
export interface GPUInfo {
    /** Detected GPU backend */
    backend: GPUBackend;

    /** Whether GPU acceleration is available */
    available: boolean;

    /** GPU device name (e.g., 'Apple M2 Pro', 'NVIDIA RTX 4090') */
    deviceName?: string;

    /** Available VRAM in megabytes */
    vramMB?: number;

    /** GPU driver version */
    driverVersion?: string;
}

/**
 * Extended LLM configuration for local models.
 * Extends the base config with local-specific options.
 */
export interface LocalLLMConfig {
    /** Provider type */
    provider: 'local' | 'ollama';

    /** Model ID from local registry or custom GGUF path */
    model: string;

    /** Number of layers to offload to GPU (-1 = auto, 0 = CPU only) */
    gpuLayers?: number;

    /** Override context size (tokens) */
    contextSize?: number;

    /** Number of CPU threads to use */
    threads?: number;

    /** Inference batch size */
    batchSize?: number;

    /** Path to model file (resolved from model ID) */
    modelPath?: string;
}

/**
 * Installed model metadata (persisted to state file).
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
}

/**
 * Model state manager state (persisted to ~/.dexto/models/state.json).
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

/**
 * Options for downloading a model.
 */
export interface ModelDownloadOptions {
    /** Model ID to download */
    modelId: string;

    /** Directory to save the model (default: ~/.dexto/models/) */
    outputDir?: string;

    /** Whether to show CLI progress (default: true) */
    showProgress?: boolean;

    /** Callback for progress updates */
    onProgress?: (progress: ModelDownloadProgress) => void;

    /** HuggingFace token for gated models */
    hfToken?: string;
}

/**
 * Result of a model download operation.
 */
export interface ModelDownloadResult {
    /** Whether download was successful */
    success: boolean;

    /** Path to the downloaded model file */
    filePath?: string;

    /** SHA-256 hash of the downloaded file */
    sha256?: string;

    /** Error message if download failed */
    error?: string;
}

/**
 * Ollama model info (from Ollama API /api/tags).
 */
export interface OllamaModelInfo {
    /** Model name (e.g., 'llama3.3:8b') */
    name: string;

    /** Model size in bytes */
    size: number;

    /** Model digest/hash */
    digest: string;

    /** When the model was last modified */
    modifiedAt: string;

    /** Model details (parameters, family, etc.) */
    details?: {
        family?: string;
        parameterSize?: string;
        quantizationLevel?: string;
    };
}

/**
 * Ollama server status.
 */
export interface OllamaStatus {
    /** Whether Ollama server is running */
    running: boolean;

    /** Ollama server URL */
    url: string;

    /** Ollama version */
    version?: string;

    /** Available models on the server */
    models?: OllamaModelInfo[];

    /** Error message if not running */
    error?: string;
}

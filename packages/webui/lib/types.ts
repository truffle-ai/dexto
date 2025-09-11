/**
 * WebUI types that extend core types for UI-specific needs
 * Now using @core imports for shared types
 */

// Import core types for local use (use package entry to avoid path drift)
import type { TextPart, ImagePart, FilePart, LLMRouter, ModelInfo } from '@dexto/core';

// Re-export core types that are commonly used in webui
export type { TextPart, ImagePart, FilePart, InternalMessage, FileData } from '@dexto/core';
export type { LLMRouter, SupportedFileType, LLMProvider, ModelInfo } from '@dexto/core';

// WebUI-specific extensions
export interface AudioPart {
    type: 'audio';
    base64: string;
    mimeType: string;
    filename?: string;
}

export type ContentPart = TextPart | ImagePart | AudioPart | FilePart;

// WebUI-specific provider catalog types
export interface ProviderCatalog {
    name: string;
    hasApiKey: boolean;
    primaryEnvVar: string;
    supportedRouters: LLMRouter[];
    supportsBaseURL: boolean;
    models: ModelInfo[];
}

export interface CatalogResponse {
    providers?: Record<string, ProviderCatalog>;
    models?: Array<ModelInfo & { provider: string }>;
}

/**
 * WebUI types that extend client SDK types for UI-specific needs.
 * Import exclusively through @dexto/client-sdk so browser bundles
 * never pull Node-centric @dexto/core modules.
 */

import type {
    TextPart,
    ImagePart,
    FilePart,
    LLMRouter,
    ModelInfo,
    CatalogProvider as SdkCatalogProvider,
    CatalogResponse as SdkCatalogResponse,
} from '@dexto/client-sdk';

// Re-export SDK types that are commonly used across the WebUI
export type {
    TextPart,
    ImagePart,
    FilePart,
    InternalMessage,
    FileData,
    LLMRouter,
    SupportedFileType,
    LLMProvider,
    CatalogOptions,
} from '@dexto/client-sdk';

// WebUI-specific extensions
export interface AudioPart {
    type: 'audio';
    base64: string;
    mimeType: string;
    filename?: string;
}

export type ContentPart = TextPart | ImagePart | AudioPart | FilePart;

export type ProviderCatalog = SdkCatalogProvider;
export type CatalogResponse = SdkCatalogResponse;

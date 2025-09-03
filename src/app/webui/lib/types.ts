/**
 * Independent WebUI types - NO @core imports for deployment separation
 * These types are WebUI-specific and don't depend on core logic
 */

// Error handling types
export interface Issue<TContext = unknown> {
    code: string;
    message: string;
    severity: 'error' | 'warning';
    context?: TContext;
    type?:
        | 'USER'
        | 'NOT_FOUND'
        | 'FORBIDDEN'
        | 'TIMEOUT'
        | 'RATE_LIMIT'
        | 'SYSTEM'
        | 'THIRD_PARTY'
        | 'UNKNOWN';
}

// Text/Content types
export interface TextPart {
    type: 'text';
    text: string;
}

export interface ImagePart {
    type: 'image';
    base64: string;
    mimeType: string;
}

export interface AudioPart {
    type: 'audio';
    base64: string;
    mimeType: string;
    filename?: string;
}

export interface FilePart {
    type: 'file';
    filename: string;
    mimeType: string;
    data: string; // base64 encoded (matches expected usage)
}

export type ContentPart = TextPart | ImagePart | AudioPart | FilePart;

// Internal message structure
export interface InternalMessage {
    id: string;
    role: 'user' | 'assistant' | 'system' | 'tool';
    content: ContentPart[];
    timestamp?: number;
    metadata?: Record<string, unknown>;
}

export interface FileData {
    base64: string;
    mimeType: string;
    filename?: string;
}

// LLM/Model types
export type LLMRouter = 'vercel' | 'in-built';

export type SupportedFileType = 'audio' | 'pdf' | 'image' | 'text';

export interface LLMProvider {
    name: string;
    hasApiKey: boolean;
    primaryEnvVar: string;
    supportedRouters: LLMRouter[];
    supportsBaseURL: boolean;
    models: ModelInfo[];
}

export interface ModelInfo {
    name: string;
    displayName?: string;
    default?: boolean;
    maxInputTokens: number;
    supportedFileTypes: SupportedFileType[];
    supportedRouters?: LLMRouter[];
    pricing?: {
        inputPerM: number;
        outputPerM: number;
        cacheReadPerM?: number;
        cacheWritePerM?: number;
        currency?: 'USD';
        unit?: 'per_million_tokens';
    };
}

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

// Utility function to convert errors
export function toError(value: unknown): Error {
    if (value instanceof Error) {
        return value;
    }
    if (typeof value === 'string') {
        return new Error(value);
    }
    return new Error(String(value));
}

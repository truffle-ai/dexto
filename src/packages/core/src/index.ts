// Browser-safe root exports
// IMPORTANT: Only export runtime-safe utilities here. Everything else should be type-only
// to avoid pulling Node-only modules (logger, storage, config, agent registry) into the browser.

// Runtime-safe utility
export { toError } from './utils/error-conversion.js';

// Type-only exports (no runtime code included in JS output)
export type { Issue, Severity, DextoErrorCode, ErrorScope, ErrorType } from './errors/types.js';

export type { InternalMessage, TextPart, ImagePart, FilePart } from './context/types.js';

export type { LLMContext, LLMUpdateContext, LLMProvider, LLMRouter } from './llm/types.js';

export type {
    McpServerConfig,
    ValidatedMcpServerConfig,
    ServerConfigs,
    ValidatedServerConfigs,
} from './mcp/schemas.js';

// Public LLM Registry API (browser-safe)
export {
    getSupportedProviders,
    getSupportedModels,
    getDefaultModelForProvider,
    getMaxInputTokensForModel,
    isValidProviderModel,
    getProviderFromModel,
    getAllSupportedModels,
    getSupportedRoutersForProvider,
    supportsBaseURL,
    requiresBaseURL,
    acceptsAnyModel,
    isRouterSupportedForProvider,
    getSupportedFileTypesForModel,
    getEffectiveMaxInputTokens,
} from './llm/registry.js';

export type { ProviderInfo, ModelInfo } from './llm/registry.js';
export type { SupportedFileType } from './llm/types.js';

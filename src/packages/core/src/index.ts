// Browser-safe root exports
// IMPORTANT: Only export runtime-safe utilities here. Everything else should be type-only
// to avoid pulling Node-only modules (logger, storage, config, agent registry) into the browser.

// Runtime-safe utility
export { toError } from './utils/error-conversion.js';

// Type-only exports (no runtime code included in JS output)
export type { Issue, Severity, DextoErrorCode, ErrorScope, ErrorType } from './errors/types.js';

export type { InternalMessage, TextPart, ImagePart, FilePart } from './context/types.js';

export type { LLMContext, LLMUpdateContext, LLMProvider, LLMRouter } from './llm/types.js';
export { LLM_PROVIDERS, LLM_ROUTERS, SUPPORTED_FILE_TYPES } from './llm/types.js';

export type {
    McpServerConfig,
    ValidatedMcpServerConfig,
    ServerConfigs,
    ValidatedServerConfigs,
} from './mcp/schemas.js';

// Public LLM Registry API
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

// Node-only convenience exports for CLI (kept at root for now)
export { DextoAgent, createAgentCard } from './agent/index.js';
export type { AgentCard } from './agent/index.js';
export { loadAgentConfig } from './config/loader.js';
export { resolveBundledScript } from './utils/path.js';
export { logger } from './logger/index.js';

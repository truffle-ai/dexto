// Browser-safe root exports
// IMPORTANT: Only export runtime-safe utilities here. Everything else should be type-only
// to avoid pulling Node-only modules (logger, storage, config, agent registry) into the browser.

// TODO: fix this properly later

// Runtime-safe utility
export { toError } from './utils/error-conversion.js';
export { zodToIssues } from './utils/result.js';
export { applyLayeredEnvironmentLoading } from './utils/env.js';
export { getDextoPath, getDextoGlobalPath, findPackageRoot, isPath } from './utils/path.js';
export { getPort } from './utils/port-utils.js';
export { getExecutionContext } from './utils/execution-context.js';
export { resolveApiKeyForProvider, getPrimaryApiKeyEnvVar } from './utils/api-key-resolver.js';
export { redactSensitiveData } from './utils/redactor.js';
export { jsonSchemaToZodShape } from './utils/zod-schema-converter.js';
export { saveProviderApiKey, getProviderKeyStatus } from './utils/api-key-store.js';

// Type-only exports (no runtime code included in JS output)
export type { Issue, Severity, DextoErrorCode, ErrorScope, ErrorType } from './errors/types.js';
export { DextoBaseError } from './errors/DextoBaseError.js';
export { DextoRuntimeError } from './errors/DextoRuntimeError.js';
export { DextoValidationError } from './errors/DextoValidationError.js';
export { ensureOk } from './errors/result-bridge.js';

export type { LLMContext, LLMUpdateContext, LLMProvider, LLMRouter } from './llm/types.js';
export { LLM_PROVIDERS, LLM_ROUTERS, SUPPORTED_FILE_TYPES } from './llm/types.js';
export { LLMErrorCode } from './llm/error-codes.js';
export { LLM_REGISTRY } from './llm/registry.js';
export { LLMUpdatesSchema } from './llm/schemas.js';
export type { LLMConfig } from './llm/schemas.js';
export { validateInputForLLM } from './llm/validation.js';

export type {
    McpServerConfig,
    ValidatedMcpServerConfig,
    ServerConfigs,
    ValidatedServerConfigs,
} from './mcp/schemas.js';
export { McpServerConfigSchema, ServerConfigsSchema } from './mcp/schemas.js';
export type { StdioServerConfig, HttpServerConfig, SseServerConfig } from './mcp/schemas.js';
export { MCPManager } from './mcp/manager.js';
export { resolveAndValidateMcpServerConfig } from './mcp/resolver.js';

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
    isRouterSupportedForModel,
    isRouterSupportedForProvider,
    getSupportedFileTypesForModel,
    getEffectiveMaxInputTokens,
} from './llm/registry.js';

export type { ProviderInfo, ModelInfo } from './llm/registry.js';
export type { SupportedFileType } from './llm/types.js';

// Node-only convenience exports for CLI (kept at root for now) because we have added browser-safe logger
export { DextoAgent, createAgentCard } from './agent/index.js';
export type { AgentCard, AgentConfig, ValidatedAgentConfig } from './agent/index.js';
export { AgentConfigSchema, AgentCardSchema } from './agent/index.js';
export { loadAgentConfig } from './config/loader.js';
export { resolveAgentPath } from './config/agent-resolver.js';
export { resolveBundledScript } from './utils/path.js';
export { logger } from './logger/index.js';
export { AgentEventBus } from './events/index.js';
export {
    loadGlobalPreferences,
    saveGlobalPreferences,
    globalPreferencesExist,
    getGlobalPreferencesPath,
    createInitialPreferences,
    updateGlobalPreferences,
} from './preferences/loader.js';
export { getAgentRegistry } from './agent/registry/registry.js';
export { AgentErrorCode } from './agent/error-codes.js';
export type { SessionMetadata } from './session/index.js';
export type { InternalMessage, TextPart, ImagePart, FilePart } from './context/types.js';
export type { AgentEventName, AgentEventMap } from './events/index.js';
export type {
    ToolConfirmationEvent,
    ToolConfirmationResponse,
    ToolConfirmationProvider,
} from './tools/confirmation/types.js';

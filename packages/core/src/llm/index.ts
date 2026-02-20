export * from './errors.js';
export * from './error-codes.js';
export * from './registry/index.js';
export * from './curation.js';
export * from './validation.js';
export * from './types.js';
export * from './auth/types.js';
export * from './services/index.js';
export * from './schemas.js';
export {
    lookupOpenRouterModel,
    refreshOpenRouterModelCache,
    getOpenRouterModelContextLength,
    getOpenRouterModelInfo,
    type LookupStatus,
    type OpenRouterModelInfo,
} from './providers/openrouter-model-registry.js';

// Node-only: self-updating models.dev/OpenRouter-backed registry cache
export {
    startLlmRegistryAutoUpdate,
    refreshLlmRegistryCache,
    loadLlmRegistryCache,
    getLlmRegistryAutoUpdateStatus,
    type LlmRegistryAutoUpdateStatus,
} from './registry/auto-update.js';

// Local model providers
export * from './providers/local/index.js';

// Agent registry
export { getAgentRegistry } from './registry/registry.js';
export type { AgentRegistry, AgentRegistryEntry, Registry } from './registry/types.js';
export { deriveDisplayName } from './registry/types.js';
export { RegistryError } from './registry/errors.js';
export { RegistryErrorCode } from './registry/error-codes.js';

// Global preferences
export {
    loadGlobalPreferences,
    saveGlobalPreferences,
    globalPreferencesExist,
    getGlobalPreferencesPath,
    createInitialPreferences,
    updateGlobalPreferences,
    type GlobalPreferencesUpdates,
} from './preferences/loader.js';
export type { GlobalPreferences } from './preferences/schemas.js';
export { PreferenceError, PreferenceErrorCode } from './preferences/errors.js';

// Agent resolver
export { resolveAgentPath, updateDefaultAgentPreference } from './resolver.js';

// Config writer
export {
    writeConfigFile,
    writeLLMPreferences,
    writePreferencesToAgent,
    type LLMOverrides,
} from './writer.js';

// Agent orchestrator
export { AgentOrchestrator } from './AgentOrchestrator.js';

// Re-export for backward compatibility
export { AgentOrchestrator as Dexto } from './AgentOrchestrator.js';

// Path utilities (duplicated from core for short-term compatibility)
export {
    getDextoPath,
    getDextoGlobalPath,
    getDextoEnvPath,
    copyDirectory,
    isPath,
    findPackageRoot,
    resolveBundledScript,
    ensureDextoGlobalDirectory,
} from './utils/path.js';
export {
    getExecutionContext,
    findDextoSourceRoot,
    findDextoProjectRoot,
    type ExecutionContext,
} from './utils/execution-context.js';
export { walkUpDirectories } from './utils/fs-walk.js';
export { updateEnvFile } from './utils/env-file.js';

// Config management utilities
export {
    updateAgentConfigFile,
    reloadAgentConfigFromFile,
    loadAgentConfig,
    enrichAgentConfig,
    deriveAgentId,
    ConfigError,
    ConfigErrorCode,
} from './config/index.js';

// API Key utilities
export {
    saveProviderApiKey,
    getProviderKeyStatus,
    listProviderKeyStatus,
} from './utils/api-key-store.js';
export {
    resolveApiKeyForProvider,
    getPrimaryApiKeyEnvVar,
    PROVIDER_API_KEY_MAP,
} from './utils/api-key-resolver.js';

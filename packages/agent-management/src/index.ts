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

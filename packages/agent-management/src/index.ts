// Agent registry
export { getAgentRegistry, loadBundledRegistryAgents } from './registry/registry.js';
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
    type CreatePreferencesOptions,
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

// Agent manager (simple registry-based lifecycle management)
export { AgentManager, type AgentMetadata } from './AgentManager.js';

// Installation utilities
export {
    installBundledAgent,
    installCustomAgent,
    uninstallAgent,
    listInstalledAgents,
    type InstallOptions,
} from './installation.js';

// Static API for agent management
export { AgentFactory, type CreateAgentOptions } from './AgentFactory.js';

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
    addPromptToAgentConfig,
    removePromptFromAgentConfig,
    deletePromptByMetadata,
    updateMcpServerField,
    removeMcpServerFromConfig,
    ConfigError,
    ConfigErrorCode,
    type FilePromptInput,
    type InlinePromptInput,
    type PromptInput,
    type PromptMetadataForDeletion,
    type PromptDeletionResult,
} from './config/index.js';

// API Key utilities
export {
    saveProviderApiKey,
    getProviderKeyStatus,
    listProviderKeyStatus,
    determineApiKeyStorage,
    SHARED_API_KEY_PROVIDERS,
    type ApiKeyStorageStrategy,
} from './utils/api-key-store.js';
export {
    resolveApiKeyForProvider,
    getPrimaryApiKeyEnvVar,
    PROVIDER_API_KEY_MAP,
} from './utils/api-key-resolver.js';

// Custom models
export {
    loadCustomModels,
    saveCustomModel,
    deleteCustomModel,
    getCustomModel,
    getCustomModelsPath,
    CustomModelSchema,
    CUSTOM_MODEL_PROVIDERS,
    type CustomModel,
    type CustomModelProvider,
} from './models/custom-models.js';

// Local model management
export {
    // Path resolver
    getModelsDirectory,
    getModelFilePath,
    getModelDirectory,
    getModelStatePath,
    getModelTempDirectory,
    ensureModelsDirectory,
    ensureModelDirectory,
    modelFileExists,
    getModelFileSize,
    deleteModelDirectory,
    listModelDirectories,
    getModelsDiskUsage,
    formatSize,
    // State manager
    type ModelSource,
    type InstalledModel,
    type ModelState,
    loadModelState,
    saveModelState,
    addInstalledModel,
    removeInstalledModel,
    getInstalledModel,
    getAllInstalledModels,
    isModelInstalled,
    updateModelLastUsed,
    setActiveModel,
    getActiveModelId,
    getActiveModel,
    addToDownloadQueue,
    removeFromDownloadQueue,
    getDownloadQueue,
    syncStateWithFilesystem,
    getTotalInstalledSize,
    getInstalledModelCount,
    registerManualModel,
} from './models/index.js';

// Multi-Agent Runtime
export * from './runtime/index.js';

// Agent Spawner Tool Provider
export * from './tool-provider/index.js';

// Claude Code Plugin Loader
export {
    // Discovery
    discoverClaudeCodePlugins,
    getPluginSearchPaths,
    // Loading
    loadClaudeCodePlugin,
    // Validation
    validatePluginDirectory,
    // Listing
    listInstalledPlugins,
    getDextoInstalledPluginsPath,
    getClaudeCodeInstalledPluginsPath,
    // Installation
    installPluginFromPath,
    loadDextoInstalledPlugins,
    saveDextoInstalledPlugins,
    isPluginInstalled,
    // Uninstallation
    uninstallPlugin,
    // Import from Claude Code
    listClaudeCodePlugins,
    importClaudeCodePlugin,
    getClaudeCodePluginsDir,
    getClaudeCodeInstalledPluginsJsonPath,
    // Schemas
    PluginManifestSchema,
    PluginMCPConfigSchema,
    // Error handling
    PluginErrorCode,
    PluginError,
    // Types
    type PluginManifest,
    type DiscoveredPlugin,
    type PluginCommand,
    type PluginMCPConfig,
    type LoadedPlugin,
    type PluginInstallScope,
    type InstalledPluginEntry,
    type InstalledPluginsFile,
    type ListedPlugin,
    type PluginValidationResult,
    type PluginInstallResult,
    type PluginUninstallResult,
    type PluginImportResult,
    type ClaudeCodePlugin,
    type ValidatedPluginManifest,
    type ValidatedPluginMCPConfig,
    type InstallPluginOptions,
    type UninstallPluginOptions,
} from './plugins/index.js';

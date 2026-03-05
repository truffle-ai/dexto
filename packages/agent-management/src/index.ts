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
export type { GlobalPreferences, AgentPreferences } from './preferences/schemas.js';
export {
    loadAgentPreferences,
    saveAgentPreferences,
    updateAgentPreferences,
    agentPreferencesExist,
    getAgentPreferencesPath,
} from './preferences/loader.js';
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
export { createDextoAgentFromConfig } from './agent-creation.js';

// Image store (global CLI image resolution)
export {
    getDefaultImageStoreDir,
    getImageRegistryPath,
    getImagePackagesDir,
    getImagePackageInstallDir,
    loadImageRegistry,
    saveImageRegistry,
    parseImageSpecifier,
    isFileLikeImageSpecifier,
    resolveFileLikeImageSpecifierToPath,
    resolveFileLikeImageSpecifierToFileUrl,
    resolveImageEntryFileFromStore,
    setActiveImageVersion,
    removeImageFromStore,
    type ImageRegistryFile,
    type ImageSpecifierParts,
} from './images/image-store.js';

// Path utilities (duplicated from core for short-term compatibility)
export {
    getDextoPackageRoot,
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
export { isDextoAuthEnabled } from './utils/feature-flags.js';
export {
    isDextoAuthenticated,
    getDextoApiKeyFromAuth,
    canUseDextoProvider,
} from './utils/dexto-auth.js';

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
    getModelPickerStatePath,
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
    MODEL_PICKER_STATE_VERSION,
    MODEL_PICKER_RECENTS_LIMIT,
    MODEL_PICKER_FAVORITES_LIMIT,
    toModelPickerKey,
    pruneModelPickerState,
    loadModelPickerState,
    saveModelPickerState,
    recordRecentModel,
    toggleFavoriteModel,
    setFavoriteModels,
    type ModelPickerModel,
    type ModelPickerEntry,
    type ModelPickerState,
    type SetFavoriteModelsInput,
} from './models/index.js';

// Multi-Agent Runtime
export * from './runtime/index.js';

// Agent Spawner Tools Factory
export * from './tool-factories/agent-spawner/index.js';
// Creator Tools Factory
export * from './tool-factories/creator-tools/index.js';

// Claude Code Plugin Loader
export {
    // Discovery
    discoverClaudeCodePlugins,
    getPluginSearchPaths,
    // Loading
    loadClaudeCodePlugin,
    // Validation
    validatePluginDirectory,
    tryLoadManifest,
    // Listing
    listInstalledPlugins,
    getDextoInstalledPluginsPath,
    // Installation
    installPluginFromPath,
    loadDextoInstalledPlugins,
    saveDextoInstalledPlugins,
    isPluginInstalled,
    // Uninstallation
    uninstallPlugin,
    // Schemas
    PluginManifestSchema,
    PluginMCPConfigSchema,
    // Error handling
    PluginErrorCode,
    PluginError,
    // Marketplace
    DEFAULT_MARKETPLACES,
    addMarketplace,
    removeMarketplace,
    updateMarketplace,
    listMarketplaces,
    listAllMarketplacePlugins,
    installPluginFromMarketplace,
    getUninstalledDefaults,
    isDefaultMarketplace,
    MarketplaceErrorCode,
    MarketplaceError,
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
    type ValidatedPluginManifest,
    type ValidatedPluginMCPConfig,
    type InstallPluginOptions,
    type UninstallPluginOptions,
    // Marketplace types
    type MarketplaceEntry,
    type MarketplacePlugin,
    type MarketplaceAddResult,
    type MarketplaceUpdateResult,
    type MarketplaceInstallResult,
} from './plugins/index.js';

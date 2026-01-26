/**
 * Plugin Marketplace Module
 *
 * Provides functionality for managing plugin marketplaces and installing
 * plugins from marketplace repositories.
 */

// Types
export type {
    MarketplaceSourceType,
    MarketplaceSource,
    MarketplaceEntry,
    KnownMarketplacesFile,
    MarketplacePlugin,
    MarketplaceAddResult,
    MarketplaceRemoveResult,
    MarketplaceUpdateResult,
    MarketplaceInstallResult,
    MarketplaceAddOptions,
    MarketplaceInstallOptions,
    MarketplaceManifest,
} from './types.js';

// Schemas
export {
    MarketplaceSourceSchema,
    MarketplaceEntrySchema,
    KnownMarketplacesFileSchema,
    MarketplaceManifestSchema,
    MarketplacePluginEntrySchema,
    MarketplaceAddCommandSchema,
    MarketplaceInstallCommandSchema,
} from './schemas.js';

// Error codes and errors
export { MarketplaceErrorCode } from './error-codes.js';
export { MarketplaceError } from './errors.js';

// Registry operations
export {
    DEFAULT_MARKETPLACES,
    getMarketplacesRegistryPath,
    getMarketplacesDir,
    getMarketplaceCacheDir,
    loadKnownMarketplaces,
    saveKnownMarketplaces,
    getMarketplaceEntry,
    marketplaceExists,
    getAllMarketplaces,
    getUninstalledDefaults,
    isDefaultMarketplace,
} from './registry.js';

// Marketplace operations
export {
    parseMarketplaceSource,
    deriveMarketplaceName,
    addMarketplace,
    removeMarketplace,
    updateMarketplace,
    listMarketplaces,
    scanMarketplacePlugins,
    listAllMarketplacePlugins,
    findPluginInMarketplaces,
} from './operations.js';

// Install from marketplace
export {
    parsePluginSpec,
    installPluginFromMarketplace,
    searchMarketplacePlugins,
} from './install-from-marketplace.js';

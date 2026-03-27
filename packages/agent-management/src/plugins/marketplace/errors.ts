import { DextoRuntimeError } from '@dexto/core';
import { MarketplaceErrorCode } from './error-codes.js';

/**
 * Marketplace error factory methods
 * Creates properly typed errors for marketplace operations
 */
export class MarketplaceError {
    // Registry errors
    static registryReadFailed(path: string, cause: string) {
        return new DextoRuntimeError(
            MarketplaceErrorCode.REGISTRY_READ_FAILED,
            'config',
            'system',
            `Failed to read marketplace registry at ${path}: ${cause}`,
            { path, cause },
            'Check file permissions and ensure the file exists'
        );
    }

    static registryWriteFailed(path: string, cause: string) {
        return new DextoRuntimeError(
            MarketplaceErrorCode.REGISTRY_WRITE_FAILED,
            'config',
            'system',
            `Failed to write marketplace registry at ${path}: ${cause}`,
            { path, cause },
            'Check file permissions and disk space'
        );
    }

    // Add marketplace errors
    static addAlreadyExists(name: string, existingPath: string) {
        return new DextoRuntimeError(
            MarketplaceErrorCode.ADD_ALREADY_EXISTS,
            'config',
            'user',
            `Marketplace '${name}' already exists at ${existingPath}`,
            { name, existingPath },
            'Use a different name or remove the existing marketplace first'
        );
    }

    static addCloneFailed(source: string, cause: string) {
        return new DextoRuntimeError(
            MarketplaceErrorCode.ADD_CLONE_FAILED,
            'config',
            'system',
            `Failed to clone marketplace from ${source}: ${cause}`,
            { source, cause },
            'Check the URL is correct and you have network access'
        );
    }

    static addInvalidSource(source: string, reason: string) {
        return new DextoRuntimeError(
            MarketplaceErrorCode.ADD_INVALID_SOURCE,
            'config',
            'user',
            `Invalid marketplace source '${source}': ${reason}`,
            { source, reason },
            'Use format: owner/repo (GitHub), git URL, or local path'
        );
    }

    static addLocalNotFound(path: string) {
        return new DextoRuntimeError(
            MarketplaceErrorCode.ADD_LOCAL_NOT_FOUND,
            'config',
            'user',
            `Local marketplace path not found: ${path}`,
            { path },
            'Check the path exists and is a directory'
        );
    }

    // Remove marketplace errors
    static removeNotFound(name: string) {
        return new DextoRuntimeError(
            MarketplaceErrorCode.REMOVE_NOT_FOUND,
            'config',
            'user',
            `Marketplace '${name}' not found`,
            { name },
            'Use `dexto plugin marketplace list` to see registered marketplaces'
        );
    }

    static removeDeleteFailed(name: string, path: string, cause: string) {
        return new DextoRuntimeError(
            MarketplaceErrorCode.REMOVE_DELETE_FAILED,
            'config',
            'system',
            `Failed to delete marketplace '${name}' at ${path}: ${cause}`,
            { name, path, cause },
            'Check file permissions'
        );
    }

    // Update marketplace errors
    static updateNotFound(name: string) {
        return new DextoRuntimeError(
            MarketplaceErrorCode.UPDATE_NOT_FOUND,
            'config',
            'user',
            `Marketplace '${name}' not found`,
            { name },
            'Use `dexto plugin marketplace list` to see registered marketplaces'
        );
    }

    static updatePullFailed(name: string, cause: string) {
        return new DextoRuntimeError(
            MarketplaceErrorCode.UPDATE_PULL_FAILED,
            'config',
            'system',
            `Failed to update marketplace '${name}': ${cause}`,
            { name, cause },
            'Check network connectivity and that the repository is accessible'
        );
    }

    static updateLocalNotSupported(name: string) {
        return new DextoRuntimeError(
            MarketplaceErrorCode.UPDATE_LOCAL_NOT_SUPPORTED,
            'config',
            'user',
            `Cannot update local marketplace '${name}'`,
            { name },
            'Local marketplaces do not support automatic updates'
        );
    }

    // Install from marketplace errors
    static installMarketplaceNotFound(marketplace: string) {
        return new DextoRuntimeError(
            MarketplaceErrorCode.INSTALL_MARKETPLACE_NOT_FOUND,
            'config',
            'user',
            `Marketplace '${marketplace}' not found`,
            { marketplace },
            'Use `dexto plugin marketplace list` to see registered marketplaces, or `dexto plugin marketplace add` to register one'
        );
    }

    static installPluginNotFound(pluginName: string, marketplace?: string) {
        const marketplaceInfo = marketplace ? ` in marketplace '${marketplace}'` : '';
        return new DextoRuntimeError(
            MarketplaceErrorCode.INSTALL_PLUGIN_NOT_FOUND,
            'config',
            'user',
            `Plugin '${pluginName}' not found${marketplaceInfo}`,
            { pluginName, marketplace },
            'Use `dexto plugin marketplace` to browse available plugins'
        );
    }

    static installCopyFailed(pluginName: string, cause: string) {
        return new DextoRuntimeError(
            MarketplaceErrorCode.INSTALL_COPY_FAILED,
            'config',
            'system',
            `Failed to copy plugin '${pluginName}' from marketplace: ${cause}`,
            { pluginName, cause },
            'Check file permissions and disk space'
        );
    }

    // Scan errors
    static scanFailed(marketplacePath: string, cause: string) {
        return new DextoRuntimeError(
            MarketplaceErrorCode.SCAN_FAILED,
            'config',
            'system',
            `Failed to scan marketplace at ${marketplacePath}: ${cause}`,
            { marketplacePath, cause },
            'Check the marketplace directory is accessible'
        );
    }
}

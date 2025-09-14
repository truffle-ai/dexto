import { DextoRuntimeError } from '@core/errors/DextoRuntimeError.js';
import { ErrorScope, ErrorType } from '@core/errors/types.js';
import { ResourceErrorCodes } from './error-codes.js';

/**
 * Resource management error factory
 * Creates properly typed errors for resource operations
 */
export class ResourceError {
    // URI format and parsing errors
    static invalidUriFormat(uri: string, expected?: string) {
        return new DextoRuntimeError(
            ResourceErrorCodes.INVALID_URI_FORMAT,
            ErrorScope.RESOURCE,
            ErrorType.USER,
            `Invalid resource URI format: '${uri}'${expected ? ` (expected ${expected})` : ''}`,
            { uri, expected },
            expected ? `Use format: ${expected}` : 'Check the resource URI format'
        );
    }

    static emptyUri() {
        return new DextoRuntimeError(
            ResourceErrorCodes.EMPTY_URI,
            ErrorScope.RESOURCE,
            ErrorType.USER,
            'Resource URI cannot be empty',
            {},
            'Provide a valid resource URI'
        );
    }

    // Resource discovery and access errors
    static resourceNotFound(uri: string) {
        return new DextoRuntimeError(
            ResourceErrorCodes.RESOURCE_NOT_FOUND,
            ErrorScope.RESOURCE,
            ErrorType.NOT_FOUND,
            `Resource not found: '${uri}'`,
            { uri },
            'Check that the resource exists and is accessible'
        );
    }

    static providerNotInitialized(providerType: string, uri: string) {
        return new DextoRuntimeError(
            ResourceErrorCodes.PROVIDER_NOT_INITIALIZED,
            ErrorScope.RESOURCE,
            ErrorType.SYSTEM,
            `${providerType} resource provider not initialized for: '${uri}'`,
            { providerType, uri },
            'Ensure the resource provider is properly configured'
        );
    }

    static providerNotAvailable(providerType: string) {
        return new DextoRuntimeError(
            ResourceErrorCodes.PROVIDER_NOT_AVAILABLE,
            ErrorScope.RESOURCE,
            ErrorType.SYSTEM,
            `${providerType} resource provider is not available`,
            { providerType },
            'Check resource provider configuration and availability'
        );
    }

    // Content access errors
    static readFailed(uri: string, reason: string) {
        return new DextoRuntimeError(
            ResourceErrorCodes.READ_FAILED,
            ErrorScope.RESOURCE,
            ErrorType.SYSTEM,
            `Failed to read resource '${uri}': ${reason}`,
            { uri, reason },
            'Check resource permissions and availability'
        );
    }

    static accessDenied(uri: string) {
        return new DextoRuntimeError(
            ResourceErrorCodes.ACCESS_DENIED,
            ErrorScope.RESOURCE,
            ErrorType.FORBIDDEN,
            `Access denied to resource: '${uri}'`,
            { uri },
            'Ensure you have permission to access this resource'
        );
    }

    // Provider coordination errors
    static noSuitableProvider(uri: string) {
        return new DextoRuntimeError(
            ResourceErrorCodes.NO_SUITABLE_PROVIDER,
            ErrorScope.RESOURCE,
            ErrorType.NOT_FOUND,
            `No suitable provider found for resource: '${uri}'`,
            { uri },
            'Check that the resource type is supported'
        );
    }

    static providerError(providerType: string, operation: string, reason: string) {
        return new DextoRuntimeError(
            ResourceErrorCodes.PROVIDER_ERROR,
            ErrorScope.RESOURCE,
            ErrorType.SYSTEM,
            `${providerType} provider failed during ${operation}: ${reason}`,
            { providerType, operation, reason },
            'Check provider configuration and logs for details'
        );
    }
}

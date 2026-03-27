import { DextoRuntimeError } from '../errors/DextoRuntimeError.js';
import { ResourceErrorCodes } from './error-codes.js';

/**
 * Resource management error factory
 * Creates properly typed errors for resource operations
 */
export class ResourceError {
    private static redactUri(uri: string): string {
        try {
            const u = new URL(uri);
            if (u.username) u.username = '***';
            if (u.password) u.password = '***';
            u.searchParams.forEach((_, k) => {
                if (/token|key|secret|sig|pwd|password/i.test(k)) u.searchParams.set(k, '***');
            });
            return u.toString();
        } catch {
            return uri
                .replace(/\/\/([^@]+)@/, '//***@')
                .replace(/((?:token|key|secret|sig|pwd|password)=)[^&]*/gi, '$1***');
        }
    }

    private static toMessageAndRaw(reason: unknown): { message: string; raw: unknown } {
        if (reason instanceof Error) {
            return {
                message: reason.message,
                raw: { name: reason.name, message: reason.message, stack: reason.stack },
            };
        }
        if (typeof reason === 'string') return { message: reason, raw: reason };
        try {
            return { message: JSON.stringify(reason), raw: reason };
        } catch {
            return { message: String(reason), raw: reason };
        }
    }
    // URI format and parsing errors
    static invalidUriFormat(uri: string, expected?: string) {
        return new DextoRuntimeError(
            ResourceErrorCodes.INVALID_URI_FORMAT,
            'resource',
            'user',
            `Invalid resource URI format: '${ResourceError.redactUri(uri)}'${expected ? ` (expected ${expected})` : ''}`,
            { uri: ResourceError.redactUri(uri), uriRaw: uri, expected },
            expected ? `Use format: ${expected}` : 'Check the resource URI format'
        );
    }

    static emptyUri() {
        return new DextoRuntimeError(
            ResourceErrorCodes.EMPTY_URI,
            'resource',
            'user',
            'Resource URI cannot be empty',
            {},
            'Provide a valid resource URI'
        );
    }

    // Resource discovery and access errors
    static resourceNotFound(uri: string) {
        return new DextoRuntimeError(
            ResourceErrorCodes.RESOURCE_NOT_FOUND,
            'resource',
            'not_found',
            `Resource not found: '${ResourceError.redactUri(uri)}'`,
            { uri: ResourceError.redactUri(uri), uriRaw: uri },
            'Check that the resource exists and is accessible'
        );
    }

    static providerNotInitialized(providerType: string, uri: string) {
        return new DextoRuntimeError(
            ResourceErrorCodes.PROVIDER_NOT_INITIALIZED,
            'resource',
            'system',
            `${providerType} resource provider not initialized for: '${ResourceError.redactUri(uri)}'`,
            { providerType, uri: ResourceError.redactUri(uri), uriRaw: uri },
            'Ensure the resource provider is properly configured'
        );
    }

    static providerNotAvailable(providerType: string) {
        return new DextoRuntimeError(
            ResourceErrorCodes.PROVIDER_NOT_AVAILABLE,
            'resource',
            'system',
            `${providerType} resource provider is not available`,
            { providerType },
            'Check resource provider configuration and availability'
        );
    }

    // Content access errors
    static readFailed(uri: string, reason: unknown) {
        const { message: reasonMsg, raw: reasonRaw } = ResourceError.toMessageAndRaw(reason);
        return new DextoRuntimeError(
            ResourceErrorCodes.READ_FAILED,
            'resource',
            'system',
            `Failed to read resource '${ResourceError.redactUri(uri)}': ${reasonMsg}`,
            { uri: ResourceError.redactUri(uri), uriRaw: uri, reason: reasonMsg, reasonRaw },
            'Check resource permissions and availability'
        );
    }

    static accessDenied(uri: string) {
        return new DextoRuntimeError(
            ResourceErrorCodes.ACCESS_DENIED,
            'resource',
            'forbidden',
            `Access denied to resource: '${ResourceError.redactUri(uri)}'`,
            { uri: ResourceError.redactUri(uri), uriRaw: uri },
            'Ensure you have permission to access this resource'
        );
    }

    // Provider coordination errors
    static noSuitableProvider(uri: string) {
        return new DextoRuntimeError(
            ResourceErrorCodes.NO_SUITABLE_PROVIDER,
            'resource',
            'not_found',
            `No suitable provider found for resource: '${ResourceError.redactUri(uri)}'`,
            { uri: ResourceError.redactUri(uri), uriRaw: uri },
            'Check that the resource type is supported'
        );
    }

    static providerError(providerType: string, operation: string, reason: unknown) {
        const { message: reasonMsg, raw: reasonRaw } = ResourceError.toMessageAndRaw(reason);
        return new DextoRuntimeError(
            ResourceErrorCodes.PROVIDER_ERROR,
            'resource',
            'system',
            `${providerType} provider failed during ${operation}: ${reasonMsg}`,
            { providerType, operation, reason: reasonMsg, reasonRaw },
            'Check provider configuration and logs for details'
        );
    }
}

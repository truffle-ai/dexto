export const ResourceErrorCodes = {
    INVALID_URI_FORMAT: 'resource_invalid_uri_format',
    EMPTY_URI: 'resource_empty_uri',
    RESOURCE_NOT_FOUND: 'resource_not_found',
    PROVIDER_NOT_INITIALIZED: 'resource_provider_not_initialized',
    PROVIDER_NOT_AVAILABLE: 'resource_provider_not_available',
    READ_FAILED: 'resource_read_failed',
    ACCESS_DENIED: 'resource_access_denied',
    NO_SUITABLE_PROVIDER: 'resource_no_suitable_provider',
    PROVIDER_ERROR: 'resource_provider_error',
} as const;

export type ResourceErrorCode = (typeof ResourceErrorCodes)[keyof typeof ResourceErrorCodes];

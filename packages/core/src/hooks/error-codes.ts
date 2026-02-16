/**
 * Hook-specific error codes.
 * Used for hook loading, validation, and execution errors.
 */
export enum HookErrorCode {
    /** Hook file not found or cannot be loaded */
    HOOK_LOAD_FAILED = 'HOOK_LOAD_FAILED',

    /** Hook does not implement required interface */
    HOOK_INVALID_SHAPE = 'HOOK_INVALID_SHAPE',

    /** Hook constructor threw an error */
    HOOK_INSTANTIATION_FAILED = 'HOOK_INSTANTIATION_FAILED',

    /** Hook initialization failed */
    HOOK_INITIALIZATION_FAILED = 'HOOK_INITIALIZATION_FAILED',

    /** Hook configuration is invalid */
    HOOK_CONFIGURATION_INVALID = 'HOOK_CONFIGURATION_INVALID',

    /** Hook execution failed */
    HOOK_EXECUTION_FAILED = 'HOOK_EXECUTION_FAILED',

    /** Hook execution timed out */
    HOOK_EXECUTION_TIMEOUT = 'HOOK_EXECUTION_TIMEOUT',

    /** Hook blocked execution */
    HOOK_BLOCKED_EXECUTION = 'HOOK_BLOCKED_EXECUTION',

    /** Duplicate hook priority */
    HOOK_DUPLICATE_PRIORITY = 'HOOK_DUPLICATE_PRIORITY',

    /** Required dependency not installed for hook loading */
    HOOK_DEPENDENCY_NOT_INSTALLED = 'HOOK_DEPENDENCY_NOT_INSTALLED',

    /** Hook provider already registered in registry */
    HOOK_PROVIDER_ALREADY_REGISTERED = 'HOOK_PROVIDER_ALREADY_REGISTERED',

    /** Hook provider not found in registry */
    HOOK_PROVIDER_NOT_FOUND = 'HOOK_PROVIDER_NOT_FOUND',

    /** Hook provider configuration validation failed */
    HOOK_PROVIDER_VALIDATION_FAILED = 'HOOK_PROVIDER_VALIDATION_FAILED',
}

export type { HookErrorCode as default };

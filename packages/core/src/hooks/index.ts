/**
 * Hook System
 *
 * Unified hook architecture for extending agent behavior at key extension points.
 */

// Core types for hook development
export type {
    Hook,
    HookExecutionContext,
    HookResult,
    HookNotice,
    ExtensionPoint,
    BeforeLLMRequestPayload,
    BeforeToolCallPayload,
    AfterToolResultPayload,
    BeforeResponsePayload,
} from './types.js';

// Hook manager for service integration
export { HookManager } from './manager.js';
export type { HookManagerOptions, HookExecutionContextOptions } from './manager.js';

// Error codes
export { HookErrorCode } from './error-codes.js';

// Built-in hooks
export { ContentPolicyHook } from './builtins/content-policy.js';
export type { ContentPolicyConfig } from './builtins/content-policy.js';
export { ResponseSanitizerHook } from './builtins/response-sanitizer.js';
export type { ResponseSanitizerConfig } from './builtins/response-sanitizer.js';

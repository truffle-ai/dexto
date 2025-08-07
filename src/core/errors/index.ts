/**
 * Main entry point for the error management system
 * Exports core types and utilities for error handling
 */

export { DextoBaseError } from './DextoBaseError.js';
export { DextoRuntimeError } from './DextoRuntimeError.js';
export { DextoValidationError } from './DextoValidationError.js';
export { ErrorScope, ErrorType, DextoErrorCode } from './types.js';
export type { Issue, Severity } from './types.js';
export { ensureOk } from './result-bridge.js';

// Re-export domain error codes for convenience
export { LLMErrorCode } from '../llm/error-codes.js';
export { AgentErrorCode } from '../agent/error-codes.js';
export { ConfigErrorCode } from '../config/error-codes.js';
export { ContextErrorCode } from '../context/error-codes.js';
export { MCPErrorCode } from '../mcp/error-codes.js';
export { ToolErrorCode } from '../tools/error-codes.js';
export { StorageErrorCode } from '../storage/error-codes.js';

// Re-export domain error factories
export { LLMError } from '../llm/errors.js';
export { ConfigError } from '../config/errors.js';
export { ContextError } from '../context/errors.js';

/**
 * Main entry point for the error management system
 * Exports core types and utilities for error handling
 */

export { DextoBaseError } from './DextoBaseError.js';
export { DextoRuntimeError } from './DextoRuntimeError.js';
export { DextoValidationError } from './DextoValidationError.js';
export { ERROR_SCOPES, ERROR_TYPES } from './types.js';
export type { ErrorScope, ErrorType, Issue, Severity, DextoErrorCode } from './types.js';
export { ensureOk } from './result-bridge.js';

/**
 * Main entry point for the error management system
 * Exports core types and utilities for error handling
 */

export { DextoError } from './DextoError.js';
export { ErrorScope, ErrorType, DextoErrorCode } from './types.js';
export type { Issue, Severity } from './types.js';
export { ensureOk } from './result-bridge.js';

// Re-export domain error codes for convenience
export { LLMErrorCode } from '../llm/error-codes.js';
export { AgentErrorCode } from '../agent/error-codes.js';
export { MCPErrorCode } from '../mcp/error-codes.js';
export { ToolErrorCode } from '../tools/error-codes.js';
export { StorageErrorCode } from '../storage/error-codes.js';

// Re-export domain error factories
export { LLMError } from '../llm/errors.js';

// Legacy error classes for backward compatibility (to be deprecated)
export abstract class ConfigurationError extends Error {
    constructor(
        message: string,
        public readonly configPath?: string
    ) {
        super(message);
        this.name = this.constructor.name;
    }
}

export class ConfigFileNotFoundError extends ConfigurationError {
    constructor(configPath: string) {
        super(`Configuration file not found: ${configPath}`, configPath);
    }
}

export class ConfigFileReadError extends ConfigurationError {
    constructor(configPath: string, cause: string) {
        super(`Failed to read configuration file: ${cause}`, configPath);
    }
}

export class ConfigParseError extends ConfigurationError {
    constructor(configPath: string, cause: string) {
        super(`Failed to parse YAML configuration: ${cause}`, configPath);
    }
}

export class ConfigValidationError extends ConfigurationError {
    constructor(
        configPath: string,
        public readonly field: string,
        public readonly validationError: string
    ) {
        super(`Configuration validation failed for '${field}': ${validationError}`, configPath);
    }
}

export class ConfigFileWriteError extends ConfigurationError {
    constructor(configPath: string, cause: string) {
        super(`Failed to write configuration file '${configPath}': ${cause}`, configPath);
        this.name = 'ConfigFileWriteError';
    }
}

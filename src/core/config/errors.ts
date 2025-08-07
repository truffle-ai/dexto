import { DextoRuntimeError } from '../errors/index.js';
import { ErrorScope, ErrorType } from '../errors/types.js';
import { ConfigErrorCode } from './error-codes.js';

/**
 * Config runtime error factory methods
 * Creates properly typed errors for configuration operations
 */
export class ConfigError {
    // File operation errors
    static fileNotFound(configPath: string) {
        return new DextoRuntimeError(
            ConfigErrorCode.FILE_NOT_FOUND,
            ErrorScope.CONFIG,
            ErrorType.USER,
            `Configuration file not found: ${configPath}`,
            { configPath },
            'Ensure the configuration file exists at the specified path'
        );
    }

    static fileReadError(configPath: string, cause: string) {
        return new DextoRuntimeError(
            ConfigErrorCode.FILE_READ_ERROR,
            ErrorScope.CONFIG,
            ErrorType.SYSTEM,
            `Failed to read configuration file: ${cause}`,
            { configPath, cause },
            'Check file permissions and ensure the file is not corrupted'
        );
    }

    static fileWriteError(configPath: string, cause: string) {
        return new DextoRuntimeError(
            ConfigErrorCode.FILE_WRITE_ERROR,
            ErrorScope.CONFIG,
            ErrorType.SYSTEM,
            `Failed to write configuration file '${configPath}': ${cause}`,
            { configPath, cause },
            'Check file permissions and available disk space'
        );
    }

    static fileAccessDenied(configPath: string) {
        return new DextoRuntimeError(
            ConfigErrorCode.FILE_ACCESS_DENIED,
            ErrorScope.CONFIG,
            ErrorType.SYSTEM,
            `Access denied to configuration file: ${configPath}`,
            { configPath },
            'Check file permissions or run with appropriate privileges'
        );
    }

    // Parsing errors
    static parseError(configPath: string, cause: string) {
        return new DextoRuntimeError(
            ConfigErrorCode.PARSE_ERROR,
            ErrorScope.CONFIG,
            ErrorType.USER,
            `Failed to parse configuration file: ${cause}`,
            { configPath, cause },
            'Ensure the configuration file contains valid YAML syntax'
        );
    }

    static yamlInvalid(configPath: string, yamlError: string) {
        return new DextoRuntimeError(
            ConfigErrorCode.YAML_INVALID,
            ErrorScope.CONFIG,
            ErrorType.USER,
            `Invalid YAML in configuration file: ${yamlError}`,
            { configPath, yamlError },
            'Fix the YAML syntax errors in the configuration file'
        );
    }

    // Path resolution errors
    static pathInvalid(path: string, reason: string) {
        return new DextoRuntimeError(
            ConfigErrorCode.PATH_INVALID,
            ErrorScope.CONFIG,
            ErrorType.USER,
            `Invalid configuration path '${path}': ${reason}`,
            { path, reason },
            'Provide a valid file path for the configuration file'
        );
    }

    static pathNotResolved(path?: string) {
        return new DextoRuntimeError(
            ConfigErrorCode.PATH_NOT_RESOLVED,
            ErrorScope.CONFIG,
            ErrorType.SYSTEM,
            'Could not resolve configuration file path',
            { providedPath: path },
            'Ensure a valid configuration path is provided or working directory contains agent.yml'
        );
    }
}

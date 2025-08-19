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
}

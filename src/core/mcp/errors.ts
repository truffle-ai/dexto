import { DextoRuntimeError } from '@core/errors/DextoRuntimeError.js';
import { ErrorScope, ErrorType } from '@core/errors/types.js';
import { MCPErrorCode } from './error-codes.js';

/**
 * MCP-specific error factory
 * Creates properly typed errors for MCP operations
 */
export class MCPError {
    /**
     * MCP server connection failed
     */
    static connectionFailed(serverName: string, reason: string) {
        return new DextoRuntimeError(
            MCPErrorCode.CONNECTION_FAILED,
            ErrorScope.MCP,
            ErrorType.THIRD_PARTY,
            `Failed to connect to MCP server '${serverName}': ${reason}`,
            { serverName, reason },
            'Check that the MCP server is running and accessible'
        );
    }

    /**
     * MCP server connection lost
     */
    static connectionLost(serverName: string, reason?: string) {
        return new DextoRuntimeError(
            MCPErrorCode.CONNECTION_LOST,
            ErrorScope.MCP,
            ErrorType.THIRD_PARTY,
            `Lost connection to MCP server '${serverName}'${reason ? `: ${reason}` : ''}`,
            { serverName, reason },
            'Check network connection and server status'
        );
    }

    /**
     * MCP protocol error
     */
    static protocolError(message: string, details?: unknown) {
        return new DextoRuntimeError(
            MCPErrorCode.PROTOCOL_ERROR,
            ErrorScope.MCP,
            ErrorType.THIRD_PARTY,
            `MCP protocol error: ${message}`,
            details,
            'Check MCP server compatibility and protocol version'
        );
    }

    /**
     * MCP validation failed
     */
    static validationFailed(message: string, details?: unknown) {
        return new DextoRuntimeError(
            MCPErrorCode.VALIDATION_FAILED,
            ErrorScope.MCP,
            ErrorType.USER,
            `MCP configuration validation failed: ${message}`,
            details,
            'Fix the configuration errors and try again'
        );
    }

    /**
     * MCP command missing
     */
    static commandMissing() {
        return new DextoRuntimeError(
            MCPErrorCode.COMMAND_MISSING,
            ErrorScope.MCP,
            ErrorType.USER,
            'Stdio server requires a non-empty command',
            undefined,
            'Provide a command for the stdio MCP server'
        );
    }

    /**
     * MCP duplicate server name
     */
    static duplicateName(name: string, existingName: string) {
        return new DextoRuntimeError(
            MCPErrorCode.DUPLICATE_NAME,
            ErrorScope.MCP,
            ErrorType.USER,
            `Server name '${name}' conflicts with existing '${existingName}'`,
            { name, existingName },
            'Use a unique name for each MCP server'
        );
    }

    /**
     * MCP initialization failed
     */
    static initializationFailed(serverName: string, reason: string) {
        return new DextoRuntimeError(
            MCPErrorCode.INITIALIZATION_FAILED,
            ErrorScope.MCP,
            ErrorType.THIRD_PARTY,
            `Failed to initialize MCP server '${serverName}': ${reason}`,
            { serverName, reason },
            'Check server configuration and logs'
        );
    }

    /**
     * MCP request timeout
     */
    static requestTimeout(serverName: string, operation: string) {
        return new DextoRuntimeError(
            MCPErrorCode.REQUEST_TIMEOUT,
            ErrorScope.MCP,
            ErrorType.TIMEOUT,
            `MCP request to '${serverName}' timed out during ${operation}`,
            { serverName, operation },
            'Increase timeout or check server responsiveness'
        );
    }
}

import { DextoRuntimeError } from '../errors/DextoRuntimeError.js';
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
            'mcp',
            'third_party',
            `Failed to connect to MCP server '${serverName}': ${reason}`,
            { serverName, reason },
            'Check that the MCP server is running and accessible'
        );
    }

    /**
     * MCP server disconnection failed
     */
    static disconnectionFailed(serverName: string, reason: string) {
        return new DextoRuntimeError(
            MCPErrorCode.DISCONNECTION_FAILED,
            'mcp',
            'system',
            `Failed to disconnect MCP server '${serverName}': ${reason}`,
            { serverName, reason },
            'Try restarting the application if the server remains in an inconsistent state'
        );
    }

    /**
     * MCP protocol error
     */
    static protocolError(message: string, details?: unknown) {
        return new DextoRuntimeError(
            MCPErrorCode.PROTOCOL_ERROR,
            'mcp',
            'third_party',
            `MCP protocol error: ${message}`,
            details,
            'Check MCP server compatibility and protocol version'
        );
    }

    /**
     * MCP authentication required
     */
    static authenticationRequired(serverName: string, reason?: string) {
        return new DextoRuntimeError(
            MCPErrorCode.AUTH_REQUIRED,
            'mcp',
            'third_party',
            `Authentication required for MCP server '${serverName}'${reason ? `: ${reason}` : ''}`,
            { serverName, reason },
            'Authenticate with the MCP server using the CLI /mcp flow'
        );
    }

    /**
     * MCP duplicate server name
     */
    static duplicateName(name: string, existingName: string) {
        return new DextoRuntimeError(
            MCPErrorCode.DUPLICATE_NAME,
            'mcp',
            'user',
            `Server name '${name}' conflicts with existing '${existingName}'`,
            { name, existingName },
            'Use a unique name for each MCP server'
        );
    }

    /**
     * MCP server not found
     */
    static serverNotFound(serverName: string, reason?: string) {
        return new DextoRuntimeError(
            MCPErrorCode.SERVER_NOT_FOUND,
            'mcp',
            'not_found',
            `MCP server '${serverName}' not found${reason ? `: ${reason}` : ''}`,
            { serverName, reason }
        );
    }

    /**
     * MCP tool not found
     */
    static toolNotFound(toolName: string) {
        return new DextoRuntimeError(
            MCPErrorCode.TOOL_NOT_FOUND,
            'mcp',
            'not_found',
            `No MCP tool found: ${toolName}`,
            { toolName }
        );
    }

    /**
     * MCP prompt not found
     */
    static promptNotFound(promptName: string) {
        return new DextoRuntimeError(
            MCPErrorCode.PROMPT_NOT_FOUND,
            'mcp',
            'not_found',
            `No client found for prompt: ${promptName}`,
            { promptName }
        );
    }

    /**
     * MCP resource not found
     */
    static resourceNotFound(resourceUri: string) {
        return new DextoRuntimeError(
            MCPErrorCode.RESOURCE_NOT_FOUND,
            'mcp',
            'not_found',
            `No client found for resource: ${resourceUri}`,
            { resourceUri }
        );
    }

    /**
     * MCP client not connected
     */
    static clientNotConnected(context?: string) {
        return new DextoRuntimeError(
            MCPErrorCode.CONNECTION_FAILED,
            'mcp',
            'system',
            `MCP client is not connected${context ? `: ${context}` : ''}`,
            { context }
        );
    }

    /**
     * Invalid tool schema
     */
    static invalidToolSchema(toolName: string, reason: string) {
        return new DextoRuntimeError(
            MCPErrorCode.PROTOCOL_ERROR,
            'mcp',
            'third_party',
            `Tool '${toolName}' has invalid schema: ${reason}`,
            { toolName, reason }
        );
    }
}

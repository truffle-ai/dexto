/**
 * MCP-specific error codes
 * Includes server configuration, connection, and protocol errors
 */
export const enum MCPErrorCode {
    // Configuration validation (used in schemas/resolver)
    SCHEMA_VALIDATION = 'mcp_schema_validation',
    COMMAND_MISSING = 'mcp_command_missing',
    SERVER_DUPLICATE_NAME = 'mcp_server_duplicate_name',

    // Connection and lifecycle
    CONNECTION_FAILED = 'mcp_connection_failed',
    DUPLICATE_NAME = 'mcp_duplicate_name',

    // Protocol errors
    PROTOCOL_ERROR = 'mcp_protocol_error',

    // Operations
    TOOL_NOT_FOUND = 'mcp_tool_not_found',
    PROMPT_NOT_FOUND = 'mcp_prompt_not_found',
    RESOURCE_NOT_FOUND = 'mcp_resource_not_found',
}

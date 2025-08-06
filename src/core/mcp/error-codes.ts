/**
 * MCP-specific error codes
 * Includes server configuration, connection, and protocol errors
 */
export const enum MCPErrorCode {
    // Configuration validation
    SCHEMA_VALIDATION = 'mcp_schema_validation',
    COMMAND_MISSING = 'mcp_command_missing',
    URL_MISSING = 'mcp_url_missing',
    URL_INVALID = 'mcp_url_invalid',
    TIMEOUT_INVALID = 'mcp_timeout_invalid',
    HEADERS_INVALID = 'mcp_headers_invalid',
    ENV_INVALID = 'mcp_env_invalid',

    // Server management
    SERVER_DUPLICATE_NAME = 'mcp_server_duplicate_name',
    SERVER_NOT_FOUND = 'mcp_server_not_found',
    SERVER_CONNECTION_FAILED = 'mcp_server_connection_failed',
    SERVER_DISCONNECTED = 'mcp_server_disconnected',

    // Protocol errors
    PROTOCOL_ERROR = 'mcp_protocol_error',
    RESPONSE_INVALID = 'mcp_response_invalid',

    // Operations
    TOOL_EXECUTION_FAILED = 'mcp_tool_execution_failed',
}

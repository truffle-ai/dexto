/**
 * MCP-specific error codes
 * Includes server configuration, connection, and protocol errors
 */

export const MCP_ERROR_CODES = [
    'mcp_schema_validation',
    'mcp_command_missing',
    'mcp_duplicate_name',
    'mcp_connection_failed',
    'mcp_disconnection_failed',
    'mcp_auth_required',
    'mcp_protocol_error',
    'mcp_server_not_found',
    'mcp_tool_not_found',
    'mcp_prompt_not_found',
    'mcp_resource_not_found',
] as const;

export type MCPErrorCode = (typeof MCP_ERROR_CODES)[number];

const MCPErrorCodeValues = {
    // Configuration validation (used in schemas/resolver)
    SCHEMA_VALIDATION: 'mcp_schema_validation',
    COMMAND_MISSING: 'mcp_command_missing',
    DUPLICATE_NAME: 'mcp_duplicate_name',

    // Connection and lifecycle
    CONNECTION_FAILED: 'mcp_connection_failed',
    DISCONNECTION_FAILED: 'mcp_disconnection_failed',
    AUTH_REQUIRED: 'mcp_auth_required',

    // Protocol errors
    PROTOCOL_ERROR: 'mcp_protocol_error',

    // Operations
    SERVER_NOT_FOUND: 'mcp_server_not_found',
    TOOL_NOT_FOUND: 'mcp_tool_not_found',
    PROMPT_NOT_FOUND: 'mcp_prompt_not_found',
    RESOURCE_NOT_FOUND: 'mcp_resource_not_found',
} as const satisfies Record<string, MCPErrorCode>;

export { MCPErrorCodeValues as MCPErrorCode };

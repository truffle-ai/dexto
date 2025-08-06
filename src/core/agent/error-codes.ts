/**
 * Agent-specific error codes
 * Includes configuration, session, and lifecycle errors
 */
export const enum AgentErrorCode {
    // Configuration
    CONFIG_INVALID_SCHEMA = 'agent_config_invalid_schema',
    CONFIG_MISSING_FIELD = 'agent_config_missing_field',
    CONFIG_FILE_NOT_FOUND = 'agent_config_file_not_found',
    CONFIG_FILE_READ_ERROR = 'agent_config_file_read_error',
    CONFIG_PARSE_ERROR = 'agent_config_parse_error',

    // Session management
    SESSION_NOT_FOUND = 'agent_session_not_found',
    SESSION_CREATION_FAILED = 'agent_session_creation_failed',
    SESSION_INVALID_STATE = 'agent_session_invalid_state',

    // Operations
    LLM_INPUT_MISSING = 'agent_llm_input_missing',
    LLM_SWITCH_FAILED = 'agent_llm_switch_failed',
    MCP_CONNECTION_FAILED = 'agent_mcp_connection_failed',
    RUN_FAILED = 'agent_run_failed',

    // Initialization
    INITIALIZATION_FAILED = 'agent_initialization_failed',
}

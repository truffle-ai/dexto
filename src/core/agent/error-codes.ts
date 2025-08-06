/**
 * Agent-specific error codes
 * Includes agent configuration and lifecycle errors only
 * Domain-specific errors (LLM, Session, MCP, etc.) belong in their respective modules
 */
export const enum AgentErrorCode {
    // Configuration
    CONFIG_INVALID_SCHEMA = 'agent_config_invalid_schema',
    CONFIG_MISSING_FIELD = 'agent_config_missing_field',
    CONFIG_FILE_NOT_FOUND = 'agent_config_file_not_found',
    CONFIG_FILE_READ_ERROR = 'agent_config_file_read_error',
    CONFIG_PARSE_ERROR = 'agent_config_parse_error',
    CONFIG_INVALID = 'agent_config_invalid',

    // Lifecycle
    NOT_STARTED = 'agent_not_started',
    INITIALIZATION_FAILED = 'agent_initialization_failed',

    // Agent operations
    RUN_FAILED = 'agent_run_failed',
}

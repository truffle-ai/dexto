/**
 * Agent-specific error codes
 * Includes agent configuration and lifecycle errors only
 * Domain-specific errors (LLM, Session, MCP, etc.) belong in their respective modules
 */

export const AGENT_ERROR_CODES = [
    'agent_not_started',
    'agent_already_started',
    'agent_stopped',
    'agent_initialization_failed',
    'agent_switch_in_progress',
    'agent_session_busy',
    'agent_no_config_path',
    'agent_invalid_config',
    'agent_api_validation_error',
    'agent_stream_failed',
] as const;

export type AgentErrorCode = (typeof AGENT_ERROR_CODES)[number];

const AgentErrorCodeValues = {
    // Lifecycle
    NOT_STARTED: 'agent_not_started',
    ALREADY_STARTED: 'agent_already_started',
    STOPPED: 'agent_stopped',
    INITIALIZATION_FAILED: 'agent_initialization_failed',
    SWITCH_IN_PROGRESS: 'agent_switch_in_progress',
    SESSION_BUSY: 'agent_session_busy',

    // Configuration
    NO_CONFIG_PATH: 'agent_no_config_path',
    INVALID_CONFIG: 'agent_invalid_config',

    // API layer
    API_VALIDATION_ERROR: 'agent_api_validation_error',

    // Runtime
    STREAM_FAILED: 'agent_stream_failed',
} as const satisfies Record<string, AgentErrorCode>;

export { AgentErrorCodeValues as AgentErrorCode };

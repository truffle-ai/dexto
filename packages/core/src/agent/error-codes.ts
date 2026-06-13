/**
 * Agent-specific error codes
 * Includes agent configuration and lifecycle errors only
 * Domain-specific errors (LLM, Session, MCP, etc.) belong in their respective modules
 */

export const AgentErrorCode = {
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
} as const;

// eslint-disable-next-line @typescript-eslint/no-redeclare
export type AgentErrorCode = (typeof AgentErrorCode)[keyof typeof AgentErrorCode];

export const AGENT_ERROR_CODES = Object.values(AgentErrorCode) as readonly AgentErrorCode[];

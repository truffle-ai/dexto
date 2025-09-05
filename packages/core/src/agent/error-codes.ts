/**
 * Agent-specific error codes
 * Includes agent configuration and lifecycle errors only
 * Domain-specific errors (LLM, Session, MCP, etc.) belong in their respective modules
 */
export enum AgentErrorCode {
    // Lifecycle
    NOT_STARTED = 'agent_not_started',
    ALREADY_STARTED = 'agent_already_started',
    STOPPED = 'agent_stopped',
    INITIALIZATION_FAILED = 'agent_initialization_failed',

    // API layer
    API_VALIDATION_ERROR = 'agent_api_validation_error',
}

/**
 * Agent-specific error codes
 * Includes agent configuration and lifecycle errors only
 * Domain-specific errors (LLM, Session, MCP, etc.) belong in their respective modules
 */
export enum AgentErrorCode {
    // Lifecycle
    NOT_STARTED = 'agent_not_started',
    INITIALIZATION_FAILED = 'agent_initialization_failed',
}

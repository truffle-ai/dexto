/**
 * Error scopes representing functional domains in the system
 * Each scope owns its validation and error logic
 */
export const enum ErrorScope {
    LLM = 'llm', // LLM operations, model compatibility, input validation for LLMs
    AGENT = 'agent', // Agent lifecycle, configuration, session management
    MCP = 'mcp', // MCP server connections and protocol
    TOOLS = 'tools', // Tool execution and authorization
    STORAGE = 'storage', // Persistence layer operations
    // Note: No VALIDATION scope - validation errors belong to their domain
}

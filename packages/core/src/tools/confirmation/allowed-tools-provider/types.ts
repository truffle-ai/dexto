/**
 * Interface for session-scoped allowed tool storage (in-memory, DB, etc.).
 *
 * Implementations persist and query remembered tool approvals by `sessionId`.
 * Every method requires an explicit non-empty session ID so approvals cannot
 * leak across sessions.
 */
export type AllowedToolsProvider = {
    /**
     * Persist an approval for a tool within a session.
     */
    allowTool(toolName: string, sessionId: string): Promise<void>;

    /** Remove an approval. */
    disallowTool(toolName: string, sessionId: string): Promise<void>;

    /**
     * Check whether the given tool is currently allowed within the session.
     */
    isToolAllowed(toolName: string, sessionId: string): Promise<boolean>;

    /** Optional helper to introspect all approvals for debugging. */
    getAllowedTools?(sessionId: string): Promise<Set<string>>;
};

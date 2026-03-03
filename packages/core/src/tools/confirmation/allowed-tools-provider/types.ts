/**
 * Interface for allowed tools storage (in-memory, DB, etc.)
 *
 * Multi-user support: For multi-tenancy, we can consider either:
 *  - Instantiating a provider per user (current pattern, recommended for most cases)
 *  - Or, add userId as a parameter to each method for batch/admin/multi-user operations:
 *      allowTool(toolName: string, userId: string): Promise<void>
 *      ...etc.
 *  - You can also add static/factory methods to create user-scoped providers, e.g.,
 *      AllowedToolsProvider.forUser(userId)
 *
 * AllowedToolsProvider supports both single-user and multi-user scenarios.
 * - If `userId` is omitted, the implementation will use a configured default user id.
 * - For multi-user/admin scenarios, always pass `userId` explicitly.
 * - We can enforce this by having a separate env variable/feature-flag for multi-user and having
 *   strict check for the user id if the feature flag is set.
 */
export type AllowedToolsProvider = {
    /**
     * Persist an approval for a tool. If `sessionId` is provided the approval is
     * scoped to that session. When omitted the approval is treated as global.
     */
    allowTool(toolName: string, sessionId?: string): Promise<void>;

    /** Remove an approval. */
    disallowTool(toolName: string, sessionId?: string): Promise<void>;

    /**
     * Check whether the given tool is currently allowed. If `sessionId` is
     * provided the session-scoped list is checked first, then any global entry.
     */
    isToolAllowed(toolName: string, sessionId?: string): Promise<boolean>;

    /** Optional helper to introspect all approvals for debugging. */
    getAllowedTools?(sessionId?: string): Promise<Set<string>>;
};

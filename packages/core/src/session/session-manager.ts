import { randomUUID } from 'crypto';
import { ChatSession } from './chat-session.js';
import { SystemPromptManager } from '../systemPrompt/manager.js';
import { ToolManager } from '../tools/tool-manager.js';
import { AgentEventBus } from '../events/index.js';
import { logger } from '../logger/index.js';
import type { AgentStateManager } from '../agent/state-manager.js';
import type { ValidatedLLMConfig } from '@core/llm/schemas.js';
import type { StorageManager } from '../storage/index.js';
import type { PluginManager } from '../plugins/manager.js';
import { SessionError } from './errors.js';

export interface SessionMetadata {
    createdAt: number;
    lastActivity: number;
    messageCount: number;
    title?: string;
    // Additional metadata for session management
}

export interface SessionManagerConfig {
    maxSessions?: number;
    sessionTTL?: number;
}

export interface SessionData {
    id: string;
    userId?: string;
    createdAt: number;
    lastActivity: number;
    messageCount: number;
    metadata?: Record<string, any>;
}

/**
 * Manages multiple chat sessions within a Dexto agent.
 *
 * The SessionManager is responsible for:
 * - Creating and managing multiple isolated chat sessions
 * - Enforcing session limits and TTL policies
 * - Cleaning up expired sessions
 * - Providing session lifecycle management
 * - Persisting session data using the simplified storage backends
 */
export class SessionManager {
    private sessions: Map<string, ChatSession> = new Map();
    private readonly maxSessions: number;
    private readonly sessionTTL: number;
    private initialized = false;
    private cleanupInterval?: NodeJS.Timeout;
    private initializationPromise!: Promise<void>;
    // Add a Map to track ongoing session creation operations to prevent race conditions
    private readonly pendingCreations = new Map<string, Promise<ChatSession>>();

    constructor(
        private services: {
            stateManager: AgentStateManager;
            systemPromptManager: SystemPromptManager;
            toolManager: ToolManager;
            agentEventBus: AgentEventBus;
            storageManager: StorageManager;
            resourceManager: import('../resources/index.js').ResourceManager;
            pluginManager: PluginManager;
            mcpManager: import('../mcp/manager.js').MCPManager;
        },
        config: SessionManagerConfig = {}
    ) {
        this.maxSessions = config.maxSessions ?? 100;
        this.sessionTTL = config.sessionTTL ?? 3600000; // 1 hour
    }

    /**
     * Initialize the SessionManager with persistent storage.
     * This must be called before using any session operations.
     */
    public async init(): Promise<void> {
        if (this.initialized) {
            return;
        }

        // Restore any existing sessions from storage
        await this.restoreSessionsFromStorage();

        // Start periodic cleanup to prevent memory leaks from long-lived sessions
        // Clean up every 15 minutes or 1/4 of session TTL, whichever is smaller
        const cleanupIntervalMs = Math.min(this.sessionTTL / 4, 15 * 60 * 1000);
        this.cleanupInterval = setInterval(
            () =>
                this.cleanupExpiredSessions().catch((err) =>
                    logger.error(`Periodic session cleanup failed: ${err}`)
                ),
            cleanupIntervalMs
        );

        this.initialized = true;
        logger.debug(
            `SessionManager initialized with periodic cleanup every ${Math.round(cleanupIntervalMs / 1000 / 60)} minutes`
        );
    }

    /**
     * Restore sessions from persistent storage on startup.
     * This allows sessions to survive application restarts.
     */
    private async restoreSessionsFromStorage(): Promise<void> {
        try {
            // Use the database backend to list sessions with the 'session:' prefix
            const sessionKeys = await this.services.storageManager.getDatabase().list('session:');
            logger.debug(`Found ${sessionKeys.length} persisted sessions to restore`);

            for (const sessionKey of sessionKeys) {
                const sessionId = sessionKey.replace('session:', '');
                const sessionData = await this.services.storageManager
                    .getDatabase()
                    .get<SessionData>(sessionKey);

                if (sessionData) {
                    // Check if session is still valid (not expired)
                    const now = Date.now();
                    const lastActivity = sessionData.lastActivity;

                    if (now - lastActivity <= this.sessionTTL) {
                        // Session is still valid, but don't create ChatSession until requested
                        logger.debug(`Session ${sessionId} restored from storage`);
                    } else {
                        // Session expired, clean it up
                        await this.services.storageManager.getDatabase().delete(sessionKey);
                        logger.debug(`Expired session ${sessionId} cleaned up during restore`);
                    }
                }
            }
        } catch (error) {
            logger.error(
                `Failed to restore sessions from storage: ${error instanceof Error ? error.message : String(error)}`
            );
            // Continue without restored sessions
        }
    }

    /**
     * Ensures the SessionManager is initialized before operations.
     */
    private async ensureInitialized(): Promise<void> {
        if (!this.initialized) {
            if (!this.initializationPromise) {
                this.initializationPromise = this.init();
            }
            await this.initializationPromise;
        }
    }

    /**
     * Creates a new chat session or returns an existing one.
     *
     * @param sessionId Optional session ID. If not provided, a UUID will be generated.
     * @returns The created or existing ChatSession
     * @throws Error if maximum sessions limit is reached
     */
    public async createSession(sessionId?: string): Promise<ChatSession> {
        await this.ensureInitialized();

        const id = sessionId ?? randomUUID();

        // Check if there's already a pending creation for this session ID
        if (this.pendingCreations.has(id)) {
            return await this.pendingCreations.get(id)!;
        }

        // Check if session already exists in memory
        if (this.sessions.has(id)) {
            await this.updateSessionActivity(id);
            return this.sessions.get(id)!;
        }

        // Create a promise for the session creation and track it to prevent concurrent operations
        const creationPromise = this.createSessionInternal(id);
        this.pendingCreations.set(id, creationPromise);

        try {
            const session = await creationPromise;
            return session;
        } finally {
            // Always clean up the pending creation tracker
            this.pendingCreations.delete(id);
        }
    }

    /**
     * Internal method that handles the actual session creation logic.
     * This method implements atomic session creation to prevent race conditions.
     */
    private async createSessionInternal(id: string): Promise<ChatSession> {
        // Clean up expired sessions first
        await this.cleanupExpiredSessions();

        // Check if session exists in storage (could have been created by another process)
        const sessionKey = `session:${id}`;
        const existingMetadata = await this.services.storageManager
            .getDatabase()
            .get<SessionData>(sessionKey);
        if (existingMetadata) {
            // Session exists in storage, restore it
            await this.updateSessionActivity(id);
            const session = new ChatSession({ ...this.services, sessionManager: this }, id);
            await session.init();
            this.sessions.set(id, session);
            logger.info(`Restored session from storage: ${id}`, null, 'cyan');
            return session;
        }

        // Perform atomic session limit check and creation
        // This ensures the limit check and session creation happen as close to atomically as possible
        const activeSessionKeys = await this.services.storageManager.getDatabase().list('session:');
        if (activeSessionKeys.length >= this.maxSessions) {
            throw SessionError.maxSessionsExceeded(activeSessionKeys.length, this.maxSessions);
        }

        // Create new session metadata first to "reserve" the session slot
        const sessionData: SessionData = {
            id,
            createdAt: Date.now(),
            lastActivity: Date.now(),
            messageCount: 0,
        };

        // Store session metadata in persistent storage immediately to claim the session
        try {
            await this.services.storageManager.getDatabase().set(sessionKey, sessionData);
        } catch (error) {
            // If storage fails, another concurrent creation might have succeeded
            logger.error(`Failed to store session metadata for ${id}:`, error);
            // Re-throw the original error to maintain test compatibility
            throw error;
        }

        // Now create the actual session object
        let session: ChatSession;
        try {
            session = new ChatSession({ ...this.services, sessionManager: this }, id);
            await session.init();
            this.sessions.set(id, session);

            // Also store in cache with TTL for faster access
            await this.services.storageManager
                .getCache()
                .set(sessionKey, sessionData, this.sessionTTL / 1000);

            logger.info(`Created new session: ${id}`, null, 'green');
            return session;
        } catch (error) {
            // If session creation fails after we've claimed the slot, clean up the metadata
            logger.error(
                `Failed to initialize session ${id}: ${error instanceof Error ? error.message : String(error)}`
            );
            await this.services.storageManager.getDatabase().delete(sessionKey);
            await this.services.storageManager.getCache().delete(sessionKey);
            const reason = error instanceof Error ? error.message : 'unknown error';
            throw SessionError.initializationFailed(id, reason);
        }
    }

    /**
     * Gets or creates the default session.
     * This is used for backward compatibility with single-session operations.
     *
     * @returns The default ChatSession (creates one if it doesn't exist)
     */
    public async getDefaultSession(): Promise<ChatSession> {
        const defaultSessionId = 'default';
        return await this.createSession(defaultSessionId);
    }

    /**
     * Retrieves an existing session by ID.
     *
     * @param sessionId The session ID to retrieve
     * @param restoreFromStorage Whether to restore from storage if not in memory (default: true)
     * @returns The ChatSession if found, undefined otherwise
     */
    public async getSession(
        sessionId: string,
        restoreFromStorage: boolean = true
    ): Promise<ChatSession | undefined> {
        await this.ensureInitialized();

        // Check if there's a pending creation for this session ID
        if (this.pendingCreations.has(sessionId)) {
            return await this.pendingCreations.get(sessionId)!;
        }

        // Check memory first
        if (this.sessions.has(sessionId)) {
            return this.sessions.get(sessionId)!;
        }

        // Conditionally check storage if restoreFromStorage is true
        if (restoreFromStorage) {
            const sessionKey = `session:${sessionId}`;
            const sessionData = await this.services.storageManager
                .getDatabase()
                .get<SessionData>(sessionKey);
            if (sessionData) {
                // Restore session to memory
                const session = new ChatSession(
                    { ...this.services, sessionManager: this },
                    sessionId
                );
                await session.init();
                this.sessions.set(sessionId, session);
                return session;
            }
        }

        return undefined;
    }

    /**
     * Ends a session by removing it from memory without deleting conversation history.
     * Used for cleanup, agent shutdown, and session expiry.
     *
     * @param sessionId The session ID to end
     */
    public async endSession(sessionId: string): Promise<void> {
        await this.ensureInitialized();

        // Remove from memory only - preserve conversation history in storage
        const session = this.sessions.get(sessionId);
        if (session) {
            await session.cleanup(); // Clean up memory resources only
            this.sessions.delete(sessionId);
        }

        // Remove from cache but preserve database storage
        const sessionKey = `session:${sessionId}`;
        await this.services.storageManager.getCache().delete(sessionKey);

        logger.debug(`Ended session (removed from memory, chat history preserved): ${sessionId}`);
    }

    /**
     * Deletes a session and its conversation history, removing everything from memory and storage.
     * Used for user-initiated permanent deletion.
     *
     * @param sessionId The session ID to delete
     */
    public async deleteSession(sessionId: string): Promise<void> {
        await this.ensureInitialized();

        // Get session (load from storage if not in memory) to clear conversation history
        const session = await this.getSession(sessionId);
        if (session) {
            await session.reset(); // This deletes the conversation history
            await session.cleanup(); // This cleans up memory resources
            this.sessions.delete(sessionId);
        }

        // Remove session metadata from storage
        const sessionKey = `session:${sessionId}`;
        await this.services.storageManager.getDatabase().delete(sessionKey);
        await this.services.storageManager.getCache().delete(sessionKey);

        logger.debug(`Deleted session and conversation history: ${sessionId}`);
    }

    /**
     * Resets the conversation history for a session while keeping the session alive.
     *
     * @param sessionId The session ID to reset
     * @throws Error if session doesn't exist
     */
    public async resetSession(sessionId: string): Promise<void> {
        await this.ensureInitialized();

        const session = await this.getSession(sessionId);
        if (!session) {
            throw SessionError.notFound(sessionId);
        }

        await session.reset();

        // Reset message count in metadata
        const sessionKey = `session:${sessionId}`;
        const sessionData = await this.services.storageManager
            .getDatabase()
            .get<SessionData>(sessionKey);
        if (sessionData) {
            sessionData.messageCount = 0;
            sessionData.lastActivity = Date.now();
            await this.services.storageManager.getDatabase().set(sessionKey, sessionData);
            // Update cache as well
            await this.services.storageManager
                .getCache()
                .set(sessionKey, sessionData, this.sessionTTL / 1000);
        }

        logger.debug(`Reset session conversation: ${sessionId}`);
    }

    /**
     * Lists all active session IDs.
     *
     * @returns Array of active session IDs
     */
    public async listSessions(): Promise<string[]> {
        await this.ensureInitialized();
        const sessionKeys = await this.services.storageManager.getDatabase().list('session:');
        return sessionKeys.map((key) => key.replace('session:', ''));
    }

    /**
     * Gets metadata for a specific session.
     *
     * @param sessionId The session ID
     * @returns Session metadata if found, undefined otherwise
     */
    public async getSessionMetadata(sessionId: string): Promise<SessionMetadata | undefined> {
        await this.ensureInitialized();
        const sessionKey = `session:${sessionId}`;
        const sessionData = await this.services.storageManager
            .getDatabase()
            .get<SessionData>(sessionKey);
        return sessionData
            ? {
                  createdAt: sessionData.createdAt,
                  lastActivity: sessionData.lastActivity,
                  messageCount: sessionData.messageCount,
                  title: sessionData.metadata?.title,
              }
            : undefined;
    }

    /**
     * Get the global session manager configuration.
     */
    public getConfig(): SessionManagerConfig {
        return {
            maxSessions: this.maxSessions,
            sessionTTL: this.sessionTTL,
        };
    }

    /**
     * Updates the last activity timestamp for a session.
     */
    private async updateSessionActivity(sessionId: string): Promise<void> {
        const sessionKey = `session:${sessionId}`;
        const sessionData = await this.services.storageManager
            .getDatabase()
            .get<SessionData>(sessionKey);

        if (sessionData) {
            sessionData.lastActivity = Date.now();
            await this.services.storageManager.getDatabase().set(sessionKey, sessionData);
            // Update cache as well
            await this.services.storageManager
                .getCache()
                .set(sessionKey, sessionData, this.sessionTTL / 1000);
        }
    }

    /**
     * Increments the message count for a session.
     */
    public async incrementMessageCount(sessionId: string): Promise<void> {
        await this.ensureInitialized();

        const sessionKey = `session:${sessionId}`;
        const sessionData = await this.services.storageManager
            .getDatabase()
            .get<SessionData>(sessionKey);

        if (sessionData) {
            sessionData.messageCount++;
            sessionData.lastActivity = Date.now();
            await this.services.storageManager.getDatabase().set(sessionKey, sessionData);
            // Update cache as well
            await this.services.storageManager
                .getCache()
                .set(sessionKey, sessionData, this.sessionTTL / 1000);
        }
    }

    /**
     * Sets the human-friendly title for a session.
     * Title is stored in session metadata and cached with TTL.
     */
    public async setSessionTitle(
        sessionId: string,
        title: string,
        opts: { ifUnsetOnly?: boolean } = {}
    ): Promise<void> {
        await this.ensureInitialized();

        const sessionKey = `session:${sessionId}`;
        const sessionData = await this.services.storageManager
            .getDatabase()
            .get<SessionData>(sessionKey);

        if (!sessionData) {
            throw SessionError.notFound(sessionId);
        }

        const normalized = title.trim().slice(0, 80);
        if (opts.ifUnsetOnly && sessionData.metadata?.title) {
            return;
        }

        sessionData.metadata = sessionData.metadata || {};
        sessionData.metadata.title = normalized;
        sessionData.lastActivity = Date.now();

        await this.services.storageManager.getDatabase().set(sessionKey, sessionData);
        await this.services.storageManager
            .getCache()
            .set(sessionKey, sessionData, this.sessionTTL / 1000);
    }

    /**
     * Gets the stored title for a session, if any.
     */
    public async getSessionTitle(sessionId: string): Promise<string | undefined> {
        await this.ensureInitialized();
        const sessionKey = `session:${sessionId}`;
        const sessionData = await this.services.storageManager
            .getDatabase()
            .get<SessionData>(sessionKey);
        return sessionData?.metadata?.title;
    }

    /**
     * Cleans up expired sessions from memory only, preserving chat history in storage.
     * This allows inactive sessions to be garbage collected while keeping conversations restorable.
     */
    private async cleanupExpiredSessions(): Promise<void> {
        const now = Date.now();
        const expiredSessions: string[] = [];

        // Check in-memory sessions for expiry
        for (const [sessionId, _session] of this.sessions.entries()) {
            const sessionKey = `session:${sessionId}`;
            const sessionData = await this.services.storageManager
                .getDatabase()
                .get<SessionData>(sessionKey);

            if (sessionData && now - sessionData.lastActivity > this.sessionTTL) {
                expiredSessions.push(sessionId);
            }
        }

        // Remove expired sessions from memory only (preserve storage)
        for (const sessionId of expiredSessions) {
            const session = this.sessions.get(sessionId);
            if (session) {
                // Only dispose memory resources, don't delete chat history
                session.dispose();
                this.sessions.delete(sessionId);
                logger.debug(
                    `Removed expired session from memory: ${sessionId} (chat history preserved)`
                );
            }
        }

        if (expiredSessions.length > 0) {
            logger.debug(
                `Memory cleanup: removed ${expiredSessions.length} inactive sessions, chat history preserved`
            );
        }
    }

    /**
     * Switch LLM for all sessions.
     * @param newLLMConfig The new LLM configuration to apply
     * @returns Result object with success message and any warnings
     */
    public async switchLLMForAllSessions(
        newLLMConfig: ValidatedLLMConfig
    ): Promise<{ message: string; warnings: string[] }> {
        await this.ensureInitialized();

        const sessionIds = await this.listSessions();
        const failedSessions: string[] = [];

        for (const sId of sessionIds) {
            const session = await this.getSession(sId);
            if (session) {
                try {
                    // Update state with validated config (validation already done by DextoAgent)
                    // Using exceptions here for session-specific runtime failures (corruption, disposal, etc.)
                    // This is different from input validation which uses Result<T,C> pattern
                    this.services.stateManager.updateLLM(newLLMConfig, sId);
                    await session.switchLLM(newLLMConfig);
                } catch (error) {
                    // Session-level failure - continue processing other sessions (isolation)
                    failedSessions.push(sId);
                    logger.warn(
                        `Error switching LLM for session ${sId}: ${error instanceof Error ? error.message : String(error)}`
                    );
                }
            }
        }

        this.services.agentEventBus.emit('dexto:llmSwitched', {
            newConfig: newLLMConfig,
            router: newLLMConfig.router,
            historyRetained: true,
            sessionIds: sessionIds.filter((id) => !failedSessions.includes(id)),
        });

        const message =
            failedSessions.length > 0
                ? `Successfully switched to ${newLLMConfig.provider}/${newLLMConfig.model} using ${newLLMConfig.router} router (${failedSessions.length} sessions failed)`
                : `Successfully switched to ${newLLMConfig.provider}/${newLLMConfig.model} using ${newLLMConfig.router} router for all sessions`;

        const warnings =
            failedSessions.length > 0
                ? [`Failed to switch LLM for sessions: ${failedSessions.join(', ')}`]
                : [];

        return { message, warnings };
    }

    /**
     * Switch LLM for a specific session.
     * @param newLLMConfig The new LLM configuration to apply
     * @param sessionId The session ID to switch LLM for
     * @returns Result object with success message and any warnings
     */
    public async switchLLMForSpecificSession(
        newLLMConfig: ValidatedLLMConfig,
        sessionId: string
    ): Promise<{ message: string; warnings: string[] }> {
        const session = await this.getSession(sessionId);
        if (!session) {
            throw SessionError.notFound(sessionId);
        }

        await session.switchLLM(newLLMConfig);

        this.services.agentEventBus.emit('dexto:llmSwitched', {
            newConfig: newLLMConfig,
            router: newLLMConfig.router,
            historyRetained: true,
            sessionIds: [sessionId],
        });

        const message = `Successfully switched to ${newLLMConfig.provider}/${newLLMConfig.model} using ${newLLMConfig.router} router for session ${sessionId}`;

        return { message, warnings: [] };
    }

    /**
     * Switch LLM for the default session.
     * @param newLLMConfig The new LLM configuration to apply
     * @returns Result object with success message and any warnings
     */
    public async switchLLMForDefaultSession(
        newLLMConfig: ValidatedLLMConfig
    ): Promise<{ message: string; warnings: string[] }> {
        const defaultSession = await this.getDefaultSession();

        await defaultSession.switchLLM(newLLMConfig);

        this.services.agentEventBus.emit('dexto:llmSwitched', {
            newConfig: newLLMConfig,
            router: newLLMConfig.router,
            historyRetained: true,
            sessionIds: [defaultSession.id],
        });

        const message = `Successfully switched to ${newLLMConfig.provider}/${newLLMConfig.model} using ${newLLMConfig.router} router`;

        return { message, warnings: [] };
    }

    /**
     * Get session statistics for monitoring and debugging.
     */
    public async getSessionStats(): Promise<{
        totalSessions: number;
        inMemorySessions: number;
        maxSessions: number;
        sessionTTL: number;
    }> {
        await this.ensureInitialized();

        const totalSessions = (await this.listSessions()).length;
        const inMemorySessions = this.sessions.size;

        return {
            totalSessions,
            inMemorySessions,
            maxSessions: this.maxSessions,
            sessionTTL: this.sessionTTL,
        };
    }

    /**
     * Cleanup all sessions and resources.
     * This should be called when shutting down the application.
     */
    public async cleanup(): Promise<void> {
        if (!this.initialized) {
            return;
        }

        // Stop periodic cleanup
        if (this.cleanupInterval) {
            clearInterval(this.cleanupInterval);
            delete this.cleanupInterval;
            logger.debug('Periodic session cleanup stopped');
        }

        // End all in-memory sessions (preserve conversation history)
        const sessionIds = Array.from(this.sessions.keys());
        for (const sessionId of sessionIds) {
            try {
                await this.endSession(sessionId);
            } catch (error) {
                logger.error(
                    `Failed to cleanup session ${sessionId}: ${error instanceof Error ? error.message : String(error)}`
                );
            }
        }

        this.sessions.clear();
        this.initialized = false;
        logger.debug('SessionManager cleanup completed');
    }
}

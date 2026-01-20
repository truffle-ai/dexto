import { randomUUID } from 'crypto';
import { ChatSession } from './chat-session.js';
import { SystemPromptManager } from '../systemPrompt/manager.js';
import { ToolManager } from '../tools/tool-manager.js';
import { AgentEventBus } from '../events/index.js';
import type { IDextoLogger } from '../logger/v2/types.js';
import { DextoLogComponent } from '../logger/v2/types.js';
import type { AgentStateManager } from '../agent/state-manager.js';
import type { ValidatedLLMConfig } from '@core/llm/schemas.js';
import type { StorageManager } from '../storage/index.js';
import type { PluginManager } from '../plugins/manager.js';
import { SessionError } from './errors.js';
import type { TokenUsage } from '../llm/types.js';

/**
 * Session-level token usage totals (accumulated across all messages).
 * All fields required since we track cumulative totals (defaulting to 0).
 */
export type SessionTokenUsage = Required<TokenUsage>;

export interface SessionMetadata {
    createdAt: number;
    lastActivity: number;
    messageCount: number;
    title?: string;
    tokenUsage?: SessionTokenUsage;
    estimatedCost?: number;
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
    tokenUsage?: SessionTokenUsage;
    estimatedCost?: number;
    /** Parent session that was compacted to create this session */
    continuedFrom?: string;
    /** Child session created when this session was compacted */
    continuedTo?: string;
    /** Timestamp when this session was compacted (created a continuation) */
    compactedAt?: number;
    /** Number of times this session chain has been compacted (inherited + 1 on each compaction) */
    compactionCount?: number;
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
 *
 * TODO (Telemetry): Add OpenTelemetry metrics collection later if needed
 *   - Active session gauges (current count)
 *   - Session creation/deletion counters
 *   - Session duration histograms
 *   - Messages per session histograms
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
    // Per-session mutex for token usage updates to prevent lost updates from concurrent calls
    private readonly tokenUsageLocks = new Map<string, Promise<void>>();
    private logger: IDextoLogger;

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
        config: SessionManagerConfig = {},
        logger: IDextoLogger
    ) {
        this.maxSessions = config.maxSessions ?? 100;
        this.sessionTTL = config.sessionTTL ?? 3600000; // 1 hour
        this.logger = logger.createChild(DextoLogComponent.SESSION);
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
                    this.logger.error(`Periodic session cleanup failed: ${err}`)
                ),
            cleanupIntervalMs
        );

        this.initialized = true;
        this.logger.debug(
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
            this.logger.debug(`Found ${sessionKeys.length} persisted sessions to restore`);

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
                        this.logger.debug(`Session ${sessionId} restored from storage`);
                    } else {
                        // Session expired, clean it up
                        await this.services.storageManager.getDatabase().delete(sessionKey);
                        this.logger.debug(`Expired session ${sessionId} cleaned up during restore`);
                    }
                }
            }
        } catch (error) {
            this.logger.error(
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
            const session = new ChatSession(
                { ...this.services, sessionManager: this },
                id,
                this.logger
            );
            await session.init();
            this.sessions.set(id, session);
            this.logger.info(`Restored session from storage: ${id}`);
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
            this.logger.error(`Failed to store session metadata for ${id}:`, {
                error: error instanceof Error ? error.message : String(error),
            });
            // Re-throw the original error to maintain test compatibility
            throw error;
        }

        // Now create the actual session object
        let session: ChatSession;
        try {
            session = new ChatSession({ ...this.services, sessionManager: this }, id, this.logger);
            await session.init();
            this.sessions.set(id, session);

            // Also store in cache with TTL for faster access
            await this.services.storageManager
                .getCache()
                .set(sessionKey, sessionData, this.sessionTTL / 1000);

            this.logger.info(`Created new session: ${id}`);
            return session;
        } catch (error) {
            // If session creation fails after we've claimed the slot, clean up the metadata
            this.logger.error(
                `Failed to initialize session ${id}: ${error instanceof Error ? error.message : String(error)}`
            );
            await this.services.storageManager.getDatabase().delete(sessionKey);
            await this.services.storageManager.getCache().delete(sessionKey);
            const reason = error instanceof Error ? error.message : 'unknown error';
            throw SessionError.initializationFailed(id, reason);
        }
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
                    sessionId,
                    this.logger
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

        this.logger.debug(
            `Ended session (removed from memory, chat history preserved): ${sessionId}`
        );
    }

    /**
     * Deletes a session and its conversation history, removing everything from memory and storage.
     * Used for user-initiated permanent deletion.
     *
     * @param sessionId The session ID to delete
     */
    public async deleteSession(sessionId: string): Promise<void> {
        await this.ensureInitialized();

        // Get session (load from storage if not in memory) to clean up memory resources
        const session = await this.getSession(sessionId);
        if (session) {
            await session.cleanup(); // This cleans up memory resources
            this.sessions.delete(sessionId);
        }

        // Remove session metadata from storage
        const sessionKey = `session:${sessionId}`;
        await this.services.storageManager.getDatabase().delete(sessionKey);
        await this.services.storageManager.getCache().delete(sessionKey);

        const messagesKey = `messages:${sessionId}`;
        await this.services.storageManager.getDatabase().delete(messagesKey);

        this.logger.debug(`Deleted session and conversation history: ${sessionId}`);
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

        this.logger.debug(`Reset session conversation: ${sessionId}`);
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
        if (!sessionData) return undefined;

        return {
            createdAt: sessionData.createdAt,
            lastActivity: sessionData.lastActivity,
            messageCount: sessionData.messageCount,
            title: sessionData.metadata?.title,
            ...(sessionData.tokenUsage && { tokenUsage: sessionData.tokenUsage }),
            ...(sessionData.estimatedCost !== undefined && {
                estimatedCost: sessionData.estimatedCost,
            }),
        };
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
     * Accumulates token usage for a session.
     * Called after each LLM response to update session-level totals.
     *
     * Uses per-session locking to prevent lost updates from concurrent calls.
     */
    public async accumulateTokenUsage(
        sessionId: string,
        usage: TokenUsage,
        cost?: number
    ): Promise<void> {
        await this.ensureInitialized();

        const sessionKey = `session:${sessionId}`;

        // Wait for any in-flight update for this session, then chain ours
        const previousLock = this.tokenUsageLocks.get(sessionKey) ?? Promise.resolve();

        const currentLock = previousLock.then(async () => {
            const sessionData = await this.services.storageManager
                .getDatabase()
                .get<SessionData>(sessionKey);

            if (!sessionData) return;

            // Initialize if needed
            if (!sessionData.tokenUsage) {
                sessionData.tokenUsage = {
                    inputTokens: 0,
                    outputTokens: 0,
                    reasoningTokens: 0,
                    cacheReadTokens: 0,
                    cacheWriteTokens: 0,
                    totalTokens: 0,
                };
            }

            // Accumulate
            sessionData.tokenUsage.inputTokens += usage.inputTokens ?? 0;
            sessionData.tokenUsage.outputTokens += usage.outputTokens ?? 0;
            sessionData.tokenUsage.reasoningTokens += usage.reasoningTokens ?? 0;
            sessionData.tokenUsage.cacheReadTokens += usage.cacheReadTokens ?? 0;
            sessionData.tokenUsage.cacheWriteTokens += usage.cacheWriteTokens ?? 0;
            sessionData.tokenUsage.totalTokens += usage.totalTokens ?? 0;

            // Add cost if provided
            if (cost !== undefined) {
                sessionData.estimatedCost = (sessionData.estimatedCost ?? 0) + cost;
            }

            sessionData.lastActivity = Date.now();

            // Persist
            await this.services.storageManager.getDatabase().set(sessionKey, sessionData);
            await this.services.storageManager
                .getCache()
                .set(sessionKey, sessionData, this.sessionTTL / 1000);
        });

        this.tokenUsageLocks.set(sessionKey, currentLock);

        // Wait for our update to complete, but don't let errors propagate to break the chain
        try {
            await currentLock;
        } finally {
            // Clean up lock if this was the last operation
            if (this.tokenUsageLocks.get(sessionKey) === currentLock) {
                this.tokenUsageLocks.delete(sessionKey);
            }
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
                this.logger.debug(
                    `Removed expired session from memory: ${sessionId} (chat history preserved)`
                );
            }
        }

        if (expiredSessions.length > 0) {
            this.logger.debug(
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
                    this.logger.warn(
                        `Error switching LLM for session ${sId}: ${error instanceof Error ? error.message : String(error)}`
                    );
                }
            }
        }

        this.services.agentEventBus.emit('llm:switched', {
            newConfig: newLLMConfig,
            historyRetained: true,
            sessionIds: sessionIds.filter((id) => !failedSessions.includes(id)),
        });

        const message =
            failedSessions.length > 0
                ? `Successfully switched to ${newLLMConfig.provider}/${newLLMConfig.model} (${failedSessions.length} sessions failed)`
                : `Successfully switched to ${newLLMConfig.provider}/${newLLMConfig.model} for all sessions`;

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

        this.services.agentEventBus.emit('llm:switched', {
            newConfig: newLLMConfig,
            historyRetained: true,
            sessionIds: [sessionId],
        });

        const message = `Successfully switched to ${newLLMConfig.provider}/${newLLMConfig.model} for session ${sessionId}`;

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
     * Get the raw session data for a session ID.
     * This is used for accessing continuation fields and other metadata.
     *
     * @param sessionId The session ID
     * @returns Session data if found, undefined otherwise
     */
    public async getSessionData(sessionId: string): Promise<SessionData | undefined> {
        await this.ensureInitialized();
        const sessionKey = `session:${sessionId}`;
        return await this.services.storageManager.getDatabase().get<SessionData>(sessionKey);
    }

    /**
     * Creates a continuation session from a compacted session.
     * The new session will have the summary as its first message.
     *
     * @param fromSessionId The session being compacted
     * @returns The new session ID and ChatSession
     */
    public async createContinuationSession(
        fromSessionId: string
    ): Promise<{ sessionId: string; session: ChatSession }> {
        await this.ensureInitialized();

        // Verify source session exists
        const fromSessionData = await this.getSessionData(fromSessionId);
        if (!fromSessionData) {
            throw SessionError.notFound(fromSessionId);
        }

        // Enforce maxSessions limit (same guard as createSessionInternal)
        const activeSessionKeys = await this.services.storageManager.getDatabase().list('session:');
        if (activeSessionKeys.length >= this.maxSessions) {
            throw SessionError.maxSessionsExceeded(activeSessionKeys.length, this.maxSessions);
        }

        // Generate new session ID
        const newSessionId = randomUUID();

        // Copy LLM config from original session to the new session
        // This ensures the continuation session uses the same model as the original
        // Must be done BEFORE session.init() which reads config from stateManager
        const originalLLMConfig = this.services.stateManager.getRuntimeConfig(fromSessionId).llm;
        this.services.stateManager.updateLLM(originalLLMConfig, newSessionId);

        // Create new session with continuation metadata
        // Increment compaction count from parent (0 if not set)
        const parentCompactionCount = fromSessionData.compactionCount ?? 0;

        const newSessionData: SessionData = {
            id: newSessionId,
            createdAt: Date.now(),
            lastActivity: Date.now(),
            messageCount: 0,
            continuedFrom: fromSessionId,
            compactionCount: parentCompactionCount + 1,
            ...(fromSessionData.userId !== undefined && { userId: fromSessionData.userId }),
            ...(fromSessionData.metadata && {
                metadata: {
                    ...fromSessionData.metadata,
                    title: fromSessionData.metadata?.title, // Preserve title
                },
            }),
        };

        // Store new session metadata
        const sessionKey = `session:${newSessionId}`;
        await this.services.storageManager.getDatabase().set(sessionKey, newSessionData);
        await this.services.storageManager
            .getCache()
            .set(sessionKey, newSessionData, this.sessionTTL / 1000);

        // Create the ChatSession instance
        // Wrap in try/catch to clean up persisted entries if init fails
        const session = new ChatSession(
            { ...this.services, sessionManager: this },
            newSessionId,
            this.logger
        );

        try {
            await session.init();
        } catch (error) {
            // Clean up persisted entries on init failure
            session.dispose();
            await this.services.storageManager.getDatabase().delete(sessionKey);
            await this.services.storageManager.getCache().delete(sessionKey);
            // Clean up LLM config that was set before init (line 821)
            this.services.stateManager.clearSessionOverride(newSessionId);
            throw error;
        }

        this.sessions.set(newSessionId, session);

        this.logger.info(
            `Created continuation session ${newSessionId} from compacted session ${fromSessionId}`
        );

        return { sessionId: newSessionId, session };
    }

    /**
     * Marks a session as compacted and links it to its continuation session.
     *
     * @param sessionId The session being compacted
     * @param continuedToId The new session created from compaction
     */
    public async markSessionCompacted(sessionId: string, continuedToId: string): Promise<void> {
        await this.ensureInitialized();

        const sessionKey = `session:${sessionId}`;
        const sessionData = await this.services.storageManager
            .getDatabase()
            .get<SessionData>(sessionKey);

        if (!sessionData) {
            throw SessionError.notFound(sessionId);
        }

        // Update with compaction metadata
        sessionData.continuedTo = continuedToId;
        sessionData.compactedAt = Date.now();
        sessionData.lastActivity = Date.now();

        await this.services.storageManager.getDatabase().set(sessionKey, sessionData);
        await this.services.storageManager
            .getCache()
            .set(sessionKey, sessionData, this.sessionTTL / 1000);

        this.logger.debug(`Marked session ${sessionId} as compacted → ${continuedToId}`);
    }

    /**
     * Gets the compaction count for a session.
     * Returns 0 if the session has never been compacted.
     *
     * @param sessionId The session ID
     * @returns Number of times this session chain has been compacted
     */
    public async getCompactionCount(sessionId: string): Promise<number> {
        const sessionData = await this.getSessionData(sessionId);
        return sessionData?.compactionCount ?? 0;
    }

    /**
     * Gets the chain of linked sessions (ancestors and descendants).
     * Returns sessions in chronological order (oldest first).
     *
     * @param sessionId Any session ID in the chain
     * @returns Array of session data in the chain, ordered chronologically
     */
    public async getSessionChain(sessionId: string): Promise<SessionData[]> {
        await this.ensureInitialized();

        const chain: SessionData[] = [];
        const visited = new Set<string>();

        // Get the initial session
        let currentData = await this.getSessionData(sessionId);
        if (!currentData) {
            return [];
        }

        // Walk backwards to find the root (oldest ancestor)
        while (currentData?.continuedFrom && !visited.has(currentData.continuedFrom)) {
            visited.add(currentData.id);
            const parent = await this.getSessionData(currentData.continuedFrom);
            if (!parent) {
                // Keep last known node as root if ancestor is missing
                break;
            }
            currentData = parent;
        }

        // If we stopped at a valid session, add it as root
        if (currentData && !visited.has(currentData.id)) {
            visited.add(currentData.id);
        }

        // Walk forwards from root, collecting all sessions
        visited.clear();
        while (currentData && !visited.has(currentData.id)) {
            visited.add(currentData.id);
            chain.push(currentData);

            if (currentData.continuedTo) {
                currentData = await this.getSessionData(currentData.continuedTo);
            } else {
                break;
            }
        }

        return chain;
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
            this.logger.debug('Periodic session cleanup stopped');
        }

        // End all in-memory sessions (preserve conversation history)
        const sessionIds = Array.from(this.sessions.keys());
        for (const sessionId of sessionIds) {
            try {
                await this.endSession(sessionId);
            } catch (error) {
                this.logger.error(
                    `Failed to cleanup session ${sessionId}: ${error instanceof Error ? error.message : String(error)}`
                );
            }
        }

        this.sessions.clear();
        this.initialized = false;
        this.logger.debug('SessionManager cleanup completed');
    }
}

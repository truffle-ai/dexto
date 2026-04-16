import { randomUUID } from 'crypto';
import { ChatSession } from './chat-session.js';
import { SystemPromptManager } from '../systemPrompt/manager.js';
import { ToolManager } from '../tools/tool-manager.js';
import { AgentEventBus } from '../events/index.js';
import type { Logger } from '../logger/v2/types.js';
import { DextoLogComponent } from '../logger/v2/types.js';
import type { AgentStateManager } from '../agent/state-manager.js';
import type { ValidatedLLMConfig } from '../llm/schemas.js';
import type { StorageManager } from '../storage/index.js';
import type { HookManager } from '../hooks/manager.js';
import type { ApprovalManager } from '../approval/manager.js';
import { SessionError } from './errors.js';
import type { TokenUsage } from '../llm/types.js';
import type { LanguageModelFactory } from '../llm/services/types.js';
import type { CompactionStrategy } from '../context/compaction/types.js';
import { ZodError } from 'zod';
import {
    SessionPromptContributorSchema,
    type SessionPromptContributor,
} from '../systemPrompt/schemas.js';
import type { MessageQueueStore } from './message-queue-store.js';
export type SessionLoggerFactory = (options: {
    baseLogger: Logger;
    agentId: string;
    sessionId: string;
}) => Logger;

function defaultSessionLoggerFactory(options: {
    baseLogger: Logger;
    agentId: string;
    sessionId: string;
}): Logger {
    // Default behavior (no filesystem assumptions): just a child logger.
    // Hosts (CLI/server) can inject a SessionLoggerFactory that writes to a file.
    return options.baseLogger.createChild(DextoLogComponent.SESSION);
}

/**
 * Session-level token usage totals (accumulated across all messages).
 * All fields required since we track cumulative totals (defaulting to 0).
 */
export type SessionTokenUsage = Required<TokenUsage>;

export interface SessionUsageTracking {
    hasUntrackedChatGPTLoginUsage?: boolean;
}

/**
 * Per-model statistics for tracking usage across multiple models within a session.
 */
export interface ModelStatistics {
    provider: string;
    model: string;
    messageCount: number;
    tokenUsage: SessionTokenUsage;
    estimatedCost: number;
    firstUsedAt: number;
    lastUsedAt: number;
}

export interface SessionMetadata {
    createdAt: number;
    lastActivity: number;
    messageCount: number;
    title?: string;
    tokenUsage?: SessionTokenUsage;
    estimatedCost?: number;
    modelStats?: ModelStatistics[];
    workspaceId?: string;
    parentSessionId?: string;
    usageTracking?: SessionUsageTracking;
}

export interface SessionManagerConfig {
    maxSessions?: number;
    sessionTTL?: number;
    /** Host hook for creating a session-scoped logger (e.g. file logger) */
    sessionLoggerFactory?: SessionLoggerFactory;
    /** Host hook for constructing session-scoped LanguageModel instances */
    languageModelFactory?: LanguageModelFactory;
}

type PersistedLLMConfig = Omit<ValidatedLLMConfig, 'apiKey'>;

export interface SessionData {
    id: string;
    userId?: string;
    createdAt: number;
    lastActivity: number;
    messageCount: number;
    metadata?: Record<string, any>;
    tokenUsage?: SessionTokenUsage;
    estimatedCost?: number;
    modelStats?: ModelStatistics[];
    workspaceId?: string;
    parentSessionId?: string;
    usageTracking?: SessionUsageTracking;
    /** Persisted LLM config override for this session */
    llmOverride?: PersistedLLMConfig;
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
    private static readonly MESSAGE_QUEUE_KEY_PREFIX = 'session-message-queue:';
    private initialized = false;
    private cleanupInterval?: NodeJS.Timeout;
    private initializationPromise!: Promise<void>;
    // Add a Map to track ongoing session creation operations to prevent race conditions
    private readonly pendingCreations = new Map<string, Promise<ChatSession>>();
    // Per-session mutex for any SessionData read-modify-write path.
    private readonly sessionDataLocks = new Map<string, Promise<void>>();
    private logger: Logger;
    private static readonly FORK_HISTORY_BATCH_SIZE = 500;
    private static readonly FORK_ID_GENERATION_MAX_ATTEMPTS = 5;
    private static readonly FORK_TITLE_PREFIX = 'Fork: ';
    private static readonly FORK_PARENT_ID_PREVIEW_LENGTH = 8;

    private readonly sessionLoggerFactory: SessionLoggerFactory;
    private readonly languageModelFactory: LanguageModelFactory | undefined;

    constructor(
        private services: {
            stateManager: AgentStateManager;
            systemPromptManager: SystemPromptManager;
            toolManager: ToolManager;
            approvalManager: ApprovalManager;
            agentEventBus: AgentEventBus;
            storageManager: StorageManager;
            resourceManager: import('../resources/index.js').ResourceManager;
            hookManager: HookManager;
            mcpManager: import('../mcp/manager.js').MCPManager;
            messageQueueStore: Pick<MessageQueueStore, 'load' | 'save' | 'delete'>;
            compactionStrategy: CompactionStrategy | null;
            workspaceManager?: import('../workspace/manager.js').WorkspaceManager;
        },
        config: SessionManagerConfig = {},
        logger: Logger
    ) {
        this.maxSessions = config.maxSessions ?? 100;
        this.sessionTTL = config.sessionTTL ?? 3600000; // 1 hour
        this.sessionLoggerFactory = config.sessionLoggerFactory ?? defaultSessionLoggerFactory;
        this.languageModelFactory = config.languageModelFactory;
        this.logger = logger.createChild(DextoLogComponent.SESSION);
    }

    private getChatSessionServices(): ConstructorParameters<typeof ChatSession>[0] {
        return {
            ...this.services,
            sessionManager: this,
            ...(this.languageModelFactory !== undefined && {
                languageModelFactory: this.languageModelFactory,
            }),
        };
    }

    /**
     * Initialize the SessionManager with persistent storage.
     * This must be called before using any session operations.
     */
    public async init(): Promise<void> {
        if (this.initialized) {
            return;
        }

        await this.clearPersistedQueuedMessages('startup');

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
                        // Session expired, purge the session record plus any persisted
                        // interaction state keyed off the same session ID.
                        await Promise.all([
                            this.services.storageManager.getDatabase().delete(sessionKey),
                            this.services.storageManager.getCache().delete(sessionKey),
                            this.deleteSessionInteractionState(sessionId),
                        ]);
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

    private async clearPersistedQueuedMessages(reason: 'startup' | 'shutdown'): Promise<void> {
        try {
            const queueKeys = await this.services.storageManager
                .getDatabase()
                .list(SessionManager.MESSAGE_QUEUE_KEY_PREFIX);
            if (queueKeys.length === 0) {
                return;
            }

            await Promise.all(
                queueKeys.map((key) =>
                    this.services.messageQueueStore.delete(
                        key.slice(SessionManager.MESSAGE_QUEUE_KEY_PREFIX.length)
                    )
                )
            );

            const message = `${reason === 'startup' ? 'Cleared stale queued follow-up state from previous agent run' : 'Cleared queued follow-up state during agent shutdown'} (${queueKeys.length} session bucket(s))`;
            if (reason === 'startup') {
                // TODO(issue-743): Replace startup purge with explicit resume semantics for interrupted queued follow-ups.
                this.logger.info(message);
            } else {
                this.logger.debug(message);
            }
        } catch (error) {
            this.logger.warn(
                `Failed to clear persisted queued follow-up state during ${reason}: ${
                    error instanceof Error ? error.message : String(error)
                }`
            );
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
     * Fork an existing session by cloning its persisted history into a new child session.
     *
     * The child session:
     * - Always gets a generated session ID
     * - Stores lineage via parentSessionId
     * - Uses a fork-prefixed title derived from parent title (or parent ID)
     * - Copies messageCount/workspaceId/llmOverride from parent metadata
     * - Starts fresh token/cost/modelStats accounting
     */
    public async forkSession(parentSessionId: string): Promise<ChatSession> {
        await this.ensureInitialized();

        const database = this.services.storageManager.getDatabase();
        const cache = this.services.storageManager.getCache();
        const parentSessionKey = `session:${parentSessionId}`;
        const parentMessagesKey = `messages:${parentSessionId}`;

        const parentSessionData = await database.get<SessionData>(parentSessionKey);
        if (!parentSessionData) {
            throw SessionError.notFound(parentSessionId);
        }

        const activeSessionKeys = await database.list('session:');
        if (activeSessionKeys.length >= this.maxSessions) {
            throw SessionError.maxSessionsExceeded(activeSessionKeys.length, this.maxSessions);
        }

        const childSessionId = await this.generateForkSessionId();
        const childSessionKey = `session:${childSessionId}`;
        const childMessagesKey = `messages:${childSessionId}`;
        const now = Date.now();

        const childTitle = this.buildForkTitle(parentSessionData, parentSessionId);
        const childSessionData: SessionData = {
            id: childSessionId,
            createdAt: now,
            lastActivity: now,
            messageCount: parentSessionData.messageCount,
            parentSessionId,
            ...(parentSessionData.metadata !== undefined
                ? {
                      metadata: {
                          ...parentSessionData.metadata,
                          title: childTitle,
                      },
                  }
                : {
                      metadata: {
                          title: childTitle,
                      },
                  }),
            ...(parentSessionData.workspaceId !== undefined && {
                workspaceId: parentSessionData.workspaceId,
            }),
            ...(parentSessionData.llmOverride !== undefined && {
                llmOverride: parentSessionData.llmOverride,
            }),
        };

        try {
            await database.set(childSessionKey, childSessionData);
            await this.copySessionHistory(parentMessagesKey, childMessagesKey);

            const childSession = await this.createSession(childSessionId);
            this.logger.info(`Forked session '${parentSessionId}' into child '${childSessionId}'`);
            return childSession;
        } catch (error) {
            // Best-effort rollback for partially created fork state.
            await Promise.allSettled([
                database.delete(childSessionKey),
                database.delete(childMessagesKey),
                cache.delete(childSessionKey),
            ]);

            const inMemorySession = this.sessions.get(childSessionId);
            if (inMemorySession) {
                try {
                    await inMemorySession.cleanup();
                } catch {
                    // Ignore cleanup errors during rollback.
                }
                this.sessions.delete(childSessionId);
            }

            throw error;
        }
    }

    private buildForkTitle(parentSessionData: SessionData, parentSessionId: string): string {
        const rawParentTitle = parentSessionData.metadata?.title;
        const parentTitle = typeof rawParentTitle === 'string' ? rawParentTitle.trim() : '';
        const prefix = SessionManager.FORK_TITLE_PREFIX;

        const baseTitle =
            parentTitle.length > 0
                ? parentTitle.startsWith(prefix)
                    ? parentTitle.slice(prefix.length).trim() || parentTitle
                    : parentTitle
                : parentSessionId.slice(0, SessionManager.FORK_PARENT_ID_PREVIEW_LENGTH);

        return `${prefix}${baseTitle}`;
    }

    private async generateForkSessionId(): Promise<string> {
        const database = this.services.storageManager.getDatabase();

        for (let attempt = 0; attempt < SessionManager.FORK_ID_GENERATION_MAX_ATTEMPTS; attempt++) {
            const candidateId = randomUUID();
            if (this.sessions.has(candidateId) || this.pendingCreations.has(candidateId)) {
                continue;
            }

            const existing = await database.get<SessionData>(`session:${candidateId}`);
            if (!existing) {
                return candidateId;
            }
        }

        throw SessionError.initializationFailed(
            'fork',
            'failed to generate unique child session ID'
        );
    }

    private async copySessionHistory(
        parentMessagesKey: string,
        childMessagesKey: string
    ): Promise<void> {
        const database = this.services.storageManager.getDatabase();
        let offset = 0;

        while (true) {
            const batch = await database.getRange<unknown>(
                parentMessagesKey,
                offset,
                SessionManager.FORK_HISTORY_BATCH_SIZE
            );

            if (batch.length === 0) {
                return;
            }

            for (const message of batch) {
                await database.append(childMessagesKey, message);
            }

            offset += batch.length;

            if (batch.length < SessionManager.FORK_HISTORY_BATCH_SIZE) {
                return;
            }
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
            const runtimeConfig = this.services.stateManager.getRuntimeConfig();
            const agentId = runtimeConfig.agentCard?.name ?? runtimeConfig.agentId;
            const sessionLogger = this.sessionLoggerFactory({
                baseLogger: this.logger,
                agentId,
                sessionId: id,
            });

            // Restore LLM override BEFORE session init so the service is created with correct config
            // SECURITY: Re-resolve API key from environment when restoring (never persisted)
            const sessionData = await this.services.storageManager
                .getDatabase()
                .get<SessionData>(sessionKey);
            if (sessionData?.llmOverride) {
                const { resolveApiKeyForProvider } = await import('../utils/api-key-resolver.js');
                const apiKey = resolveApiKeyForProvider(sessionData.llmOverride.provider);
                if (!apiKey) {
                    this.logger.warn(
                        `Skipped LLM override restore for session ${id}: missing API key for provider ${sessionData.llmOverride.provider}`,
                        { sessionId: id, provider: sessionData.llmOverride.provider }
                    );
                } else {
                    const restoredConfig: ValidatedLLMConfig = {
                        ...sessionData.llmOverride,
                        apiKey,
                    };
                    this.services.stateManager.updateLLM(restoredConfig, id);
                }
            }

            const session = new ChatSession(this.getChatSessionServices(), id, sessionLogger);
            await session.init();
            await this.services.toolManager.restoreSessionState(id);
            await this.services.approvalManager.restoreSessionState(id);

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

        // A newly-created session claims a clean interaction-state namespace.
        // If stale per-session buckets exist without metadata, they belong to an orphaned session.
        await this.deleteSessionInteractionState(id);

        const workspace = await this.services.workspaceManager?.getWorkspace();

        // Create new session metadata first to "reserve" the session slot
        const sessionData: SessionData = {
            id,
            createdAt: Date.now(),
            lastActivity: Date.now(),
            messageCount: 0,
            ...(workspace?.id !== undefined && { workspaceId: workspace.id }),
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
            const runtimeConfig = this.services.stateManager.getRuntimeConfig();
            const agentId = runtimeConfig.agentCard?.name ?? runtimeConfig.agentId;
            const sessionLogger = this.sessionLoggerFactory({
                baseLogger: this.logger,
                agentId,
                sessionId: id,
            });
            session = new ChatSession(this.getChatSessionServices(), id, sessionLogger);
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
                const runtimeConfig = this.services.stateManager.getRuntimeConfig();
                const agentId = runtimeConfig.agentCard?.name ?? runtimeConfig.agentId;
                const sessionLogger = this.sessionLoggerFactory({
                    baseLogger: this.logger,
                    agentId,
                    sessionId,
                });

                // Restore LLM override BEFORE session init so the service is created with correct config
                // SECURITY: Re-resolve API key from environment when restoring (never persisted)
                if (sessionData.llmOverride) {
                    const { resolveApiKeyForProvider } = await import(
                        '../utils/api-key-resolver.js'
                    );
                    const apiKey = resolveApiKeyForProvider(sessionData.llmOverride.provider);
                    if (!apiKey) {
                        this.logger.warn(
                            `Skipped LLM override restore for session ${sessionId}: missing API key for provider ${sessionData.llmOverride.provider}`,
                            { sessionId, provider: sessionData.llmOverride.provider }
                        );
                    } else {
                        const restoredConfig: ValidatedLLMConfig = {
                            ...sessionData.llmOverride,
                            apiKey,
                        };
                        this.services.stateManager.updateLLM(restoredConfig, sessionId);
                    }
                }

                const session = new ChatSession(
                    this.getChatSessionServices(),
                    sessionId,
                    sessionLogger
                );
                await session.init();
                await this.services.toolManager.restoreSessionState(sessionId);
                await this.services.approvalManager.restoreSessionState(sessionId);

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
        this.evictSessionInteractionState(sessionId);

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
        await this.deleteSessionInteractionState(sessionId);

        const messagesKey = `messages:${sessionId}`;
        await this.services.storageManager.getDatabase().delete(messagesKey);

        this.logger.debug(`Deleted session and conversation history: ${sessionId}`);
    }

    /**
     * Resets conversation and session-scoped interaction state while keeping the session alive.
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
        await session.clearMessageQueue();
        await Promise.all([
            this.services.toolManager.deleteSessionState(sessionId),
            this.services.approvalManager.deleteSessionState(sessionId),
        ]);

        if (this.services.stateManager.hasSessionLLMOverride(sessionId)) {
            this.services.stateManager.clearSessionOverride(sessionId);
            await session.switchLLM(this.services.stateManager.getRuntimeConfig().llm);
        }

        // Reset message count in metadata
        await this.runWithSessionDataLock(sessionId, async (sessionKey) => {
            const sessionData = await this.services.storageManager
                .getDatabase()
                .get<SessionData>(sessionKey);
            if (!sessionData) {
                return;
            }

            sessionData.messageCount = 0;
            sessionData.lastActivity = Date.now();
            delete sessionData.llmOverride;
            await this.persistSessionData(sessionKey, sessionData);
        });

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
            ...(sessionData.modelStats && { modelStats: sessionData.modelStats }),
            ...(sessionData.workspaceId && { workspaceId: sessionData.workspaceId }),
            ...(sessionData.parentSessionId !== undefined && {
                parentSessionId: sessionData.parentSessionId,
            }),
            ...(sessionData.usageTracking && { usageTracking: sessionData.usageTracking }),
        };
    }

    public async getSessionSystemPromptContributors(
        sessionId: string
    ): Promise<SessionPromptContributor[]> {
        await this.ensureInitialized();

        const sessionKey = `session:${sessionId}`;
        const sessionData = await this.services.storageManager
            .getDatabase()
            .get<SessionData>(sessionKey);

        if (!sessionData) {
            throw SessionError.notFound(sessionId);
        }

        return this.parseSessionPromptContributors(sessionId, sessionData);
    }

    public async upsertSessionSystemPromptContributor(
        sessionId: string,
        contributor: SessionPromptContributor
    ): Promise<boolean> {
        await this.ensureInitialized();

        return await this.runWithSessionDataLock(sessionId, async (sessionKey) => {
            const sessionData = await this.services.storageManager
                .getDatabase()
                .get<SessionData>(sessionKey);

            if (!sessionData) {
                throw SessionError.notFound(sessionId);
            }

            const existing = this.parseSessionPromptContributors(sessionId, sessionData);
            const next = existing.filter((entry) => entry.id !== contributor.id);
            const replaced = next.length !== existing.length;

            next.push(contributor);
            next.sort((left, right) => left.priority - right.priority);

            sessionData.metadata = sessionData.metadata || {};
            sessionData.metadata.systemPromptContributors = next;
            sessionData.lastActivity = Date.now();

            await this.persistSessionData(sessionKey, sessionData);
            return replaced;
        });
    }

    public async removeSessionSystemPromptContributor(
        sessionId: string,
        contributorId: string
    ): Promise<boolean> {
        await this.ensureInitialized();

        return await this.runWithSessionDataLock(sessionId, async (sessionKey) => {
            const sessionData = await this.services.storageManager
                .getDatabase()
                .get<SessionData>(sessionKey);

            if (!sessionData) {
                throw SessionError.notFound(sessionId);
            }

            const existing = this.parseSessionPromptContributors(sessionId, sessionData);
            const next = existing.filter((entry) => entry.id !== contributorId);
            const removed = next.length !== existing.length;

            if (!removed) {
                return false;
            }

            sessionData.metadata = sessionData.metadata || {};
            sessionData.metadata.systemPromptContributors = next;
            sessionData.lastActivity = Date.now();

            await this.persistSessionData(sessionKey, sessionData);
            return true;
        });
    }

    private parseSessionPromptContributors(
        sessionId: string,
        sessionData: SessionData
    ): SessionPromptContributor[] {
        try {
            return SessionPromptContributorSchema.array().parse(
                sessionData.metadata?.systemPromptContributors ?? []
            );
        } catch (error) {
            if (error instanceof ZodError) {
                throw SessionError.storageFailed(sessionId, 'read', error.message);
            }

            throw error;
        }
    }

    public async markUntrackedChatGPTLoginUsage(sessionId: string): Promise<void> {
        await this.ensureInitialized();

        await this.runWithSessionDataLock(sessionId, async (sessionKey) => {
            const sessionData = await this.services.storageManager
                .getDatabase()
                .get<SessionData>(sessionKey);

            if (!sessionData || sessionData.usageTracking?.hasUntrackedChatGPTLoginUsage) {
                return;
            }

            sessionData.usageTracking = {
                ...(sessionData.usageTracking ?? {}),
                hasUntrackedChatGPTLoginUsage: true,
            };

            await this.persistSessionData(sessionKey, sessionData);
        });
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
        await this.runWithSessionDataLock(sessionId, async (sessionKey) => {
            const sessionData = await this.services.storageManager
                .getDatabase()
                .get<SessionData>(sessionKey);

            if (!sessionData) {
                return;
            }

            sessionData.lastActivity = Date.now();
            await this.persistSessionData(sessionKey, sessionData);
        });
    }

    /**
     * Increments the message count for a session.
     */
    public async incrementMessageCount(sessionId: string): Promise<void> {
        await this.ensureInitialized();

        await this.runWithSessionDataLock(sessionId, async (sessionKey) => {
            const sessionData = await this.services.storageManager
                .getDatabase()
                .get<SessionData>(sessionKey);

            if (!sessionData) {
                return;
            }

            sessionData.messageCount++;
            sessionData.lastActivity = Date.now();
            await this.persistSessionData(sessionKey, sessionData);
        });
    }

    /**
     * Accumulates token usage for a session.
     * Called after each LLM response to update session-level totals.
     *
     * Uses per-session locking to prevent lost updates from concurrent calls.
     *
     * @param sessionId The session ID
     * @param usage Token usage to accumulate
     * @param cost Estimated cost for this usage
     * @param modelInfo Optional model info for per-model tracking
     */
    public async accumulateTokenUsage(
        sessionId: string,
        usage: TokenUsage,
        cost?: number,
        modelInfo?: { provider: string; model: string }
    ): Promise<void> {
        await this.ensureInitialized();

        await this.runWithSessionDataLock(sessionId, async (sessionKey) => {
            const sessionData = await this.services.storageManager
                .getDatabase()
                .get<SessionData>(sessionKey);

            if (!sessionData) return;

            // Update per-model statistics if model info provided
            if (modelInfo) {
                this.updateModelStats(sessionData, usage, cost, modelInfo);
            }

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

            // Accumulate aggregate totals using helper
            this.accumulateTokensInto(sessionData.tokenUsage, usage);

            // Add cost if provided
            if (cost !== undefined) {
                sessionData.estimatedCost = (sessionData.estimatedCost ?? 0) + cost;
            }

            sessionData.lastActivity = Date.now();

            await this.persistSessionData(sessionKey, sessionData);
        });
    }

    /**
     * Helper to accumulate token usage into a target SessionTokenUsage object.
     * Used for both session-level and per-model token tracking.
     */
    private accumulateTokensInto(target: SessionTokenUsage, usage: TokenUsage): void {
        target.inputTokens += usage.inputTokens ?? 0;
        target.outputTokens += usage.outputTokens ?? 0;
        target.reasoningTokens += usage.reasoningTokens ?? 0;
        target.cacheReadTokens += usage.cacheReadTokens ?? 0;
        target.cacheWriteTokens += usage.cacheWriteTokens ?? 0;
        // TODO(token-usage): Use a shared totalTokens resolver instead of raw `?? 0`.
        target.totalTokens += usage.totalTokens ?? 0;
    }

    /**
     * Updates per-model statistics for a session.
     * Finds or creates a model entry and accumulates tokens and cost.
     *
     * @private
     */
    private updateModelStats(
        sessionData: SessionData,
        usage: TokenUsage,
        cost: number | undefined,
        modelInfo: { provider: string; model: string }
    ): void {
        // Initialize modelStats array if needed
        if (!sessionData.modelStats) {
            sessionData.modelStats = [];
        }

        // Find or create model entry
        let modelStat = sessionData.modelStats.find(
            (s) => s.provider === modelInfo.provider && s.model === modelInfo.model
        );

        if (!modelStat) {
            modelStat = {
                provider: modelInfo.provider,
                model: modelInfo.model,
                messageCount: 0,
                tokenUsage: {
                    inputTokens: 0,
                    outputTokens: 0,
                    reasoningTokens: 0,
                    cacheReadTokens: 0,
                    cacheWriteTokens: 0,
                    totalTokens: 0,
                },
                estimatedCost: 0,
                firstUsedAt: Date.now(),
                lastUsedAt: Date.now(),
            };
            sessionData.modelStats.push(modelStat);
        }

        // Accumulate tokens using helper
        this.accumulateTokensInto(modelStat.tokenUsage, usage);

        // Accumulate cost
        if (cost !== undefined) {
            modelStat.estimatedCost += cost;
        }

        // Increment message count
        modelStat.messageCount += 1;

        // Update last used timestamp
        modelStat.lastUsedAt = Date.now();
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

        const normalized = title.trim().slice(0, 80);
        await this.runWithSessionDataLock(sessionId, async (sessionKey) => {
            const sessionData = await this.services.storageManager
                .getDatabase()
                .get<SessionData>(sessionKey);

            if (!sessionData) {
                throw SessionError.notFound(sessionId);
            }

            if (opts.ifUnsetOnly && sessionData.metadata?.title) {
                return;
            }

            sessionData.metadata = sessionData.metadata || {};
            sessionData.metadata.title = normalized;
            sessionData.lastActivity = Date.now();

            await this.persistSessionData(sessionKey, sessionData);
        });
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
                this.evictSessionInteractionState(sessionId);
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
                    await this.applySessionLLMSwitch(sId, session, newLLMConfig);
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

        await this.applySessionLLMSwitch(sessionId, session, newLLMConfig);

        this.services.agentEventBus.emit('llm:switched', {
            newConfig: newLLMConfig,
            historyRetained: true,
            sessionIds: [sessionId],
        });

        const message = `Successfully switched to ${newLLMConfig.provider}/${newLLMConfig.model} for session ${sessionId}`;

        return { message, warnings: [] };
    }

    private async applySessionLLMSwitch(
        sessionId: string,
        session: ChatSession,
        newLLMConfig: ValidatedLLMConfig
    ): Promise<void> {
        const previousLLMConfig = this.services.stateManager.getRuntimeConfig(sessionId).llm;
        const previousHadOverride = this.services.stateManager.hasSessionLLMOverride(sessionId);
        const previousPersistedOverride = await this.getPersistedSessionLLMOverride(sessionId);

        await this.setPersistedSessionLLMOverride(
            sessionId,
            this.toPersistedLLMConfig(newLLMConfig)
        );

        try {
            this.services.stateManager.updateLLM(newLLMConfig, sessionId);
            await session.switchLLM(newLLMConfig);
        } catch (error) {
            await this.setPersistedSessionLLMOverride(sessionId, previousPersistedOverride);

            if (previousHadOverride) {
                this.services.stateManager.updateLLM(previousLLMConfig, sessionId);
            } else {
                this.services.stateManager.clearSessionOverride(sessionId);
            }

            try {
                await session.switchLLM(previousLLMConfig);
            } catch (rollbackError) {
                this.logger.error(
                    `Failed to roll back LLM switch for session ${sessionId}: ${
                        rollbackError instanceof Error
                            ? rollbackError.message
                            : String(rollbackError)
                    }`
                );
            }

            throw error;
        }
    }

    private async getPersistedSessionLLMOverride(
        sessionId: string
    ): Promise<PersistedLLMConfig | undefined> {
        const sessionData = await this.getSessionData(sessionId);
        return sessionData?.llmOverride;
    }

    private toPersistedLLMConfig(newLLMConfig: ValidatedLLMConfig): PersistedLLMConfig {
        // SECURITY: Don't persist API keys - they should be resolved from environment variables.
        const { apiKey: _apiKey, ...configWithoutApiKey } = newLLMConfig;
        return configWithoutApiKey;
    }

    private async setPersistedSessionLLMOverride(
        sessionId: string,
        llmOverride: PersistedLLMConfig | undefined
    ): Promise<void> {
        await this.runWithSessionDataLock(sessionId, async (sessionKey) => {
            const sessionData = await this.services.storageManager
                .getDatabase()
                .get<SessionData>(sessionKey);
            if (!sessionData) {
                return;
            }

            if (llmOverride !== undefined) {
                sessionData.llmOverride = llmOverride;
            } else {
                delete sessionData.llmOverride;
            }
            await this.persistSessionData(sessionKey, sessionData);
        });
    }

    private async deleteSessionInteractionState(sessionId: string): Promise<void> {
        this.services.stateManager.clearSessionOverride(sessionId);
        await Promise.all([
            this.services.toolManager.deleteSessionState(sessionId),
            this.services.approvalManager.deleteSessionState(sessionId),
            this.services.messageQueueStore.delete(sessionId),
        ]);
    }

    private evictSessionInteractionState(sessionId: string): void {
        this.services.toolManager.evictSessionState(sessionId);
        this.services.approvalManager.evictSessionState(sessionId);
    }

    private async runWithSessionDataLock<T>(
        sessionId: string,
        fn: (sessionKey: string) => Promise<T>
    ): Promise<T> {
        const sessionKey = `session:${sessionId}`;
        const previousLock = this.sessionDataLocks.get(sessionKey) ?? Promise.resolve();
        const currentResult = previousLock.catch(() => {}).then(() => fn(sessionKey));
        const currentLock = currentResult.then(
            () => undefined,
            () => undefined
        );

        this.sessionDataLocks.set(sessionKey, currentLock);

        try {
            return await currentResult;
        } finally {
            if (this.sessionDataLocks.get(sessionKey) === currentLock) {
                this.sessionDataLocks.delete(sessionKey);
            }
        }
    }

    private async persistSessionData(sessionKey: string, sessionData: SessionData): Promise<void> {
        await this.services.storageManager.getDatabase().set(sessionKey, sessionData);
        await this.services.storageManager
            .getCache()
            .set(sessionKey, sessionData, this.sessionTTL / 1000);
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

        await this.clearPersistedQueuedMessages('shutdown');

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

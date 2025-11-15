/**
 * SubAgentCoordinator
 *
 * Central authority for all sub-agent operations. Handles spawning, tracking,
 * event forwarding, lifecycle management, and cleanup of sub-agent sessions.
 *
 * This encapsulates all the complexity that was previously spread across
 * ChatSession, SessionManager, and the spawn_agent tool.
 */

import type { SessionManager } from '../session/index.js';
import type { AgentStateManager } from './state-manager.js';
import type { AgentEventBus, SessionEventNames as SessionEventNamesType } from '../events/index.js';
import { SessionEventNames } from '../events/index.js';
import type { IDextoLogger } from '../logger/v2/types.js';
import type { AgentConfig } from './schemas.js';
import type { ChatSession } from '../session/chat-session.js';
import { EventForwarder } from './event-forwarder.js';
import { SessionError } from '../session/errors.js';
import {
    resolveAgentConfig,
    validateSubAgentConfig,
    type AgentReference,
    type AgentResolutionContext,
    type ResolvedAgentConfig,
} from '../config/agent-reference-resolver.js';

/**
 * Options for spawning a sub-agent
 */
export interface SubAgentSpawnOptions {
    /** Parent session ID */
    parentSessionId: string;

    /** Agent reference (built-in name or file path) */
    agentReference?: AgentReference;

    /** Or provide agent config directly */
    agentConfig?: AgentConfig;

    /** Lifecycle policy (defaults to config) */
    lifecycle?: 'ephemeral' | 'persistent';

    /** Working directory for resolving agent references */
    workingDir?: string;
}

/**
 * Internal context tracked for each active sub-agent
 */
interface SubAgentContext {
    sessionId: string;
    parentSessionId: string;
    depth: number;
    lifecycle: 'ephemeral' | 'persistent';
    agentIdentifier: string;
    startTime: number;
}

/**
 * Public info about a sub-agent
 */
export interface SubAgentInfo {
    sessionId: string;
    depth: number;
    agentIdentifier: string;
    duration: number;
}

/**
 * Handle for interacting with a spawned sub-agent
 */
export class SubAgentHandle {
    constructor(
        private session: ChatSession,
        private context: SubAgentContext,
        private coordinator: SubAgentCoordinator
    ) {}

    /**
     * Run a task on the sub-agent.
     * Automatically cleans up after completion.
     */
    async run(task: string): Promise<string> {
        try {
            return await this.session.run(task);
        } finally {
            // Auto-cleanup on completion
            await this.coordinator.cleanup(this.session.id);
        }
    }

    /**
     * Cancel the currently running task.
     */
    async cancel(): Promise<boolean> {
        return this.session.cancel();
    }

    /**
     * Get the sub-agent's session ID.
     */
    get sessionId(): string {
        return this.session.id;
    }

    /**
     * Get sub-agent info.
     */
    get info(): SubAgentInfo {
        return {
            sessionId: this.context.sessionId,
            depth: this.context.depth,
            agentIdentifier: this.context.agentIdentifier,
            duration: Date.now() - this.context.startTime,
        };
    }
}

/**
 * SubAgentCoordinator manages the lifecycle of sub-agent sessions.
 */
export class SubAgentCoordinator {
    // Track active sub-agents in-memory
    private activeSubAgents = new Map<string, SubAgentContext>();

    // Track event forwarders for cleanup
    private forwarders = new Map<string, EventForwarder>();

    constructor(
        private sessionManager: SessionManager,
        private stateManager: AgentStateManager,
        private agentEventBus: AgentEventBus,
        private logger: IDextoLogger
    ) {}

    /**
     * Spawn a sub-agent session with automatic wiring.
     *
     * @param options - Spawn configuration
     * @returns Handle for interacting with the sub-agent
     * @throws {SessionError} if depth limit exceeded or validation fails
     */
    async spawn(options: SubAgentSpawnOptions): Promise<SubAgentHandle> {
        const { parentSessionId, agentReference, agentConfig, lifecycle } = options;

        // 1. Calculate current depth
        const depth = await this.getDepth(parentSessionId);
        this.logger.debug(`Current depth for parent ${parentSessionId}: ${depth}`);

        // 2. Check depth limit
        const maxDepth = this.stateManager.getRuntimeConfig().sessions?.maxSubAgentDepth ?? 1;
        if (depth >= maxDepth) {
            throw SessionError.maxDepthExceeded(depth, maxDepth);
        }

        // 3. Resolve agent config
        let resolvedConfig: ResolvedAgentConfig;
        if (agentReference) {
            const resolutionContext: AgentResolutionContext = {
                workingDir: options.workingDir || process.cwd(),
                parentSessionId,
            };
            resolvedConfig = await resolveAgentConfig(agentReference, resolutionContext);
            this.logger.debug(`Resolved agent reference:`, {
                type: resolvedConfig.source.type,
                identifier:
                    resolvedConfig.source.type !== 'inline'
                        ? resolvedConfig.source.identifier
                        : 'inline',
            });
        } else if (agentConfig) {
            resolvedConfig = {
                config: agentConfig,
                source: { type: 'inline' },
            };
        } else {
            throw new Error('Must provide either agentReference or agentConfig');
        }

        // 4. Validate sub-agent config
        validateSubAgentConfig(resolvedConfig.config);

        // 5. Build agent identifier for tracking
        const agentIdentifier = this.buildAgentIdentifier(resolvedConfig.source);

        // 6. Create session with minimal metadata (only parentSessionId)
        const session = await this.sessionManager.createSession(undefined, {
            type: 'sub-agent',
            subAgent: {
                parentSessionId, // Only field we persist
            },
            agentConfig: resolvedConfig.config,
        });

        this.logger.info(
            `Created sub-agent session ${session.id} (depth: ${depth + 1}, agent: ${agentIdentifier})`
        );

        // 7. Set up event forwarding
        await this.setupEventForwarding(session, parentSessionId, depth + 1, agentIdentifier);

        // 8. Track active sub-agent in-memory
        const context: SubAgentContext = {
            sessionId: session.id,
            parentSessionId,
            depth: depth + 1,
            lifecycle: lifecycle ?? this.getDefaultLifecycle(),
            agentIdentifier,
            startTime: Date.now(),
        };
        this.activeSubAgents.set(session.id, context);

        this.logger.debug(
            `Tracking sub-agent ${session.id} in-memory`,
            context as unknown as Record<string, unknown>
        );

        // 9. Return handle
        return new SubAgentHandle(session, context, this);
    }

    /**
     * Set up event forwarding from sub-agent to parent session.
     */
    private async setupEventForwarding(
        subSession: ChatSession,
        parentSessionId: string,
        depth: number,
        agentIdentifier: string
    ): Promise<void> {
        try {
            const parentSession = await this.sessionManager.getSession(parentSessionId);
            if (!parentSession) {
                this.logger.warn(
                    `Parent session ${parentSessionId} not found, skipping event forwarding`
                );
                return;
            }

            // Create forwarder for session events (sub-agent → parent session)
            const sessionForwarder = new EventForwarder(
                subSession.eventBus,
                parentSession.eventBus,
                this.logger
            );

            // Forward all session events with metadata
            SessionEventNames.forEach((eventName) => {
                sessionForwarder.forward(eventName, {
                    augmentPayload: (payload) => {
                        const base = payload && typeof payload === 'object' ? payload : {};

                        return {
                            ...base,
                            fromSubAgent: true,
                            subAgentSessionId: subSession.id,
                            subAgentType: agentIdentifier,
                            depth,
                        };
                    },
                });
            });

            // Create forwarder for agent events (approval requests/responses)
            const agentForwarder = new EventForwarder(
                this.agentEventBus,
                this.agentEventBus,
                this.logger
            );

            // Forward approval events, filtering by session and overriding sessionId to parent
            const approvalEvents = ['dexto:approvalRequest', 'dexto:approvalResponse'] as const;
            approvalEvents.forEach((eventName) => {
                agentForwarder.forward(eventName, {
                    filter: (payload) => payload?.sessionId === subSession.id,
                    augmentPayload: (payload) => ({
                        ...payload,
                        fromSubAgent: true,
                        subAgentSessionId: subSession.id,
                        sessionId: parentSessionId, // Override to parent
                    }),
                });
            });

            // Store forwarders for cleanup
            const forwarderId = `sub-agent:${subSession.id}`;
            this.forwarders.set(forwarderId, sessionForwarder);
            this.forwarders.set(`${forwarderId}:agent`, agentForwarder);

            this.logger.debug(
                `Event forwarding configured: ${subSession.id} → ${parentSessionId} ` +
                    `(${sessionForwarder.count} session events, ${agentForwarder.count} agent events)`
            );
        } catch (error) {
            this.logger.error(
                `Failed to set up event forwarding for sub-agent ${subSession.id}: ${error instanceof Error ? error.message : String(error)}`
            );
            // Don't throw - forwarding is nice-to-have, not critical
        }
    }

    /**
     * Clean up a sub-agent session.
     * Handles event forwarder disposal and lifecycle-based cleanup.
     */
    async cleanup(subAgentSessionId: string): Promise<void> {
        const context = this.activeSubAgents.get(subAgentSessionId);
        if (!context) {
            this.logger.debug(
                `Sub-agent ${subAgentSessionId} not in active tracking, skipping cleanup`
            );
            return;
        }

        try {
            this.logger.debug(`Cleaning up sub-agent ${subAgentSessionId}`, {
                lifecycle: context.lifecycle,
                duration: Date.now() - context.startTime,
            });

            // 1. Dispose event forwarders
            const forwarderId = `sub-agent:${subAgentSessionId}`;
            this.forwarders.get(forwarderId)?.dispose();
            this.forwarders.get(`${forwarderId}:agent`)?.dispose();
            this.forwarders.delete(forwarderId);
            this.forwarders.delete(`${forwarderId}:agent`);

            // 2. Handle lifecycle policy
            if (context.lifecycle === 'ephemeral') {
                // Ephemeral: delete session entirely (removes from memory and storage)
                await this.sessionManager.deleteSession(subAgentSessionId);
                this.logger.info(`Ephemeral sub-agent session deleted: ${subAgentSessionId}`);
            } else {
                // Persistent: just cleanup memory (keep storage for later review)
                const session = await this.sessionManager.getSession(subAgentSessionId);
                if (session) {
                    await session.cleanup();
                }
                this.logger.info(
                    `Persistent sub-agent session memory cleaned: ${subAgentSessionId}`
                );
            }

            // 3. Remove from tracking
            this.activeSubAgents.delete(subAgentSessionId);

            this.logger.debug(`Sub-agent cleanup completed: ${subAgentSessionId}`);
        } catch (error) {
            this.logger.error(
                `Error cleaning up sub-agent ${subAgentSessionId}: ${error instanceof Error ? error.message : String(error)}`
            );
            throw error;
        }
    }

    /**
     * Get active sub-agents for a parent session.
     */
    getActiveSubAgents(parentSessionId: string): SubAgentInfo[] {
        return Array.from(this.activeSubAgents.values())
            .filter((ctx) => ctx.parentSessionId === parentSessionId)
            .map((ctx) => ({
                sessionId: ctx.sessionId,
                depth: ctx.depth,
                agentIdentifier: ctx.agentIdentifier,
                duration: Date.now() - ctx.startTime,
            }));
    }

    /**
     * Cancel a running sub-agent.
     */
    async cancel(subAgentSessionId: string): Promise<boolean> {
        const context = this.activeSubAgents.get(subAgentSessionId);
        if (!context) {
            return false;
        }

        const session = await this.sessionManager.getSession(subAgentSessionId);
        if (!session) {
            return false;
        }

        return session.cancel();
    }

    /**
     * Calculate depth by walking up the parent chain.
     */
    private async getDepth(sessionId: string): Promise<number> {
        let depth = 0;
        let currentId: string | undefined = sessionId;

        // Walk up parent chain
        while (currentId) {
            const sessionMetadata = await this.sessionManager.getSessionMetadata(currentId);
            if (!sessionMetadata) break;

            const parentSessionId = sessionMetadata.metadata?.subAgent?.parentSessionId;
            if (parentSessionId) {
                depth++;
                currentId = parentSessionId;
            } else {
                break;
            }
        }

        return depth;
    }

    /**
     * Get default lifecycle policy from config.
     */
    private getDefaultLifecycle(): 'ephemeral' | 'persistent' {
        return this.stateManager.getRuntimeConfig().sessions?.subAgentLifecycle ?? 'persistent';
    }

    /**
     * Build agent identifier string for tracking.
     */
    private buildAgentIdentifier(source: ResolvedAgentConfig['source']): string {
        if (source.type === 'built-in') {
            return `built-in:${source.identifier}`;
        } else if (source.type === 'file') {
            return `file:${source.path}`;
        } else {
            return 'inline:custom-config';
        }
    }
}

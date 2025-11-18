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
import type { AgentEventBus } from '../events/index.js';
import { SessionEventNames } from '../events/index.js';
import type { IDextoLogger } from '../logger/v2/types.js';
import type { AgentConfig } from './schemas.js';
import { EventForwarder } from './event-forwarder.js';
import { SessionError } from '../session/errors.js';
import type { DextoAgent } from './DextoAgent.js';

/**
 * Options for spawning a sub-agent
 */
export interface SubAgentSpawnOptions {
    /** Parent session ID */
    parentSessionId: string;

    /** Sub-agent instance (if already created) or config to create one */
    agent: DextoAgent | AgentConfig;

    /** Lifecycle policy (defaults to config) */
    lifecycle?: 'ephemeral' | 'persistent';

    /** Task description for tracking what the sub-agent is working on */
    description?: string;
}

/**
 * Internal context tracked for each active sub-agent
 */
interface SubAgentContext {
    agent: DextoAgent;
    agentId: string; // Unique ID for tracking
    executionSessionId: string; // Explicit session created for sub-agent execution
    parentSessionId: string;
    depth: number;
    lifecycle: 'ephemeral' | 'persistent';
    startTime: number;
}

/**
 * Public info about a sub-agent
 */
export interface SubAgentInfo {
    agentId: string;
    sessionId: string; // Default session ID of the sub-agent
    depth: number;
    duration: number;
}

/**
 * Handle for interacting with a spawned sub-agent
 */
export class SubAgentHandle {
    constructor(
        private context: SubAgentContext,
        private coordinator: SubAgentCoordinator
    ) {}

    /**
     * Run a task on the sub-agent.
     * Automatically cleans up after completion.
     * @param task The task to execute
     * @param options Optional execution options
     */
    async run(
        task: string,
        options?: {
            /** Timeout in milliseconds. If exceeded, the task will be cancelled. */
            timeout?: number;
        }
    ): Promise<string> {
        try {
            // Use the explicit execution session created during spawn
            const session = await this.context.agent.getSession(this.context.executionSessionId);
            if (!session) {
                throw new Error(
                    `Sub-agent execution session ${this.context.executionSessionId} not found`
                );
            }

            // If timeout is specified, race the execution with timeout
            if (options?.timeout) {
                return await Promise.race([
                    session.run(task),
                    new Promise<string>((_, reject) =>
                        setTimeout(() => {
                            this.cancel();
                            reject(new Error(`Sub-agent timeout after ${options.timeout}ms`));
                        }, options.timeout)
                    ),
                ]);
            }

            return await session.run(task);
        } finally {
            // Auto-cleanup on completion
            await this.coordinator.cleanup(this.context.agentId);
        }
    }

    /**
     * Cancel the currently running task.
     */
    async cancel(): Promise<boolean> {
        const session = await this.context.agent.getSession(this.context.executionSessionId);
        if (!session) {
            return false;
        }
        return session.cancel();
    }

    /**
     * Get the sub-agent's execution session ID.
     */
    get sessionId(): string {
        return this.context.executionSessionId;
    }

    /**
     * Get the sub-agent instance.
     */
    get agent(): DextoAgent {
        return this.context.agent;
    }

    /**
     * Get sub-agent info.
     */
    get info(): SubAgentInfo {
        return {
            agentId: this.context.agentId,
            sessionId: this.context.executionSessionId,
            depth: this.context.depth,
            duration: Date.now() - this.context.startTime,
        };
    }
}

/**
 * SubAgentCoordinator manages the lifecycle of sub-agent DextoAgent instances.
 */
export class SubAgentCoordinator {
    // Track active sub-agents in-memory (keyed by agentId)
    private activeSubAgents = new Map<string, SubAgentContext>();

    // Track event forwarders for cleanup (keyed by agentId)
    private forwarders = new Map<string, EventForwarder>();

    constructor(
        private sessionManager: SessionManager,
        private stateManager: AgentStateManager,
        private agentEventBus: AgentEventBus,
        private logger: IDextoLogger
    ) {}

    /**
     * Spawn a sub-agent with automatic wiring.
     * Accepts either a DextoAgent instance or AgentConfig to create one.
     *
     * @param options - Spawn configuration
     * @returns Handle for interacting with the sub-agent
     * @throws {SessionError} if depth limit exceeded or validation fails
     */
    async spawn(options: SubAgentSpawnOptions): Promise<SubAgentHandle> {
        const { parentSessionId, agent, lifecycle, description } = options;

        // 1. Determine if we have an agent or need to create one
        const isAgentInstance = 'sendMessage' in agent; // Duck typing to avoid circular import
        let subAgent: DextoAgent;
        let agentConfig: AgentConfig | undefined;

        if (isAgentInstance) {
            subAgent = agent as DextoAgent;
            // Agent already exists, ensure it's started
            if (!subAgent.isStarted) {
                await subAgent.start();
            }
        } else {
            // agent is AgentConfig, create DextoAgent
            agentConfig = agent as AgentConfig;

            // Validate sub-agent config before creating
            this.validateSubAgentConfig(agentConfig);

            // Import DextoAgent class dynamically to avoid circular dependency
            const { DextoAgent: DextoAgentClass } = await import('./DextoAgent.js');
            subAgent = new DextoAgentClass(agentConfig);
            await subAgent.start();
        }

        // 2. Calculate current depth
        const depth = await this.getDepth(parentSessionId);
        this.logger.debug(`Current depth for parent ${parentSessionId}: ${depth}`);

        // 3. Check depth limit
        const maxDepth = this.stateManager.getRuntimeConfig().sessions?.maxSubAgentDepth ?? 1;
        if (depth >= maxDepth) {
            throw SessionError.maxDepthExceeded(depth, maxDepth);
        }

        // 4. Validate parent session exists
        const parentSession = await this.sessionManager.getSession(parentSessionId);
        if (!parentSession) {
            throw SessionError.parentNotFound(parentSessionId);
        }

        // 5. Generate unique agent ID
        const agentId = `sub-agent-${Date.now()}-${Math.random().toString(36).substring(7)}`;

        this.logger.info(`Spawned sub-agent ${subAgent.agentId} (depth: ${depth + 1})`);

        // 6. Create explicit execution session for sub-agent
        // This avoids using default session logic which is being deprecated
        const executionSessionId = `sub-agent-exec-${agentId}`;
        const executionSession = await subAgent.createSession(executionSessionId, {
            type: 'sub-agent',
            subAgent: {
                parentSessionId, // Link to parent session
            },
            metadata: {
                agentId: subAgent.agentId,
                depth: depth + 1,
                ...(description && { description }),
            },
        });

        this.logger.debug(
            `Created execution session ${executionSessionId} for sub-agent ${subAgent.agentId}`
        );

        // 7. Set up event forwarding (agent-to-agent, using explicit session)
        await this.setupEventForwarding(subAgent, executionSessionId, parentSessionId, depth + 1);

        // 8. Track active sub-agent in-memory
        const context: SubAgentContext = {
            agent: subAgent,
            agentId,
            executionSessionId,
            parentSessionId,
            depth: depth + 1,
            lifecycle: lifecycle ?? this.getDefaultLifecycle(),
            startTime: Date.now(),
        };
        this.activeSubAgents.set(agentId, context);

        this.logger.debug(`Tracking sub-agent ${subAgent.agentId} in-memory`, {
            agentId,
            configuredAgentId: subAgent.agentId,
            depth: depth + 1,
        } as Record<string, unknown>);

        // 9. Return handle
        return new SubAgentHandle(context, this);
    }

    /**
     * Set up event forwarding from sub-agent to parent agent.
     * Forwards events from the sub-agent's event bus to the parent agent's event bus.
     */
    private async setupEventForwarding(
        subAgent: DextoAgent,
        subAgentSessionId: string,
        parentSessionId: string,
        depth: number
    ): Promise<void> {
        try {
            const parentSession = await this.sessionManager.getSession(parentSessionId);
            if (!parentSession) {
                this.logger.warn(
                    `Parent session ${parentSessionId} not found, skipping event forwarding`
                );
                return;
            }

            // Get sub-agent's event bus
            const subAgentEventBus = subAgent.agentEventBus;
            if (!subAgentEventBus) {
                this.logger.warn(`Sub-agent has no event bus, skipping event forwarding`);
                return;
            }

            // Forward sub-agent's session events to parent session
            // This allows the parent to see what the sub-agent is doing
            const sessionForwarder = new EventForwarder(
                subAgentEventBus,
                parentSession.eventBus,
                this.logger
            );

            // Forward all session events with sub-agent metadata
            SessionEventNames.forEach((eventName) => {
                sessionForwarder.forward(eventName, {
                    // Filter to only forward events from sub-agent's execution session
                    filter: (payload) => {
                        return payload?.sessionId === subAgentSessionId;
                    },
                    augmentPayload: (payload) => {
                        const base = payload && typeof payload === 'object' ? payload : {};
                        return {
                            ...base,
                            fromSubAgent: true,
                            subAgentSessionId,
                            subAgentType: subAgent.agentId,
                            depth,
                        };
                    },
                });
            });

            // Forward approval events from sub-agent to parent agent
            const approvalForwarder = new EventForwarder(
                subAgentEventBus,
                this.agentEventBus,
                this.logger
            );

            const approvalEvents = ['dexto:approvalRequest', 'dexto:approvalResponse'] as const;
            approvalEvents.forEach((eventName) => {
                approvalForwarder.forward(eventName, {
                    filter: (payload) => payload?.sessionId === subAgentSessionId,
                    augmentPayload: (payload) => ({
                        ...payload,
                        fromSubAgent: true,
                        subAgentSessionId,
                        sessionId: parentSessionId, // Route to parent session
                    }),
                });
            });

            // Store forwarders for cleanup
            this.forwarders.set(`${subAgentSessionId}:session`, sessionForwarder);
            this.forwarders.set(`${subAgentSessionId}:approval`, approvalForwarder);

            this.logger.debug(
                `Event forwarding configured for sub-agent ${subAgent.agentId} → parent session ${parentSessionId}`
            );
        } catch (error) {
            this.logger.error(
                `Failed to set up event forwarding for sub-agent: ${error instanceof Error ? error.message : String(error)}`
            );
            // Don't throw - forwarding is nice-to-have, not critical
        }
    }

    /**
     * Clean up a sub-agent.
     * Handles event forwarder disposal and lifecycle-based cleanup.
     */
    async cleanup(agentId: string): Promise<void> {
        const context = this.activeSubAgents.get(agentId);
        if (!context) {
            this.logger.debug(`Sub-agent ${agentId} not in active tracking, skipping cleanup`);
            return;
        }

        try {
            this.logger.debug(`Cleaning up sub-agent ${agentId}`, {
                lifecycle: context.lifecycle,
                duration: Date.now() - context.startTime,
            });

            // 1. Dispose event forwarders
            const sessionId = context.executionSessionId;
            this.forwarders.get(`${sessionId}:session`)?.dispose();
            this.forwarders.get(`${sessionId}:approval`)?.dispose();
            this.forwarders.delete(`${sessionId}:session`);
            this.forwarders.delete(`${sessionId}:approval`);

            // 2. Handle lifecycle policy
            if (context.lifecycle === 'ephemeral') {
                // Ephemeral: stop the agent entirely (which stops all its sessions)
                await context.agent.stop();
                this.logger.info(`Ephemeral sub-agent stopped: ${agentId}`);
            } else {
                // Persistent: end the execution session but keep agent running
                await context.agent.endSession(sessionId);
                this.logger.info(
                    `Persistent sub-agent execution session ended: ${sessionId}, agent kept running`
                );
            }

            // 3. Remove from tracking
            this.activeSubAgents.delete(agentId);

            this.logger.debug(`Sub-agent cleanup completed: ${agentId}`);
        } catch (error) {
            this.logger.error(
                `Error cleaning up sub-agent ${agentId}: ${error instanceof Error ? error.message : String(error)}`
            );
            throw error;
        }
    }

    /**
     * Get active sub-agents for a parent session.
     */
    getActiveSubAgents(parentSessionId: string): SubAgentInfo[] {
        const results: SubAgentInfo[] = [];

        for (const ctx of Array.from(this.activeSubAgents.values())) {
            if (ctx.parentSessionId === parentSessionId) {
                results.push({
                    agentId: ctx.agentId,
                    sessionId: ctx.executionSessionId,
                    depth: ctx.depth,
                    duration: Date.now() - ctx.startTime,
                });
            }
        }

        return results;
    }

    /**
     * Cancel a running sub-agent.
     */
    async cancel(agentId: string): Promise<boolean> {
        const context = this.activeSubAgents.get(agentId);
        if (!context) {
            return false;
        }

        const session = await context.agent.getSession(context.executionSessionId);
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
     * Validate that an agent config is suitable for sub-agent spawning.
     * Enforces security constraints.
     */
    private validateSubAgentConfig(config: AgentConfig): void {
        // Ensure spawn_agent is not in the tool list (prevent recursion)
        if (config.internalTools?.includes('spawn_agent')) {
            throw SessionError.invalidSubAgentConfig(
                'Sub-agents cannot have spawn_agent tool enabled to prevent infinite recursion'
            );
        }

        // Ensure ask_user is not enabled (sub-agents should work autonomously)
        // TODO: Add elicitation support to propagate ask_user requests from sub-agents to parent agent,
        // allowing sub-agents to request clarification from the user through the parent agent
        if (config.internalTools?.includes('ask_user')) {
            throw SessionError.invalidSubAgentConfig(
                'Sub-agents cannot have ask_user tool enabled - sub-agents must work autonomously without user interaction'
            );
        }

        this.logger.debug('Sub-agent config validation passed');
    }
}

/**
 * AgentRuntime - General-Purpose Agent Lifecycle Manager
 *
 * Manages the lifecycle of multiple agent instances. Can be used for:
 * - Dashboard spawning multiple independent agents
 * - Agent task delegation (parent spawns sub-agents)
 * - Test harnesses managing multiple agents
 * - Any scenario requiring multiple concurrent agents
 *
 * Key responsibilities:
 * - Spawn and manage agents with configurable limits
 * - Execute tasks on agents with timeout handling
 * - Track agent status and lifecycle
 * - Clean up agents when no longer needed
 */

import { randomUUID } from 'crypto';
import { AgentConfigSchema } from '@dexto/agent-config';
import { createLogger, DextoAgent, type IDextoLogger, type GenerateResponse } from '@dexto/core';
import { createStorageManager } from '@dexto/storage';
import { enrichAgentConfig } from '../config/index.js';
import { AgentPool } from './AgentPool.js';
import { RuntimeError } from './errors.js';
import type {
    AgentRuntimeConfig,
    SpawnConfig,
    AgentHandle,
    TaskResult,
    AgentFilter,
} from './types.js';
import { AgentRuntimeConfigSchema, type ValidatedAgentRuntimeConfig } from './schemas.js';

/**
 * Options for creating an AgentRuntime
 */
export interface AgentRuntimeOptions {
    /** Runtime configuration */
    config?: AgentRuntimeConfig;
    /** Logger instance */
    logger: IDextoLogger;
}

export class AgentRuntime {
    private pool: AgentPool;
    private config: ValidatedAgentRuntimeConfig;
    private logger: IDextoLogger;

    constructor(options: AgentRuntimeOptions) {
        // Validate and apply defaults
        this.config = AgentRuntimeConfigSchema.parse(options.config ?? {});
        this.logger = options.logger;
        this.pool = new AgentPool(this.config, this.logger);

        this.logger.debug('AgentRuntime initialized', {
            maxAgents: this.config.maxAgents,
            defaultTaskTimeout: this.config.defaultTaskTimeout,
        });
    }

    /**
     * Spawn a new agent
     *
     * @param config - Configuration for the agent
     * @returns Handle to the spawned agent
     */
    async spawnAgent(config: SpawnConfig): Promise<AgentHandle> {
        // Check global limit
        if (!this.pool.canSpawn()) {
            throw RuntimeError.maxAgentsExceeded(this.pool.size, this.config.maxAgents);
        }

        // Generate agent ID if not provided
        const agentId = config.agentId ?? `agent-${randomUUID().slice(0, 8)}`;

        // Check for duplicate ID
        if (this.pool.has(agentId)) {
            throw RuntimeError.agentAlreadyExists(agentId);
        }

        try {
            // Enrich the config with runtime paths
            // Skip plugin discovery for subagents to avoid duplicate warnings
            const enrichedConfig = enrichAgentConfig(
                config.agentConfig,
                undefined, // No config path
                { isInteractiveCli: false, skipPluginDiscovery: true }
            );

            // Override agentId in enriched config
            enrichedConfig.agentId = agentId;

            // Create the agent
            const validatedConfig = AgentConfigSchema.parse(enrichedConfig);
            const agentLogger = createLogger({
                config: validatedConfig.logger,
                agentId: validatedConfig.agentId,
            });
            const storageManager = await createStorageManager(validatedConfig.storage, agentLogger);
            const agent = new DextoAgent({
                config: validatedConfig,
                logger: agentLogger,
                overrides: { storageManager },
            });

            // Create the handle (status: starting)
            const sessionId = `session-${randomUUID().slice(0, 8)}`;
            const handle: AgentHandle = {
                agentId,
                agent,
                status: 'starting',
                ephemeral: config.ephemeral ?? true,
                createdAt: new Date(),
                sessionId,
            };

            // Add optional fields only if defined (exactOptionalPropertyTypes)
            if (config.group !== undefined) {
                handle.group = config.group;
            }
            if (config.metadata !== undefined) {
                handle.metadata = config.metadata;
            }

            // Add to pool
            this.pool.add(handle);

            // Call onBeforeStart hook if provided (e.g., to set approval handlers)
            if (config.onBeforeStart) {
                await config.onBeforeStart(agent);
            }

            // Start the agent
            await agent.start();

            // Update status to idle
            this.pool.updateStatus(agentId, 'idle');

            this.logger.info(
                `Spawned agent '${agentId}'${handle.group ? ` (group: ${handle.group})` : ''} (ephemeral: ${handle.ephemeral})`
            );

            return handle;
        } catch (error) {
            // Clean up on failure
            this.pool.remove(agentId);
            const errorMessage = error instanceof Error ? error.message : String(error);
            throw RuntimeError.spawnFailed(errorMessage, agentId);
        }
    }

    /**
     * Execute a task on an agent
     *
     * @param agentId - ID of the agent
     * @param task - Task description to execute
     * @param timeout - Optional timeout in milliseconds
     * @returns Task result with response or error
     */
    async executeTask(agentId: string, task: string, timeout?: number): Promise<TaskResult> {
        const handle = this.pool.get(agentId);
        if (!handle) {
            throw RuntimeError.agentNotFound(agentId);
        }

        if (handle.status === 'stopped' || handle.status === 'error') {
            throw RuntimeError.agentAlreadyStopped(agentId);
        }

        const taskTimeout = timeout ?? this.config.defaultTaskTimeout;

        // Update status to running
        this.pool.updateStatus(agentId, 'running');

        try {
            // Create timeout promise
            const timeoutPromise = new Promise<never>((_, reject) => {
                setTimeout(() => {
                    reject(RuntimeError.taskTimeout(agentId, taskTimeout));
                }, taskTimeout);
            });

            // Execute the task with timeout
            const generatePromise = handle.agent.generate(task, handle.sessionId);

            const response = (await Promise.race([
                generatePromise,
                timeoutPromise,
            ])) as GenerateResponse;

            // Update status back to idle
            this.pool.updateStatus(agentId, 'idle');

            // Build result
            const result: TaskResult = {
                success: true,
                response: response.content,
                agentId,
                tokenUsage: {
                    input: response.usage.inputTokens,
                    output: response.usage.outputTokens,
                    total: response.usage.totalTokens,
                },
            };

            this.logger.debug(`Task completed for agent '${agentId}'`);

            return result;
        } catch (error) {
            // Update status to error
            const errorMessage = error instanceof Error ? error.message : String(error);
            this.pool.updateStatus(agentId, 'error', errorMessage);

            // Check if it's a timeout error
            if (error instanceof Error && error.message.includes('Task execution timed out')) {
                return {
                    success: false,
                    error: errorMessage,
                    agentId,
                };
            }

            // Re-throw unexpected errors as task failures
            throw RuntimeError.taskFailed(agentId, errorMessage);
        }
    }

    /**
     * Get an agent handle by ID
     */
    getAgent(agentId: string): AgentHandle | undefined {
        return this.pool.get(agentId);
    }

    /**
     * List agents matching the given filter
     */
    listAgents(filter?: AgentFilter): AgentHandle[] {
        return this.pool.list(filter);
    }

    /**
     * Stop a specific agent
     */
    async stopAgent(agentId: string): Promise<void> {
        const handle = this.pool.get(agentId);
        if (!handle) {
            throw RuntimeError.agentNotFound(agentId);
        }

        if (handle.status === 'stopped') {
            this.logger.debug(`Agent '${agentId}' already stopped`);
            return;
        }

        // Update status
        this.pool.updateStatus(agentId, 'stopping');

        try {
            // Cancel any pending approvals
            handle.agent.services.approvalManager.cancelAllApprovals();

            // Stop the agent
            await handle.agent.stop();

            // Update status
            this.pool.updateStatus(agentId, 'stopped');

            this.logger.debug(`Stopped agent '${agentId}'`);

            // Remove from pool if ephemeral
            if (handle.ephemeral) {
                this.pool.remove(agentId);
                this.logger.debug(`Removed ephemeral agent '${agentId}' from pool`);
            }
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            this.pool.updateStatus(agentId, 'error', errorMessage);
            this.logger.error(`Failed to stop agent '${agentId}': ${errorMessage}`);
        }
    }

    /**
     * Stop all agents matching the given filter
     */
    async stopAll(filter?: AgentFilter): Promise<void> {
        const agents = this.pool.list(filter);

        this.logger.debug(`Stopping ${agents.length} agents`);

        // Stop all in parallel
        await Promise.allSettled(agents.map((handle) => this.stopAgent(handle.agentId)));
    }

    /**
     * Get the runtime configuration
     */
    getConfig(): ValidatedAgentRuntimeConfig {
        return { ...this.config };
    }

    /**
     * Get statistics about the runtime
     */
    getStats(): { totalAgents: number; byStatus: Record<string, number> } {
        const agents = this.pool.getAll();
        const byStatus: Record<string, number> = {};

        for (const agent of agents) {
            byStatus[agent.status] = (byStatus[agent.status] ?? 0) + 1;
        }

        return {
            totalAgents: agents.length,
            byStatus,
        };
    }
}

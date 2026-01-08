/**
 * RuntimeService - Bridge between tools and AgentRuntime
 *
 * Manages the relationship between a parent agent and its sub-agents,
 * providing methods that tools can call to spawn, execute tasks, and manage sub-agents.
 *
 * This service adds parent-child semantics on top of the general-purpose AgentRuntime:
 * - Uses `group` to associate spawned agents with the parent
 * - Wires up approval delegation so sub-agent tool requests go to parent
 * - Enforces per-parent agent limits
 */

import type { DextoAgent, IDextoLogger, AgentConfig } from '@dexto/core';
import {
    AgentRuntime,
    createDelegatingApprovalHandler,
    type AgentHandle,
} from '@dexto/agent-management';
import type { AgentSpawnerConfig } from './schemas.js';
import type {
    SpawnAgentOutput,
    DelegateTaskOutput,
    GetAgentStatusOutput,
    ListAgentsOutput,
    StopAgentOutput,
} from './types.js';

export class RuntimeService {
    private runtime: AgentRuntime;
    private parentId: string;
    private parentAgent: DextoAgent;
    private config: AgentSpawnerConfig;
    private logger: IDextoLogger;

    constructor(parentAgent: DextoAgent, config: AgentSpawnerConfig, logger: IDextoLogger) {
        this.parentAgent = parentAgent;
        this.config = config;
        this.logger = logger;

        // Use parent agent ID as the group identifier
        this.parentId = parentAgent.config.agentId ?? `parent-${Date.now()}`;

        // Create runtime with config
        // Note: maxAgents is global, we enforce per-parent limits in this service
        this.runtime = new AgentRuntime({
            config: {
                maxAgents: config.maxConcurrentAgents * 10, // Allow headroom for multiple parents
                defaultTaskTimeout: config.defaultTimeout,
            },
            logger,
        });

        this.logger.debug(
            `RuntimeService initialized for parent '${this.parentId}' (maxAgents: ${config.maxConcurrentAgents})`
        );
    }

    /**
     * Get count of sub-agents belonging to this parent
     */
    private getSubAgentCount(): number {
        return this.runtime.listAgents({ group: this.parentId }).length;
    }

    /**
     * Check if this parent can spawn another sub-agent
     */
    private canSpawn(): boolean {
        return this.getSubAgentCount() < this.config.maxConcurrentAgents;
    }

    /**
     * Spawn a sub-agent and execute a task
     *
     * This is the main method for the spawn_agent tool.
     * It creates a sub-agent, executes the task, and optionally cleans up.
     */
    async spawnAndExecute(input: {
        task: string;
        systemPrompt?: string;
        ephemeral?: boolean;
        timeout?: number;
    }): Promise<SpawnAgentOutput> {
        // Check if spawning is enabled
        if (!this.config.allowSpawning) {
            return {
                success: false,
                error: 'Agent spawning is disabled in configuration',
                agentId: '',
            };
        }

        // Check per-parent limit
        if (!this.canSpawn()) {
            return {
                success: false,
                error: `Maximum sub-agents limit (${this.config.maxConcurrentAgents}) reached for this parent`,
                agentId: '',
            };
        }

        const ephemeral = input.ephemeral ?? true;
        const timeout = input.timeout ?? this.config.defaultTimeout;

        try {
            // Build sub-agent config based on parent config
            const subAgentConfig = this.buildSubAgentConfig(input.systemPrompt);

            // Spawn the agent with group set to parent ID
            // Wire up approval delegation in onBeforeStart (before agent.start())
            const handle = await this.runtime.spawnAgent({
                agentConfig: subAgentConfig,
                ephemeral,
                group: this.parentId,
                metadata: {
                    parentId: this.parentId,
                    spawnedAt: new Date().toISOString(),
                },
                onBeforeStart: (agent) => {
                    // Wire up approval delegation so sub-agent tool approvals go to parent
                    // Use agent.setApprovalHandler() which stores handler for use during start()
                    const delegatingHandler = createDelegatingApprovalHandler(
                        this.parentAgent.services.approvalManager,
                        agent.config.agentId ?? 'unknown',
                        this.logger
                    );
                    agent.setApprovalHandler(delegatingHandler);
                },
            });

            this.logger.info(`Spawned sub-agent '${handle.agentId}' for parent '${this.parentId}'`);

            // Execute the task
            const result = await this.runtime.executeTask(handle.agentId, input.task, timeout);

            // If ephemeral and failed, clean up (successful ephemeral agents auto-cleanup)
            if (ephemeral && !result.success) {
                try {
                    await this.runtime.stopAgent(handle.agentId);
                } catch {
                    // Ignore cleanup errors
                }
            }

            // Build output - only include optional properties if they have values
            const output: SpawnAgentOutput = {
                success: result.success,
                agentId: handle.agentId,
                summary: result.success
                    ? `Sub-agent completed task successfully`
                    : `Sub-agent failed: ${result.error}`,
            };
            if (result.response !== undefined) {
                output.response = result.response;
            }
            if (result.error !== undefined) {
                output.error = result.error;
            }
            return output;
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            this.logger.error(`Failed to spawn and execute: ${errorMessage}`);

            return {
                success: false,
                error: errorMessage,
                agentId: '',
            };
        }
    }

    /**
     * Delegate a task to an existing (persistent) sub-agent
     */
    async delegateTask(
        agentId: string,
        task: string,
        timeout?: number
    ): Promise<DelegateTaskOutput> {
        // Check if agent exists
        const handle = this.runtime.getAgent(agentId);
        if (!handle) {
            return {
                success: false,
                error: `Sub-agent '${agentId}' not found`,
                agentId,
            };
        }

        // Check if agent belongs to this parent
        if (handle.group !== this.parentId) {
            return {
                success: false,
                error: `Sub-agent '${agentId}' does not belong to this parent`,
                agentId,
            };
        }

        try {
            const result = await this.runtime.executeTask(
                agentId,
                task,
                timeout ?? this.config.defaultTimeout
            );

            // Build output - only include optional properties if they have values
            const output: DelegateTaskOutput = {
                success: result.success,
                agentId,
            };
            if (result.response !== undefined) {
                output.response = result.response;
            }
            if (result.error !== undefined) {
                output.error = result.error;
            }
            return output;
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            return {
                success: false,
                error: errorMessage,
                agentId,
            };
        }
    }

    /**
     * Get the status of a specific sub-agent
     */
    getStatus(agentId: string): GetAgentStatusOutput {
        const handle = this.runtime.getAgent(agentId);

        if (!handle) {
            return {
                found: false,
                agentId,
                error: `Sub-agent '${agentId}' not found`,
            };
        }

        // Check if agent belongs to this parent
        if (handle.group !== this.parentId) {
            return {
                found: false,
                agentId,
                error: `Sub-agent '${agentId}' does not belong to this parent`,
            };
        }

        return {
            found: true,
            agentId,
            status: handle.status,
            ephemeral: handle.ephemeral,
            createdAt: handle.createdAt.toISOString(),
        };
    }

    /**
     * List all sub-agents for this parent
     */
    listAgents(): ListAgentsOutput {
        const subAgents = this.runtime.listAgents({ group: this.parentId });

        return {
            agents: subAgents.map((handle) => ({
                agentId: handle.agentId,
                status: handle.status,
                ephemeral: handle.ephemeral,
                createdAt: handle.createdAt.toISOString(),
            })),
            count: subAgents.length,
        };
    }

    /**
     * Stop a specific sub-agent
     */
    async stopAgent(agentId: string): Promise<StopAgentOutput> {
        const handle = this.runtime.getAgent(agentId);

        if (!handle) {
            return {
                success: false,
                agentId,
                message: 'Agent not found',
                error: `Sub-agent '${agentId}' not found`,
            };
        }

        // Check if agent belongs to this parent
        if (handle.group !== this.parentId) {
            return {
                success: false,
                agentId,
                message: 'Access denied',
                error: `Sub-agent '${agentId}' does not belong to this parent`,
            };
        }

        try {
            await this.runtime.stopAgent(agentId);

            return {
                success: true,
                agentId,
                message: `Sub-agent '${agentId}' stopped successfully`,
            };
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            return {
                success: false,
                agentId,
                message: 'Failed to stop agent',
                error: errorMessage,
            };
        }
    }

    /**
     * Build sub-agent config based on parent config
     */
    private buildSubAgentConfig(customSystemPrompt?: string): AgentConfig {
        const parentConfig = this.parentAgent.config;

        // Start with a minimal config inheriting LLM settings from parent
        const config: AgentConfig = {
            // Inherit LLM config from parent
            llm: { ...parentConfig.llm },

            // Use custom system prompt if provided, otherwise use a default
            systemPrompt:
                customSystemPrompt ??
                'You are a helpful sub-agent. Complete the task given to you efficiently and concisely.',

            // Sub-agents use manual tool confirmation which delegates to parent
            toolConfirmation: {
                mode: 'manual',
            },

            // Suppress sub-agent console logs entirely using silent transport
            logger: {
                level: 'error',
                transports: [{ type: 'silent' }],
            },
        };

        return config;
    }

    /**
     * Clean up all sub-agents (called when parent stops)
     */
    async cleanup(): Promise<void> {
        this.logger.debug(`Cleaning up RuntimeService for parent '${this.parentId}'`);
        await this.runtime.stopAll({ group: this.parentId });
    }
}

/**
 * RuntimeService - Bridge between tools and AgentRuntime
 *
 * Manages the relationship between a parent agent and its sub-agents,
 * providing methods that tools can call to spawn and execute tasks.
 *
 * This service adds parent-child semantics on top of the general-purpose AgentRuntime:
 * - Uses `group` to associate spawned agents with the parent
 * - Wires up approval delegation so sub-agent tool requests go to parent
 * - Enforces per-parent agent limits
 * - Always cleans up agents after task completion (synchronous model)
 */

import type { DextoAgent, IDextoLogger, AgentConfig } from '@dexto/core';
import { AgentRuntime } from '../runtime/AgentRuntime.js';
import { createDelegatingApprovalHandler } from '../runtime/approval-delegation.js';
import type { AgentSpawnerConfig } from './schemas.js';
import type { SpawnAgentOutput } from './types.js';

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
     * It creates a sub-agent, executes the task, and cleans up after completion.
     */
    async spawnAndExecute(input: {
        task: string;
        systemPrompt?: string;
        timeout?: number;
    }): Promise<SpawnAgentOutput> {
        // Check if spawning is enabled
        if (!this.config.allowSpawning) {
            return {
                success: false,
                error: 'Agent spawning is disabled in configuration',
            };
        }

        // Check per-parent limit
        if (!this.canSpawn()) {
            return {
                success: false,
                error: `Maximum sub-agents limit (${this.config.maxConcurrentAgents}) reached for this parent`,
            };
        }

        const timeout = input.timeout ?? this.config.defaultTimeout;

        let agentId: string | undefined;

        try {
            // Build sub-agent config based on parent config
            const subAgentConfig = this.buildSubAgentConfig(input.systemPrompt);

            // Spawn the agent with group set to parent ID
            // Wire up approval delegation in onBeforeStart (before agent.start())
            const handle = await this.runtime.spawnAgent({
                agentConfig: subAgentConfig,
                ephemeral: true,
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

            agentId = handle.agentId;
            this.logger.info(`Spawned sub-agent '${agentId}' for parent '${this.parentId}'`);

            // Execute the task
            const result = await this.runtime.executeTask(agentId, input.task, timeout);

            // Build output
            const output: SpawnAgentOutput = {
                success: result.success,
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
            };
        } finally {
            // Always clean up the agent after task completion
            if (agentId) {
                try {
                    await this.runtime.stopAgent(agentId);
                } catch {
                    // Ignore cleanup errors
                }
            }
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

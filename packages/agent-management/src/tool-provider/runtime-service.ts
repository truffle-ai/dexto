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

import path from 'path';
import type { DextoAgent, IDextoLogger, AgentConfig } from '@dexto/core';
import { AgentRuntime } from '../runtime/AgentRuntime.js';
import { createDelegatingApprovalHandler } from '../runtime/approval-delegation.js';
import { loadAgentConfig } from '../config/loader.js';
import { resolveBundledScript } from '../utils/path.js';
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
        agentRef?: string;
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
            // Build sub-agent config - either from reference or parent config
            const subAgentConfig = await this.buildSubAgentConfig(
                input.agentRef,
                input.systemPrompt
            );

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
     * Build sub-agent config based on reference or parent config
     *
     * If agentRef is provided and matches a configured agent, loads that config.
     * Otherwise, creates a minimal config inheriting LLM settings from parent.
     */
    private async buildSubAgentConfig(
        agentRef?: string,
        customSystemPrompt?: string
    ): Promise<AgentConfig> {
        // If agentRef is provided, try to load the referenced agent config
        if (agentRef) {
            const configPath = this.resolveAgentRef(agentRef);
            if (configPath) {
                this.logger.debug(`Loading agent config from: ${configPath}`);
                const loadedConfig = await loadAgentConfig(configPath, this.logger);

                // Override certain settings for sub-agent behavior
                return {
                    ...loadedConfig,
                    // Sub-agents use manual tool confirmation which delegates to parent
                    toolConfirmation: {
                        ...loadedConfig.toolConfirmation,
                        mode: 'manual' as const,
                    },
                    // Suppress sub-agent console logs entirely using silent transport
                    logger: {
                        level: 'error' as const,
                        transports: [{ type: 'silent' as const }],
                    },
                };
            }
            // If agentRef doesn't match a configured agent, log warning and fall through
            this.logger.warn(
                `Agent reference '${agentRef}' not found in configured agents. Using default config.`
            );
        }

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
                mode: 'manual' as const,
            },

            // Suppress sub-agent console logs entirely using silent transport
            logger: {
                level: 'error' as const,
                transports: [{ type: 'silent' as const }],
            },
        };

        return config;
    }

    /**
     * Get the path from an agent config entry (handles both string and object formats)
     */
    private getAgentPath(
        entry: string | { path: string; description?: string | undefined }
    ): string {
        return typeof entry === 'string' ? entry : entry.path;
    }

    /**
     * Resolve an agent reference to a config file path
     *
     * Tries multiple resolution strategies:
     * 1. If absolute path, use as-is
     * 2. Try to resolve via bundled scripts (works for installed CLI)
     * 3. Fall back to cwd-relative resolution (works for development)
     *
     * @param agentRef - Reference name from the agents map
     * @returns Resolved absolute path or null if not found
     */
    private resolveAgentRef(agentRef: string): string | null {
        const agents = this.config.agents;
        if (!agents || !agents[agentRef]) {
            return null;
        }

        const configPath = this.getAgentPath(agents[agentRef]);

        // If already absolute, return as-is
        if (path.isAbsolute(configPath)) {
            return configPath;
        }

        // Try to resolve via bundled scripts (handles installed CLI case)
        try {
            const bundledPath = resolveBundledScript(configPath);
            this.logger.debug(
                `Resolved agent ref '${agentRef}' via bundled scripts: ${bundledPath}`
            );
            return bundledPath;
        } catch {
            // Not found in bundled scripts, fall through to cwd resolution
        }

        // Fall back to cwd-relative resolution (development case)
        const cwdPath = path.resolve(process.cwd(), configPath);
        this.logger.debug(`Resolved agent ref '${agentRef}' via cwd: ${cwdPath}`);
        return cwdPath;
    }

    /**
     * Get information about configured agents for tool description
     * Returns array of { name, description } for each configured agent
     */
    getConfiguredAgents(): Array<{ name: string; description?: string }> {
        const agents = this.config.agents;
        if (!agents) {
            return [];
        }

        return Object.entries(agents).map(([name, entry]) => {
            const result: { name: string; description?: string } = { name };
            if (typeof entry === 'object' && entry.description) {
                result.description = entry.description;
            }
            return result;
        });
    }

    /**
     * Clean up all sub-agents (called when parent stops)
     */
    async cleanup(): Promise<void> {
        this.logger.debug(`Cleaning up RuntimeService for parent '${this.parentId}'`);
        await this.runtime.stopAll({ group: this.parentId });
    }
}

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

import type { DextoAgent, IDextoLogger, AgentConfig, TaskForker } from '@dexto/core';
import { AgentRuntime } from '../runtime/AgentRuntime.js';
import { createDelegatingApprovalHandler } from '../runtime/approval-delegation.js';
import { loadAgentConfig } from '../config/loader.js';
import { getAgentRegistry } from '../registry/registry.js';
import type { AgentRegistryEntry } from '../registry/types.js';
import type { AgentSpawnerConfig } from './schemas.js';
import type { SpawnAgentOutput } from './types.js';
import { resolveSubAgentLLM } from './llm-resolution.js';

export class RuntimeService implements TaskForker {
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
                maxAgents: config.maxConcurrentAgents,
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
     * If the sub-agent's LLM config fails, automatically falls back to parent's LLM.
     *
     * @param input.task - Short task description (for logging/UI)
     * @param input.instructions - Full prompt sent to sub-agent
     * @param input.agentId - Optional agent ID from registry
     * @param input.autoApprove - Optional override for auto-approve (used by fork skills)
     * @param input.timeout - Optional task timeout in milliseconds
     * @param input.toolCallId - Optional tool call ID for progress events
     * @param input.sessionId - Optional session ID for progress events
     */
    async spawnAndExecute(input: {
        task: string;
        instructions: string;
        agentId?: string;
        autoApprove?: boolean;
        timeout?: number;
        toolCallId?: string;
        sessionId?: string;
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

        // Validate agentId against allowedAgents if configured
        if (input.agentId && this.config.allowedAgents) {
            if (!this.config.allowedAgents.includes(input.agentId)) {
                return {
                    success: false,
                    error: `Agent '${input.agentId}' is not in the allowed agents list. Allowed: ${this.config.allowedAgents.join(', ')}`,
                };
            }
        }

        const timeout = input.timeout ?? this.config.defaultTimeout;

        // Determine autoApprove: explicit input > config-level autoApproveAgents > false
        const autoApprove =
            input.autoApprove !== undefined
                ? input.autoApprove
                : !!(input.agentId && this.config.autoApproveAgents?.includes(input.agentId));

        // Try with sub-agent's config first, fall back to parent's LLM if it fails
        const result = await this.trySpawnWithFallback(
            input,
            timeout,
            autoApprove,
            input.toolCallId,
            input.sessionId
        );
        return result;
    }

    /**
     * Fork execution to an isolated subagent.
     * Implements TaskForker interface for use by invoke_skill when context: fork is set.
     *
     * @param options.task - Short description for UI/logs
     * @param options.instructions - Full instructions for the subagent
     * @param options.agentId - Optional agent ID from registry to use for execution
     * @param options.autoApprove - Auto-approve tool calls (default: true for fork skills)
     * @param options.toolCallId - Optional tool call ID for progress events
     * @param options.sessionId - Optional session ID for progress events
     */
    async fork(options: {
        task: string;
        instructions: string;
        agentId?: string;
        autoApprove?: boolean;
        toolCallId?: string;
        sessionId?: string;
    }): Promise<{ success: boolean; response?: string; error?: string }> {
        // Delegate to spawnAndExecute, passing options
        // Only include optional properties when they have values (exactOptionalPropertyTypes)
        const spawnOptions: {
            task: string;
            instructions: string;
            agentId?: string;
            autoApprove?: boolean;
            toolCallId?: string;
            sessionId?: string;
        } = {
            task: options.task,
            instructions: options.instructions,
        };
        if (options.agentId) {
            spawnOptions.agentId = options.agentId;
        }
        if (options.autoApprove !== undefined) {
            spawnOptions.autoApprove = options.autoApprove;
        }
        if (options.toolCallId) {
            spawnOptions.toolCallId = options.toolCallId;
        }
        if (options.sessionId) {
            spawnOptions.sessionId = options.sessionId;
        }
        return this.spawnAndExecute(spawnOptions);
    }

    /**
     * Set up progress event emission for a sub-agent.
     * Subscribes to llm:tool-call and llm:response events and emits service:event with progress data.
     *
     * @returns Cleanup function to unsubscribe from events
     */
    private setupProgressTracking(
        subAgentHandle: { agentId: string; agent: DextoAgent },
        input: { task: string; agentId?: string },
        toolCallId?: string,
        sessionId?: string
    ): () => void {
        // Don't set up progress tracking if no toolCallId or sessionId (no parent to report to)
        if (!toolCallId || !sessionId) {
            this.logger.debug(
                `[Progress] Skipping progress tracking - missing toolCallId (${toolCallId}) or sessionId (${sessionId})`
            );
            return () => {};
        }

        this.logger.debug(
            `[Progress] Setting up progress tracking for sub-agent ${subAgentHandle.agentId} (toolCallId: ${toolCallId}, sessionId: ${sessionId})`
        );

        let toolCount = 0;
        // Token usage tracking - reflects context window utilization (matches parent CLI formula):
        // - input: REPLACED each call (current context size, not cumulative API billing)
        // - output: ACCUMULATED across all calls (total generated tokens)
        // - total: lastInput + cumulativeOutput
        // This shows "how full is the context window" rather than "total API cost across all calls".
        // For billing, you'd need to sum all inputTokens across calls, but that's not useful for
        // understanding context limits. See: processStream.ts line 728 for parent formula.
        const tokenUsage = { input: 0, output: 0, total: 0 };
        // Track current tool for emissions (persists between events)
        let currentTool = '';

        const subAgentBus = subAgentHandle.agent.agentEventBus;
        const parentBus = this.parentAgent.agentEventBus;

        // Helper to emit progress event
        const emitProgress = (tool: string, args?: Record<string, unknown>) => {
            parentBus.emit('service:event', {
                service: 'agent-spawner',
                event: 'progress',
                toolCallId,
                sessionId,
                data: {
                    task: input.task,
                    agentId: input.agentId ?? 'default',
                    toolsCalled: toolCount,
                    currentTool: tool,
                    currentArgs: args,
                    tokenUsage: { ...tokenUsage },
                },
            });
        };

        // Handler for llm:tool-call events
        const toolCallHandler = (event: {
            toolName: string;
            args: Record<string, unknown>;
            sessionId: string;
        }) => {
            toolCount++;
            // Strip prefixes from tool name for cleaner display
            let displayToolName = event.toolName;
            if (displayToolName.startsWith('internal--')) {
                displayToolName = displayToolName.replace('internal--', '');
            } else if (displayToolName.startsWith('custom--')) {
                displayToolName = displayToolName.replace('custom--', '');
            } else if (displayToolName.startsWith('mcp--')) {
                // For MCP tools, extract just the tool name (skip server prefix)
                const parts = displayToolName.split('--');
                if (parts.length >= 3) {
                    displayToolName = parts.slice(2).join('--');
                }
            }
            currentTool = displayToolName;
            this.logger.debug(
                `[Progress] Sub-agent tool call #${toolCount}: ${displayToolName} (toolCallId: ${toolCallId})`
            );
            emitProgress(displayToolName, event.args);
        };

        // Handler for llm:response events - accumulate token usage
        const responseHandler = (event: {
            tokenUsage?: {
                inputTokens?: number;
                outputTokens?: number;
                totalTokens?: number;
            };
            sessionId: string;
        }) => {
            if (event.tokenUsage) {
                // Replace input tokens (most recent call's context) - matches parent CLI formula
                tokenUsage.input = event.tokenUsage.inputTokens ?? 0;
                // Accumulate output tokens
                tokenUsage.output += event.tokenUsage.outputTokens ?? 0;
                // Total = lastInput + cumulativeOutput (consistent with parent)
                tokenUsage.total = tokenUsage.input + tokenUsage.output;
                this.logger.debug(
                    `[Progress] Sub-agent tokens: input=${tokenUsage.input}, cumOutput=${tokenUsage.output}, total=${tokenUsage.total}`
                );
                // Emit updated progress with new token counts
                emitProgress(currentTool || 'processing');
            }
        };

        // Subscribe to sub-agent's events
        subAgentBus.on('llm:tool-call', toolCallHandler);
        subAgentBus.on('llm:response', responseHandler);

        // Return cleanup function
        return () => {
            subAgentBus.off('llm:tool-call', toolCallHandler);
            subAgentBus.off('llm:response', responseHandler);
        };
    }

    /**
     * Try to spawn agent, falling back to parent's LLM config if the sub-agent's config fails
     */
    private async trySpawnWithFallback(
        input: { task: string; instructions: string; agentId?: string },
        timeout: number,
        autoApprove: boolean,
        toolCallId?: string,
        sessionId?: string
    ): Promise<SpawnAgentOutput> {
        let spawnedAgentId: string | undefined;
        let usedFallback = false;
        let cleanupProgressTracking: (() => void) | undefined;

        try {
            // Build options object
            const buildOptions: {
                agentId?: string;
                inheritLlm?: boolean;
                autoApprove?: boolean;
            } = {};

            if (input.agentId !== undefined) {
                buildOptions.agentId = input.agentId;
            }
            if (autoApprove) {
                buildOptions.autoApprove = autoApprove;
            }

            // Try with sub-agent's config first
            let subAgentConfig = await this.buildSubAgentConfig(buildOptions);

            let handle: { agentId: string; agent: DextoAgent };

            try {
                // Spawn the agent
                handle = await this.runtime.spawnAgent({
                    agentConfig: subAgentConfig,
                    ephemeral: true,
                    group: this.parentId,
                    metadata: {
                        parentId: this.parentId,
                        task: input.task,
                        autoApprove,
                        spawnedAt: new Date().toISOString(),
                    },
                    onBeforeStart: (agent) => {
                        if (!autoApprove) {
                            const delegatingHandler = createDelegatingApprovalHandler(
                                this.parentAgent.services.approvalManager,
                                agent.config.agentId ?? 'unknown',
                                this.logger
                            );
                            agent.setApprovalHandler(delegatingHandler);
                        }
                    },
                });
                spawnedAgentId = handle.agentId;
            } catch (spawnError) {
                // Check if it's an LLM-related error (model not supported, API key missing, etc.)
                const errorMsg =
                    spawnError instanceof Error ? spawnError.message : String(spawnError);
                const isLlmError =
                    errorMsg.includes('Model') ||
                    errorMsg.includes('model') ||
                    errorMsg.includes('API') ||
                    errorMsg.includes('apiKey') ||
                    errorMsg.includes('provider');

                if (isLlmError && input.agentId) {
                    // Fallback: retry with parent's full LLM config
                    // This can happen if:
                    // - Model transformation failed for the sub-agent's model
                    // - API rate limits or other provider-specific errors
                    // - Edge cases in LLM resolution
                    this.logger.warn(
                        `Sub-agent '${input.agentId}' LLM config failed: ${errorMsg}. ` +
                            `Falling back to parent's full LLM config.`
                    );
                    usedFallback = true;

                    buildOptions.inheritLlm = true;
                    subAgentConfig = await this.buildSubAgentConfig(buildOptions);

                    handle = await this.runtime.spawnAgent({
                        agentConfig: subAgentConfig,
                        ephemeral: true,
                        group: this.parentId,
                        metadata: {
                            parentId: this.parentId,
                            task: input.task,
                            autoApprove,
                            usedLlmFallback: true,
                            spawnedAt: new Date().toISOString(),
                        },
                        onBeforeStart: (agent) => {
                            if (!autoApprove) {
                                const delegatingHandler = createDelegatingApprovalHandler(
                                    this.parentAgent.services.approvalManager,
                                    agent.config.agentId ?? 'unknown',
                                    this.logger
                                );
                                agent.setApprovalHandler(delegatingHandler);
                            }
                        },
                    });
                    spawnedAgentId = handle.agentId;
                } else {
                    // Not an LLM error or no agentId, re-throw
                    throw spawnError;
                }
            }

            this.logger.info(
                `Spawned sub-agent '${spawnedAgentId}' for task: ${input.task}${autoApprove ? ' (auto-approve)' : ''}${usedFallback ? ' (using parent LLM)' : ''}`
            );

            // Set up progress event tracking before executing
            cleanupProgressTracking = this.setupProgressTracking(
                handle,
                input,
                toolCallId,
                sessionId
            );

            // Execute with the full instructions
            const result = await this.runtime.executeTask(
                spawnedAgentId,
                input.instructions,
                timeout
            );

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
            if (usedFallback) {
                output.warning = `Sub-agent '${input.agentId}' used fallback LLM (parent's full config) due to an error with its configured model.`;
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
            // Clean up progress tracking
            if (cleanupProgressTracking) {
                cleanupProgressTracking();
            }

            // Always clean up the agent after task completion
            if (spawnedAgentId) {
                try {
                    await this.runtime.stopAgent(spawnedAgentId);
                } catch {
                    // Ignore cleanup errors
                }
            }
        }
    }

    /**
     * Build sub-agent config based on registry agent ID or parent config
     *
     * @param options.agentId - Agent ID from registry
     * @param options.inheritLlm - Use parent's LLM config instead of sub-agent's
     * @param options.autoApprove - Auto-approve all tool calls
     */
    private async buildSubAgentConfig(options: {
        agentId?: string;
        inheritLlm?: boolean;
        autoApprove?: boolean;
    }): Promise<AgentConfig> {
        const { agentId, inheritLlm, autoApprove } = options;
        const parentConfig = this.parentAgent.config;

        // Determine tool confirmation mode
        const toolConfirmationMode = autoApprove ? ('auto-approve' as const) : ('manual' as const);

        // If agentId is provided, resolve from registry
        if (agentId) {
            const registry = getAgentRegistry();

            if (!registry.hasAgent(agentId)) {
                this.logger.warn(`Agent '${agentId}' not found in registry. Using default config.`);
            } else {
                // resolveAgent handles installation if needed
                const configPath = await registry.resolveAgent(agentId);
                this.logger.debug(`Loading agent config from registry: ${configPath}`);
                const loadedConfig = await loadAgentConfig(configPath, this.logger);

                // Determine LLM config based on options
                let llmConfig = loadedConfig.llm;

                if (inheritLlm) {
                    // Use parent's full LLM config (fallback mode after first attempt failed)
                    this.logger.debug(
                        `Sub-agent '${agentId}' using parent LLM config (inheritLlm=true)`
                    );
                    llmConfig = { ...parentConfig.llm };
                } else {
                    // Resolve optimal LLM: try to use sub-agent's model with parent's provider
                    const resolution = resolveSubAgentLLM({
                        subAgentLLM: loadedConfig.llm,
                        parentLLM: parentConfig.llm,
                        subAgentId: agentId,
                    });
                    this.logger.debug(`Sub-agent LLM resolution: ${resolution.reason}`);
                    llmConfig = resolution.llm;
                }

                // Override certain settings for sub-agent behavior
                return {
                    ...loadedConfig,
                    llm: llmConfig,
                    toolConfirmation: {
                        ...loadedConfig.toolConfirmation,
                        mode: toolConfirmationMode,
                    },
                    // Suppress sub-agent console logs entirely using silent transport
                    logger: {
                        level: 'error' as const,
                        transports: [{ type: 'silent' as const }],
                    },
                };
            }
        }

        // Start with a config inheriting LLM and tools from parent
        const config: AgentConfig = {
            llm: { ...parentConfig.llm },

            // Default system prompt for sub-agents
            systemPrompt:
                'You are a helpful sub-agent. Complete the task given to you efficiently and concisely.',

            toolConfirmation: {
                mode: toolConfirmationMode,
            },

            // Inherit MCP servers from parent so subagent has tool access
            mcpServers: parentConfig.mcpServers ? { ...parentConfig.mcpServers } : {},

            // Inherit internal tools from parent, excluding tools that don't work in subagent context
            // - ask_user: Subagents can't interact with the user directly
            // - invoke_skill: Avoid nested skill invocations for simplicity
            internalTools: parentConfig.internalTools
                ? parentConfig.internalTools.filter(
                      (tool) => tool !== 'ask_user' && tool !== 'invoke_skill'
                  )
                : [],

            // Inherit custom tools from parent
            customTools: parentConfig.customTools ? [...parentConfig.customTools] : [],

            // Suppress sub-agent console logs entirely using silent transport
            logger: {
                level: 'error' as const,
                transports: [{ type: 'silent' as const }],
            },
        };

        return config;
    }

    /**
     * Get information about available agents for tool description.
     * Returns agent metadata from registry, filtered by allowedAgents if configured.
     */
    getAvailableAgents(): AgentRegistryEntry[] {
        const registry = getAgentRegistry();
        const allAgents = registry.getAvailableAgents();

        // If allowedAgents is configured, filter to only those
        if (this.config.allowedAgents && this.config.allowedAgents.length > 0) {
            const result: AgentRegistryEntry[] = [];
            for (const id of this.config.allowedAgents) {
                const agent = allAgents[id];
                if (agent) {
                    result.push(agent);
                }
            }
            return result;
        }

        // Otherwise return all registry agents
        return Object.values(allAgents);
    }

    /**
     * Clean up all sub-agents (called when parent stops)
     */
    async cleanup(): Promise<void> {
        this.logger.debug(`Cleaning up RuntimeService for parent '${this.parentId}'`);
        await this.runtime.stopAll({ group: this.parentId });
    }
}

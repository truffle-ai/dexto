/**
 * AgentSpawnerRuntime - Bridge between tools and AgentRuntime
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

import { randomUUID } from 'crypto';
import type { AgentConfig } from '@dexto/agent-config';
import type { DextoAgent, Logger, TaskForker } from '@dexto/core';
import {
    DextoRuntimeError,
    ErrorType,
    getReasoningProfile,
    supportsReasoningVariant,
} from '@dexto/core';
import { AgentRuntime } from '../../runtime/AgentRuntime.js';
import { createDelegatingApprovalHandler } from '../../runtime/approval-delegation.js';
import { loadAgentConfig } from '../../config/loader.js';
import { getAgentRegistry } from '../../registry/registry.js';
import type { AgentRegistryEntry } from '../../registry/types.js';
import { deriveDisplayName } from '../../registry/types.js';
import { getDextoPath, resolveBundledScript } from '../../utils/path.js';
import * as path from 'path';
import {
    DEFAULT_SUB_AGENT_MAX_ITERATIONS,
    DEFAULT_SUB_AGENT_REASONING_VARIANT,
    type AgentSpawnerConfig,
} from './schemas.js';
import type { SpawnAgentOutput } from './types.js';
import { resolveSubAgentLLM } from './llm-resolution.js';

export class AgentSpawnerRuntime implements TaskForker {
    private runtime: AgentRuntime;
    private parentId: string;
    private parentAgent: DextoAgent;
    private config: AgentSpawnerConfig;
    private logger: Logger;

    private selectLowestReasoningVariant(
        provider: AgentConfig['llm']['provider'],
        model: AgentConfig['llm']['model'],
        preferredVariant: string
    ): string | undefined {
        const profile = getReasoningProfile(provider, model);
        if (!profile.capable || profile.supportedVariants.length === 0) {
            return undefined;
        }

        if (supportsReasoningVariant(profile, preferredVariant)) {
            return preferredVariant;
        }

        const fallbackOrder = [
            'disabled',
            'none',
            'minimal',
            'low',
            'enabled',
            'medium',
            'high',
            'max',
            'xhigh',
        ];

        for (const variant of fallbackOrder) {
            if (supportsReasoningVariant(profile, variant)) {
                return variant;
            }
        }

        return profile.defaultVariant ?? profile.supportedVariants[0];
    }

    private applySubAgentLlmPolicy(llm: AgentConfig['llm']): AgentConfig['llm'] {
        const maxIterationsCap =
            this.config.subAgentMaxIterations ?? DEFAULT_SUB_AGENT_MAX_ITERATIONS;
        const preferredReasoningVariant =
            this.config.subAgentReasoningVariant ?? DEFAULT_SUB_AGENT_REASONING_VARIANT;
        const reasoningVariant = this.selectLowestReasoningVariant(
            llm.provider,
            llm.model,
            preferredReasoningVariant
        );

        const existingMaxIterations = llm.maxIterations;
        const cappedMaxIterations =
            typeof existingMaxIterations === 'number'
                ? Math.min(existingMaxIterations, maxIterationsCap)
                : maxIterationsCap;

        const adjusted = {
            ...llm,
            maxIterations: cappedMaxIterations,
            ...(reasoningVariant !== undefined
                ? { reasoning: { variant: reasoningVariant } }
                : { reasoning: undefined }),
        };

        this.logger.debug(
            `[AgentSpawnerRuntime] Applied sub-agent LLM policy: maxIterations=${adjusted.maxIterations}, preferredReasoning=${preferredReasoningVariant}, selectedReasoning=${reasoningVariant ?? 'none'}`
        );

        return adjusted;
    }

    private resolveBundledAgentConfig(agentId: string): string | null {
        const baseDir = 'agents';
        const normalizedPath = path.relative(baseDir, path.join(baseDir, agentId));
        if (normalizedPath.startsWith('..') || path.isAbsolute(normalizedPath)) {
            return null;
        }

        const candidates = [
            `agents/${agentId}/${agentId}.yml`,
            `agents/${agentId}/${agentId}.yaml`,
            `agents/${agentId}.yml`,
            `agents/${agentId}.yaml`,
        ];

        for (const candidate of candidates) {
            try {
                return resolveBundledScript(candidate);
            } catch {
                // Try the next candidate
            }
        }

        return null;
    }

    private createFallbackRegistryEntry(agentId: string): AgentRegistryEntry {
        return {
            id: agentId,
            name: deriveDisplayName(agentId),
            description: 'Agent specified in config (registry entry not found)',
            author: 'unknown',
            tags: [],
            source: agentId,
            type: 'custom',
        };
    }

    constructor(parentAgent: DextoAgent, config: AgentSpawnerConfig, logger: Logger) {
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
            `AgentSpawnerRuntime initialized for parent '${this.parentId}' (maxAgents: ${config.maxConcurrentAgents})`
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
        return this.spawnAndExecute(options);
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

        // Helper to emit progress event
        const emitProgress = (tool: string, args?: Record<string, unknown>) => {
            const subAgentLogFilePath = this.getSubAgentLogFilePath({
                runtimeAgentId: subAgentHandle.agentId,
                sessionId,
            });

            this.parentAgent.emit('service:event', {
                service: 'agent-spawner',
                event: 'progress',
                toolCallId,
                sessionId,
                data: {
                    task: input.task,
                    agentId: input.agentId ?? 'default',
                    runtimeAgentId: subAgentHandle.agentId,
                    ...(subAgentLogFilePath ? { subAgentLogFilePath } : {}),
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
            let displayToolName = event.toolName;
            if (displayToolName.startsWith('mcp--')) {
                // For MCP tools, extract just the tool name (skip server prefix)
                const trimmed = displayToolName.substring('mcp--'.length);
                const parts = trimmed.split('--');
                displayToolName = parts.length >= 2 ? parts.slice(1).join('--') : trimmed;
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
        subAgentHandle.agent.on('llm:tool-call', toolCallHandler);
        subAgentHandle.agent.on('llm:response', responseHandler);

        // Return cleanup function
        return () => {
            subAgentHandle.agent.off('llm:tool-call', toolCallHandler);
            subAgentHandle.agent.off('llm:response', responseHandler);
        };
    }

    /**
     * Ensure spawned agent inherits the parent's workspace context.
     */
    private async applyParentWorkspace(agent: DextoAgent): Promise<void> {
        let parentWorkspace: Awaited<ReturnType<DextoAgent['getWorkspace']>>;
        try {
            parentWorkspace = await this.parentAgent.getWorkspace();
        } catch (error) {
            this.logger.warn(
                `Failed to read parent workspace for sub-agent: ${error instanceof Error ? error.message : String(error)}`
            );
            return;
        }

        if (!parentWorkspace?.path) {
            return;
        }

        try {
            await agent.setWorkspace({
                path: parentWorkspace.path,
                ...(parentWorkspace.name ? { name: parentWorkspace.name } : {}),
            });
        } catch (error) {
            this.logger.warn(
                `Failed to apply parent workspace to sub-agent: ${error instanceof Error ? error.message : String(error)}`
            );
        }
    }

    private getSubAgentLogFilePath(options: {
        runtimeAgentId: string;
        sessionId?: string;
    }): string | null {
        const { runtimeAgentId, sessionId } = options;

        if (!sessionId) {
            return null;
        }

        const safeSessionId = sessionId.replace(/[^a-zA-Z0-9._-]/g, '_');
        // Keep sub-agent logs next to the parent session log for easy discovery.
        // Parent session log: logs/<parentId>/<safeSessionId>.log
        // Sub-agent log:      logs/<parentId>/<safeSessionId>.subagent.<runtimeAgentId>.log
        // TODO(logging): If we ever want sub-agent logs in the *same* parent session log file,
        // we should share a single FileTransport instance between parent session + sub-agents.
        // Separate FileTransport instances writing to the same file can interleave/corrupt JSON lines.
        return getDextoPath(
            'logs',
            path.join(this.parentId, `${safeSessionId}.subagent.${runtimeAgentId}.log`)
        );
    }

    /**
     * Check if an error is LLM-related (API errors, credit issues, model not found, etc.)
     */
    private isLLMError(error: unknown): boolean {
        // Prefer typed runtime errors first
        if (error instanceof DextoRuntimeError) {
            // Explicit LLM-scoped errors
            if (error.scope === 'llm') return true;

            // Payment / quota style errors should trigger fallback
            if (error.type === ErrorType.PAYMENT_REQUIRED || error.type === ErrorType.FORBIDDEN) {
                return true;
            }
        }

        // Last-resort heuristic matching (legacy / untyped errors)
        const msg = error instanceof Error ? error.message : String(error);
        return (
            msg.includes('model') ||
            msg.includes('provider') ||
            msg.includes('rate limit') ||
            msg.includes('quota')
        );
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
        type LlmMode = 'subagent' | 'parent';
        let llmMode: LlmMode = 'subagent';
        let cleanupProgressTracking: (() => void) | undefined;

        try {
            // Build options object
            const buildOptions: {
                agentId?: string;
                inheritLlm?: boolean;
                autoApprove?: boolean;
                runtimeAgentId: string;
            } = {
                // Pre-generate the runtime agentId so we can deterministically route logs.
                runtimeAgentId: `agent-${randomUUID().slice(0, 8)}`,
            };

            if (input.agentId !== undefined) {
                buildOptions.agentId = input.agentId;
            }
            if (autoApprove) {
                buildOptions.autoApprove = autoApprove;
            }

            // Try with sub-agent's config first
            let subAgentConfig = await this.buildSubAgentConfig(buildOptions, sessionId);

            let handle: { agentId: string; agent: DextoAgent };

            try {
                // Spawn the agent
                handle = await this.runtime.spawnAgent({
                    agentId: buildOptions.runtimeAgentId,
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
                                sessionId,
                                this.logger
                            );
                            agent.setApprovalHandler(delegatingHandler);
                        }
                    },
                });
                spawnedAgentId = handle.agentId;
                await this.applyParentWorkspace(handle.agent);
            } catch (spawnError) {
                // Check if it's an LLM-related error (model not supported, API key missing, etc.)
                const isLlmError = this.isLLMError(spawnError);

                if (isLlmError && input.agentId && llmMode === 'subagent') {
                    // Fallback: retry with parent's full LLM config
                    // This can happen if:
                    // - Model transformation failed for the sub-agent's model
                    // - API rate limits or other provider-specific errors
                    // - Edge cases in LLM resolution
                    const errorMsg =
                        spawnError instanceof Error ? spawnError.message : String(spawnError);
                    this.logger.warn(
                        `Sub-agent '${input.agentId}' LLM config failed: ${errorMsg}. ` +
                            `Falling back to parent's full LLM config.`
                    );

                    llmMode = 'parent';

                    buildOptions.inheritLlm = true;
                    subAgentConfig = await this.buildSubAgentConfig(buildOptions, sessionId);

                    handle = await this.runtime.spawnAgent({
                        agentId: buildOptions.runtimeAgentId,
                        agentConfig: subAgentConfig,
                        ephemeral: true,
                        group: this.parentId,
                        metadata: {
                            parentId: this.parentId,
                            task: input.task,
                            autoApprove,
                            llmMode: 'parent',
                            fallbackStage: 'spawn',
                            spawnedAt: new Date().toISOString(),
                        },
                        onBeforeStart: (agent) => {
                            if (!autoApprove) {
                                const delegatingHandler = createDelegatingApprovalHandler(
                                    this.parentAgent.services.approvalManager,
                                    agent.config.agentId ?? 'unknown',
                                    sessionId,
                                    this.logger
                                );
                                agent.setApprovalHandler(delegatingHandler);
                            }
                        },
                    });
                    spawnedAgentId = handle.agentId;
                    await this.applyParentWorkspace(handle.agent);
                } else {
                    // Not an LLM error or already used fallback or no agentId
                    throw spawnError;
                }
            }

            this.logger.info(
                `Spawned sub-agent '${spawnedAgentId}' for task: ${input.task}${autoApprove ? ' (auto-approve)' : ''}${llmMode === 'parent' ? ' (using parent LLM)' : ''}`
            );

            const subAgentLogFilePath = this.getSubAgentLogFilePath(
                sessionId
                    ? { runtimeAgentId: buildOptions.runtimeAgentId, sessionId }
                    : { runtimeAgentId: buildOptions.runtimeAgentId }
            );
            if (subAgentLogFilePath) {
                this.logger.info(`Sub-agent logs: ${subAgentLogFilePath}`);
            }

            // Always write a pointer into the parent session log (the file users tail in the CLI).
            if (sessionId) {
                const parentSession = await this.parentAgent.getSession(sessionId);
                if (parentSession) {
                    parentSession.logger.info('Sub-agent spawned', {
                        runtimeAgentId: spawnedAgentId,
                        registryAgentId: input.agentId ?? 'default',
                        task: input.task,
                        ...(subAgentLogFilePath ? { subAgentLogFilePath } : {}),
                    });
                }
            }

            // Set up progress event tracking before executing
            cleanupProgressTracking = this.setupProgressTracking(
                handle,
                input,
                toolCallId,
                sessionId
            );

            // Execute with the full instructions
            let result: import('../../runtime/types.js').TaskResult;
            try {
                result = await this.runtime.executeTask(
                    spawnedAgentId,
                    input.instructions,
                    timeout
                );
            } catch (execError) {
                // Check if it's an LLM-related error during execution
                const isLlmExecError = this.isLLMError(execError);

                if (llmMode === 'parent') {
                    throw execError;
                }

                // Only retry if we haven't already used fallback and have an agentId
                if (isLlmExecError && input.agentId && llmMode === 'subagent') {
                    this.logger.warn(
                        `Sub-agent '${input.agentId}' LLM error during execution: ${execError instanceof Error ? execError.message : String(execError)}. ` +
                            `Retrying with parent's full LLM config.`
                    );

                    // Clean up the failed agent
                    try {
                        await this.runtime.stopAgent(spawnedAgentId);
                    } catch {
                        // Ignore cleanup errors
                    }

                    // Clean up progress tracking for the failed agent
                    if (cleanupProgressTracking) {
                        cleanupProgressTracking();
                    }

                    // Rebuild config with parent's LLM
                    llmMode = 'parent';
                    buildOptions.inheritLlm = true;
                    subAgentConfig = await this.buildSubAgentConfig(buildOptions, sessionId);

                    // Spawn new agent with parent's LLM config
                    handle = await this.runtime.spawnAgent({
                        agentId: buildOptions.runtimeAgentId,
                        agentConfig: subAgentConfig,
                        ephemeral: true,
                        group: this.parentId,
                        metadata: {
                            parentId: this.parentId,
                            task: input.task,
                            autoApprove,
                            llmMode: 'parent',
                            fallbackStage: 'execution',
                            spawnedAt: new Date().toISOString(),
                        },
                        onBeforeStart: (agent) => {
                            if (!autoApprove) {
                                const delegatingHandler = createDelegatingApprovalHandler(
                                    this.parentAgent.services.approvalManager,
                                    agent.config.agentId ?? 'unknown',
                                    sessionId,
                                    this.logger
                                );
                                agent.setApprovalHandler(delegatingHandler);
                            }
                        },
                    });
                    spawnedAgentId = handle.agentId;
                    await this.applyParentWorkspace(handle.agent);

                    this.logger.info(
                        `Re-spawned sub-agent '${spawnedAgentId}' for task: ${input.task} (using parent LLM)`
                    );

                    // Set up progress tracking for new agent
                    cleanupProgressTracking = this.setupProgressTracking(
                        handle,
                        input,
                        toolCallId,
                        sessionId
                    );

                    // Retry execution with new agent
                    result = await this.runtime.executeTask(
                        spawnedAgentId,
                        input.instructions,
                        timeout
                    );
                } else {
                    // Not an LLM error, already used fallback, or no agentId - re-throw
                    throw execError;
                }
            }

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
            if (llmMode === 'parent') {
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
     * @param sessionId - Optional session ID to get session-specific LLM config
     */
    private async buildSubAgentConfig(
        options: {
            agentId?: string;
            inheritLlm?: boolean;
            autoApprove?: boolean;
            runtimeAgentId: string;
        },
        sessionId?: string
    ): Promise<AgentConfig> {
        const { agentId, inheritLlm, autoApprove, runtimeAgentId } = options;
        const parentSettings = this.parentAgent.config;

        // Get runtime LLM config (respects session-specific model switches)
        const currentParentLLM = this.parentAgent.getCurrentLLMConfig(sessionId);
        this.logger.debug(
            `[AgentSpawnerRuntime] Building sub-agent config with LLM: ${currentParentLLM.provider}/${currentParentLLM.model}` +
                (sessionId ? ` (sessionId: ${sessionId})` : ' (no sessionId)')
        );

        // Determine permissions mode (auto-approve vs manual)
        const permissionsMode = autoApprove ? ('auto-approve' as const) : ('manual' as const);

        const parentToolPolicies = parentSettings.permissions?.toolPolicies;
        const mergeToolPolicies = (subAgentPolicies?: {
            alwaysAllow?: string[] | undefined;
            alwaysDeny?: string[] | undefined;
        }): { alwaysAllow: string[]; alwaysDeny: string[] } => {
            const alwaysAllow = [
                ...(parentToolPolicies?.alwaysAllow ?? []),
                ...(subAgentPolicies?.alwaysAllow ?? []),
            ];
            const alwaysDeny = [
                ...(parentToolPolicies?.alwaysDeny ?? []),
                ...(subAgentPolicies?.alwaysDeny ?? []),
            ];

            return {
                alwaysAllow: Array.from(new Set(alwaysAllow)),
                alwaysDeny: Array.from(new Set(alwaysDeny)),
            };
        };

        // In interactive CLI, base agent logging is typically silent to avoid interfering with Ink.
        // Sub-agents should still be debuggable, so when we have an active session log file,
        // route sub-agent logs to a file under that session.
        const inheritedLoggerConfig = await (async () => {
            if (!sessionId) {
                return undefined;
            }

            const session = await this.parentAgent.getSession(sessionId);
            if (!session) {
                return undefined;
            }

            // Only apply file logging override when the parent session has a file logger.
            // (Interactive CLI uses session-scoped file logs; other hosts may not.)
            const parentSessionLogPath = session.logger.getLogFilePath();
            if (!parentSessionLogPath) {
                return undefined;
            }

            const subAgentLogFilePath = this.getSubAgentLogFilePath({ runtimeAgentId, sessionId });
            if (!subAgentLogFilePath) {
                return undefined;
            }

            return {
                level: session.logger.getLevel(),
                transports: [{ type: 'file' as const, path: subAgentLogFilePath }],
            };
        })();

        // If agentId is provided, resolve from registry
        if (agentId) {
            let configPath: string | null = null;
            try {
                const registry = getAgentRegistry();

                if (!registry.hasAgent(agentId)) {
                    this.logger.warn(
                        `Agent '${agentId}' not found in registry. Trying bundled config paths.`
                    );
                } else {
                    // resolveAgent handles installation if needed
                    configPath = await registry.resolveAgent(agentId);
                }
            } catch (error) {
                this.logger.warn(
                    `Failed to load agent registry for '${agentId}'. Trying bundled config paths. (${error instanceof Error ? error.message : String(error)})`
                );
            }

            if (!configPath) {
                configPath = this.resolveBundledAgentConfig(agentId);
            }

            if (configPath) {
                this.logger.debug(`Loading agent config from registry/bundled path: ${configPath}`);
                const loadedConfig = await loadAgentConfig(configPath, this.logger);

                // Determine LLM config based on options
                let llmConfig = loadedConfig.llm;

                if (inheritLlm) {
                    // Use parent's full LLM config (fallback mode)
                    this.logger.debug(
                        `Sub-agent '${agentId}' using parent LLM config (inheritLlm=true)`
                    );
                    llmConfig = { ...currentParentLLM };
                } else {
                    // Resolve optimal LLM: prefer sub-agent's model with parent's credentials
                    const resolution = resolveSubAgentLLM({
                        subAgentLLM: loadedConfig.llm,
                        parentLLM: currentParentLLM,
                        subAgentId: agentId,
                    });
                    this.logger.debug(`Sub-agent LLM resolution: ${resolution.reason}`);
                    llmConfig = resolution.llm;
                }

                llmConfig = this.applySubAgentLlmPolicy(llmConfig);

                // Override certain settings for sub-agent behavior
                return {
                    ...loadedConfig,
                    llm: llmConfig,
                    permissions: {
                        ...loadedConfig.permissions,
                        mode: permissionsMode,
                        toolPolicies: mergeToolPolicies(loadedConfig.permissions?.toolPolicies),
                    },
                    ...(inheritedLoggerConfig !== undefined && { logger: inheritedLoggerConfig }),
                };
            }

            this.logger.warn(
                `Agent '${agentId}' not found in registry or bundled paths. Using default config.`
            );
        }

        // Fallback: minimal config inheriting parent's LLM + MCP servers
        const config: AgentConfig = {
            llm: this.applySubAgentLlmPolicy({ ...currentParentLLM }),

            // Default system prompt for sub-agents
            systemPrompt:
                'You are a helpful sub-agent. Complete the task given to you efficiently and concisely.',

            permissions: {
                mode: permissionsMode,
                toolPolicies: mergeToolPolicies(undefined),
            },

            // Inherit MCP servers from parent so subagent has tool access
            mcpServers: parentSettings.mcpServers ? { ...parentSettings.mcpServers } : {},

            ...(inheritedLoggerConfig !== undefined && { logger: inheritedLoggerConfig }),
        };

        return config;
    }

    /**
     * Get information about available agents for tool description.
     * Returns agent metadata from registry, filtered by allowedAgents if configured.
     */
    getAvailableAgents(): AgentRegistryEntry[] {
        let allAgents: Record<string, AgentRegistryEntry>;
        try {
            const registry = getAgentRegistry();
            allAgents = registry.getAvailableAgents();
        } catch (error) {
            this.logger.warn(
                `Failed to load agent registry for spawn_agent description: ${error instanceof Error ? error.message : String(error)}`
            );
            if (this.config.allowedAgents && this.config.allowedAgents.length > 0) {
                return this.config.allowedAgents.map((id) => this.createFallbackRegistryEntry(id));
            }
            return [];
        }

        // If allowedAgents is configured, filter to only those
        if (this.config.allowedAgents && this.config.allowedAgents.length > 0) {
            const result: AgentRegistryEntry[] = [];
            for (const id of this.config.allowedAgents) {
                const agent = allAgents[id];
                result.push(agent ?? this.createFallbackRegistryEntry(id));
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
        this.logger.debug(`Cleaning up AgentSpawnerRuntime for parent '${this.parentId}'`);
        await this.runtime.stopAll({ group: this.parentId });
    }
}

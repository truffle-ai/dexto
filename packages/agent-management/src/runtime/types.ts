/**
 * Agent Runtime Types
 *
 * Type definitions for the general-purpose agent runtime system that manages
 * the lifecycle of multiple agent instances.
 */

import type { DextoAgent, AgentConfig } from '@dexto/core';

/**
 * Configuration for spawning an agent
 */
export interface SpawnConfig {
    /** Base agent config (LLM, system prompt, tools, etc.) */
    agentConfig: AgentConfig;

    /** Whether agent should be destroyed after task completion (default: true) */
    ephemeral?: boolean;

    /** Optional custom agent ID (auto-generated if not provided) */
    agentId?: string;

    /** Optional group identifier for logical grouping (e.g., parent agent ID) */
    group?: string;

    /** Optional metadata for tracking relationships or context */
    metadata?: Record<string, unknown>;

    /**
     * Optional callback invoked after agent is created but before it starts.
     * Use this to configure approval handlers or other pre-start setup.
     */
    onBeforeStart?: (agent: DextoAgent) => void | Promise<void>;
}

/**
 * Status of a managed agent
 */
export type AgentStatus = 'starting' | 'idle' | 'running' | 'stopping' | 'stopped' | 'error';

/**
 * Handle to an agent managed by the runtime
 */
export interface AgentHandle {
    /** Unique identifier for this agent */
    agentId: string;

    /** The DextoAgent instance */
    agent: DextoAgent;

    /** Current status of the agent */
    status: AgentStatus;

    /** Whether this agent should be destroyed after task completion */
    ephemeral: boolean;

    /** When this agent was created */
    createdAt: Date;

    /** Session ID for the agent's conversation */
    sessionId: string;

    /** Optional group identifier (e.g., parent agent ID for sub-agents) */
    group?: string;

    /** Optional metadata */
    metadata?: Record<string, unknown>;

    /** Optional error message if status is 'error' */
    error?: string;
}

/**
 * Result from executing a task on an agent
 */
export interface TaskResult {
    /** Whether the task completed successfully */
    success: boolean;

    /** Final response from the agent */
    response?: string;

    /** Error message if the task failed */
    error?: string;

    /** ID of the agent that executed the task */
    agentId: string;

    /** Token usage for the task */
    tokenUsage?: {
        input: number;
        output: number;
        total: number;
    };
}

/**
 * Configuration for the AgentRuntime
 */
export interface AgentRuntimeConfig {
    /** Maximum total agents managed by this runtime (default: 20) */
    maxAgents?: number;

    /** Default task timeout in milliseconds (default: 300000 = 5 min) */
    defaultTaskTimeout?: number;
}

/**
 * Filter options for listing agents
 */
export interface AgentFilter {
    /** Filter by group */
    group?: string;

    /** Filter by status */
    status?: AgentStatus | AgentStatus[];

    /** Filter by ephemeral flag */
    ephemeral?: boolean;
}

/**
 * Agent Spawner Tool Types
 *
 * Type definitions for tool inputs and outputs.
 */

import type { AgentStatus, AgentHandle, TaskResult } from '@dexto/agent-management';

/**
 * Output from spawn_agent tool
 */
export interface SpawnAgentOutput {
    /** Whether the task completed successfully */
    success: boolean;

    /** Final response from the sub-agent */
    response?: string;

    /** Error message if the task failed */
    error?: string;

    /** ID of the sub-agent (useful for persistent agents) */
    agentId: string;

    /** Summary of the sub-agent's work */
    summary?: string;
}

/**
 * Output from delegate_task tool
 */
export interface DelegateTaskOutput {
    /** Whether the task completed successfully */
    success: boolean;

    /** Response from the sub-agent */
    response?: string;

    /** Error message if the task failed */
    error?: string;

    /** ID of the sub-agent */
    agentId: string;
}

/**
 * Output from get_agent_status tool
 */
export interface GetAgentStatusOutput {
    /** Whether the agent was found */
    found: boolean;

    /** Agent ID */
    agentId: string;

    /** Current status */
    status?: AgentStatus;

    /** Whether the agent is ephemeral */
    ephemeral?: boolean;

    /** When the agent was created */
    createdAt?: string;

    /** Error message if agent not found */
    error?: string;
}

/**
 * Output from list_agents tool
 */
export interface ListAgentsOutput {
    /** List of active sub-agents */
    agents: Array<{
        agentId: string;
        status: AgentStatus;
        ephemeral: boolean;
        createdAt: string;
    }>;

    /** Total count */
    count: number;
}

/**
 * Output from stop_agent tool
 */
export interface StopAgentOutput {
    /** Whether the operation succeeded */
    success: boolean;

    /** Agent ID */
    agentId: string;

    /** Status message */
    message: string;

    /** Error if operation failed */
    error?: string;
}

/**
 * Re-export types from agent-management for convenience
 */
export type { AgentStatus, AgentHandle, TaskResult };

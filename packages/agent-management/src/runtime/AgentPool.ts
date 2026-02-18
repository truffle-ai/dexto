/**
 * AgentPool - Manages a pool of agent instances
 *
 * Tracks active agents, enforces resource limits, and provides
 * lookup and lifecycle management capabilities.
 */

import type { Logger } from '@dexto/core';
import type { AgentHandle, AgentStatus, AgentFilter } from './types.js';
import {
    DEFAULT_MAX_AGENTS,
    DEFAULT_TASK_TIMEOUT,
    type ValidatedAgentRuntimeConfig,
} from './schemas.js';
import { RuntimeError } from './errors.js';

export class AgentPool {
    private agents: Map<string, AgentHandle> = new Map();
    private config: ValidatedAgentRuntimeConfig;
    private logger: Logger;

    constructor(config: Partial<ValidatedAgentRuntimeConfig>, logger: Logger) {
        this.config = {
            maxAgents: config.maxAgents ?? DEFAULT_MAX_AGENTS,
            defaultTaskTimeout: config.defaultTaskTimeout ?? DEFAULT_TASK_TIMEOUT,
        };
        this.logger = logger;
    }

    /**
     * Add an agent handle to the pool
     * @throws RuntimeError if agent with same ID already exists or limit exceeded
     */
    add(handle: AgentHandle): void {
        if (this.agents.has(handle.agentId)) {
            throw RuntimeError.agentAlreadyExists(handle.agentId);
        }

        if (this.agents.size >= this.config.maxAgents) {
            throw RuntimeError.maxAgentsExceeded(this.agents.size, this.config.maxAgents);
        }

        this.agents.set(handle.agentId, handle);
        this.logger.debug(
            `Added agent '${handle.agentId}' to pool${handle.group ? ` (group: ${handle.group})` : ''}`
        );
    }

    /**
     * Remove an agent from the pool
     * @returns The removed handle, or undefined if not found
     */
    remove(agentId: string): AgentHandle | undefined {
        const handle = this.agents.get(agentId);
        if (handle) {
            this.agents.delete(agentId);
            this.logger.debug(`Removed agent '${agentId}' from pool`);
        }
        return handle;
    }

    /**
     * Get an agent handle by ID
     */
    get(agentId: string): AgentHandle | undefined {
        return this.agents.get(agentId);
    }

    /**
     * Check if another agent can be spawned
     */
    canSpawn(): boolean {
        return this.agents.size < this.config.maxAgents;
    }

    /**
     * List agents matching the given filter
     */
    list(filter?: AgentFilter): AgentHandle[] {
        if (!filter) {
            return Array.from(this.agents.values());
        }

        const results: AgentHandle[] = [];
        for (const handle of this.agents.values()) {
            if (this.matchesFilter(handle, filter)) {
                results.push(handle);
            }
        }
        return results;
    }

    /**
     * Get all agents in a specific group
     */
    getByGroup(group: string): AgentHandle[] {
        return this.list({ group });
    }

    /**
     * Get the count of agents in a specific group
     */
    getGroupCount(group: string): number {
        return this.getByGroup(group).length;
    }

    /**
     * Update the status of an agent
     * @throws RuntimeError if agent not found
     */
    updateStatus(agentId: string, status: AgentStatus, error?: string): void {
        const handle = this.agents.get(agentId);
        if (!handle) {
            throw RuntimeError.agentNotFound(agentId);
        }

        const previousStatus = handle.status;
        handle.status = status;
        if (status !== 'error') {
            delete handle.error;
        } else if (error !== undefined) {
            handle.error = error;
        }

        this.logger.debug(
            `Agent '${agentId}' status changed: ${previousStatus} -> ${status}${error ? ` (error: ${error})` : ''}`
        );
    }

    /**
     * Check if an agent exists in the pool
     */
    has(agentId: string): boolean {
        return this.agents.has(agentId);
    }

    /**
     * Get all agent handles in the pool
     */
    getAll(): AgentHandle[] {
        return Array.from(this.agents.values());
    }

    /**
     * Get the total count of agents in the pool
     */
    get size(): number {
        return this.agents.size;
    }

    /**
     * Get the configuration
     */
    getConfig(): ValidatedAgentRuntimeConfig {
        return { ...this.config };
    }

    /**
     * Clear all agents from the pool
     * Note: This does NOT stop the agents - use AgentRuntime.stopAll instead
     */
    clear(): void {
        const count = this.agents.size;
        this.agents.clear();
        if (count > 0) {
            this.logger.debug(`Cleared ${count} agents from pool`);
        }
    }

    /**
     * Check if an agent handle matches a filter
     */
    private matchesFilter(handle: AgentHandle, filter: AgentFilter): boolean {
        // Filter by group
        if (filter.group !== undefined && handle.group !== filter.group) {
            return false;
        }

        // Filter by status
        if (filter.status !== undefined) {
            const statuses = Array.isArray(filter.status) ? filter.status : [filter.status];
            if (!statuses.includes(handle.status)) {
                return false;
            }
        }

        // Filter by ephemeral
        if (filter.ephemeral !== undefined && handle.ephemeral !== filter.ephemeral) {
            return false;
        }

        return true;
    }
}

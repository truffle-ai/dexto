/**
 * Scoped Tool Manager
 *
 * Wraps ToolManager to provide filtered tool access for sub-agents based on task type.
 * This ensures sub-agents only have access to tools appropriate for their task,
 * preventing security issues like recursive spawn_task calls or unauthorized file writes.
 */

import type { ToolManager } from './tool-manager.js';
import type { ToolSet } from './types.js';
import { logger } from '../logger/index.js';

/**
 * Task types supported by sub-agents
 */
export type SubAgentTaskType = 'general-purpose' | 'code-reviewer' | 'test-runner';

/**
 * Tool profiles define which tools are allowed for each task type
 */
export interface ToolProfile {
    allowedTools: string[]; // List of allowed tool names (without prefixes)
    description: string; // Description of what this profile allows
}

/**
 * Scoped Tool Manager that filters tool access based on task type
 */
export class ScopedToolManager {
    private readonly toolManager: ToolManager;
    private readonly taskType: SubAgentTaskType;
    private readonly allowedTools: Set<string>;

    constructor(toolManager: ToolManager, taskType: SubAgentTaskType, profile: ToolProfile) {
        this.toolManager = toolManager;
        this.taskType = taskType;
        this.allowedTools = new Set(profile.allowedTools);

        logger.debug(
            `ScopedToolManager created for task type '${taskType}' with ${profile.allowedTools.length} allowed tools`
        );
    }

    /**
     * Get filtered tools for this scope
     * Only returns tools that are in the allowed list
     */
    async getAllTools(): Promise<ToolSet> {
        const allTools = await this.toolManager.getAllTools();
        const filtered: ToolSet = {};

        for (const [toolName, tool] of Object.entries(allTools)) {
            // Extract the actual tool name without prefix
            const actualName = this.extractToolName(toolName);

            if (this.allowedTools.has(actualName)) {
                filtered[toolName] = tool;
            }
        }

        logger.debug(
            `ScopedToolManager: Filtered ${Object.keys(allTools).length} tools down to ${Object.keys(filtered).length} for task type '${this.taskType}'`
        );

        return filtered;
    }

    /**
     * Check if a tool exists in this scope
     */
    async hasTool(toolName: string): Promise<boolean> {
        const actualName = this.extractToolName(toolName);
        if (!this.allowedTools.has(actualName)) {
            return false;
        }
        return await this.toolManager.hasTool(toolName);
    }

    /**
     * Execute a tool (with scope validation)
     * Throws error if tool is not in allowed list
     */
    async executeTool(
        toolName: string,
        args: Record<string, unknown>,
        sessionId?: string
    ): Promise<unknown> {
        const actualName = this.extractToolName(toolName);

        if (!this.allowedTools.has(actualName)) {
            throw new Error(
                `Tool '${toolName}' is not allowed for task type '${this.taskType}'. ` +
                    `Allowed tools: ${Array.from(this.allowedTools).join(', ')}`
            );
        }

        return await this.toolManager.executeTool(toolName, args, sessionId);
    }

    /**
     * Get tool statistics for this scope
     */
    async getToolStats(): Promise<{ mcp: number; internal: number }> {
        const stats = await this.toolManager.getToolStats();
        // Note: This returns global stats, not scoped stats
        // Could be enhanced to return scoped counts if needed
        return stats;
    }

    /**
     * Extract the actual tool name without prefix
     * e.g., "internal--read_file" -> "read_file"
     *      "mcp--filesystem__read" -> "filesystem__read"
     */
    private extractToolName(toolName: string): string {
        if (toolName.startsWith('internal--')) {
            return toolName.substring('internal--'.length);
        }
        if (toolName.startsWith('mcp--')) {
            return toolName.substring('mcp--'.length);
        }
        return toolName;
    }
}

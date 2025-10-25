/**
 * Tool Profiles for Sub-Agents
 *
 * Defines which tools are available for each sub-agent task type.
 * These profiles enforce the principle of least privilege by only granting
 * tools necessary for the specific task.
 */

import type { ToolProfile, SubAgentTaskType } from './scoped-tool-manager.js';

// Re-export types for convenience
export type { SubAgentTaskType, ToolProfile } from './scoped-tool-manager.js';

/**
 * Tool profiles mapped by task type
 */
export const TOOL_PROFILES: Record<SubAgentTaskType, ToolProfile> = {
    /**
     * General-purpose agent: Analysis, research, comparisons
     * Read-only access to files and documentation
     * NO write, execute, or spawn capabilities
     */
    'general-purpose': {
        allowedTools: [
            // File reading and searching
            'read_file',
            'glob_files',
            'grep_content',

            // History and search
            'search_history',

            // Explicitly BLOCK these tools:
            // - spawn_task (prevents recursion)
            // - bash_exec (prevents code execution)
            // - write_file (read-only mode)
            // - edit_file (read-only mode)
            // - kill_process (no process management)
            // - todo_write (parent manages todos)
            // - ask_user (sub-agents shouldn't prompt user directly)
        ],
        description:
            'Read-only access for analysis and research. Can search files and read content but cannot modify files or execute commands.',
    },

    /**
     * Code reviewer agent: Code analysis and review
     * Similar to general-purpose but optimized for code review tasks
     */
    'code-reviewer': {
        allowedTools: [
            // File reading for code review
            'read_file',
            'glob_files',
            'grep_content',

            // History for context
            'search_history',
        ],
        description:
            'Specialized for code review. Can read and analyze code but cannot execute or modify files.',
    },

    /**
     * Test runner agent: Execute and validate tests
     * Limited bash access for running tests only
     * FUTURE: Could add command validation to only allow test commands
     */
    'test-runner': {
        allowedTools: [
            // File reading
            'read_file',
            'glob_files',

            // Test execution
            'bash_exec', // Allowed for running tests

            // Process management for test processes
            'bash_output',
            'kill_process',
        ],
        description:
            'Can execute commands for running tests. Has access to bash_exec for test execution but should be used carefully.',
    },
};

/**
 * Get tool profile for a task type
 */
export function getToolProfile(taskType: SubAgentTaskType): ToolProfile {
    return TOOL_PROFILES[taskType];
}

/**
 * Validate that a task type is supported
 */
export function isValidTaskType(taskType: string): taskType is SubAgentTaskType {
    return taskType in TOOL_PROFILES;
}

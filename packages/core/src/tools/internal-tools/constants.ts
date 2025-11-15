/**
 * Internal tool constants
 *
 * Separated from registry to avoid circular dependencies and browser bundle pollution
 */

/**
 * Available internal tool names
 * Must be kept in sync with INTERNAL_TOOL_REGISTRY in registry.ts
 */
export const INTERNAL_TOOL_NAMES = [
    'search_history',
    'ask_user',
    'read_file',
    'glob_files',
    'grep_content',
    'write_file',
    'edit_file',
    'bash_exec',
    'bash_output',
    'kill_process',
    'todo_write',
] as const;

export type KnownInternalTool = (typeof INTERNAL_TOOL_NAMES)[number];

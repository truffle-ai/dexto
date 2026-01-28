/**
 * Tool utility functions for CLI
 */

/**
 * Check if a tool is an edit or write file tool.
 * Used for "accept all edits" mode which auto-approves these tools.
 */
export function isEditWriteTool(toolName: string | undefined): boolean {
    return (
        toolName === 'internal--edit_file' ||
        toolName === 'internal--write_file' ||
        toolName === 'custom--write_file' ||
        toolName === 'custom--edit_file' ||
        toolName === 'edit_file' ||
        toolName === 'write_file'
    );
}

/**
 * Check if a tool is a plan update tool.
 * Used for "accept all edits" mode which also auto-approves plan updates
 * (typically marking tasks as complete during implementation).
 */
export function isPlanUpdateTool(toolName: string | undefined): boolean {
    return (
        toolName === 'plan_update' ||
        toolName === 'custom--plan_update' ||
        toolName === 'internal--plan_update'
    );
}

/**
 * Check if a tool should be auto-approved in "accept all edits" mode.
 * Includes file edit/write tools and plan update tools.
 */
export function isAutoApprovableInEditMode(toolName: string | undefined): boolean {
    return isEditWriteTool(toolName) || isPlanUpdateTool(toolName);
}

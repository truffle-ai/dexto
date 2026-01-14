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

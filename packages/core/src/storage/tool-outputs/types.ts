/**
 * Full text of tool results that were too large to keep inline in model history. Hosts scope it
 * to a session; the model reads it back with the core `tool_output_read` tool.
 */
export interface ToolOutputStore {
    save(input: { sessionId: string; toolCallId: string; text: string }): Promise<void>;
    load(input: { sessionId: string; toolCallId: string }): Promise<string | undefined>;
    deleteSession(input: { sessionId: string }): Promise<void>;
}

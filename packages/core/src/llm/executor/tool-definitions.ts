import { jsonSchema, type ToolSet as VercelToolSet } from 'ai';
import type { ToolSet } from '../../tools/types.js';

type ToolInputAvailable = (event: {
    toolName: string;
    toolCallId: string;
    input: unknown;
}) => void | Promise<void>;

const TOOL_OUTPUT_SCHEMA = jsonSchema({
    anyOf: [
        { type: 'string' },
        { type: 'number' },
        { type: 'boolean' },
        { type: 'object', additionalProperties: true },
        { type: 'array' },
        { type: 'null' },
    ],
});

export function createNonExecutableVercelTools(
    tools: ToolSet,
    onInputAvailable?: ToolInputAvailable
): VercelToolSet {
    return Object.fromEntries(
        Object.entries(tools).map(([toolName, tool]) => [
            toolName,
            {
                inputSchema: jsonSchema(tool.parameters),
                outputSchema: TOOL_OUTPUT_SCHEMA,
                ...(tool.description ? { description: tool.description } : {}),
                ...(onInputAvailable
                    ? {
                          onInputAvailable: async (event: {
                              input: unknown;
                              toolCallId: string;
                          }) => {
                              await onInputAvailable({
                                  toolName,
                                  toolCallId: event.toolCallId,
                                  input: event.input,
                              });
                          },
                      }
                    : {}),
            },
        ])
    );
}

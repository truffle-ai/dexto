import { jsonSchema, type ToolSet as VercelToolSet } from 'ai';
import type { ToolSet } from '../../tools/types.js';

const modelToolResultSchema = jsonSchema({});

function createToolDefinitionBase(tool: ToolSet[string]) {
    return {
        inputSchema: jsonSchema(tool.parameters),
        ...(tool.description ? { description: tool.description } : {}),
    };
}

export function createModelToolDefinitions(tools: ToolSet): VercelToolSet {
    const definitions: VercelToolSet = {};
    for (const [toolName, tool] of Object.entries(tools)) {
        definitions[toolName] = {
            ...createToolDefinitionBase(tool),
            outputSchema: modelToolResultSchema,
        };
    }
    return definitions;
}

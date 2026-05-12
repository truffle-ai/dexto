import { jsonSchema, type ToolCallOptions, type ToolSet as VercelToolSet } from 'ai';
import type { LanguageModelV2ToolResultOutput } from '@ai-sdk/provider';
import type { ToolSet } from '../../tools/types.js';

type ExecutableToolDefinitionsOptions = {
    execute: (input: {
        toolName: string;
        args: unknown;
        options: ToolCallOptions;
    }) => Promise<unknown>;
    toModelOutput: (input: {
        toolName: string;
        result: unknown;
    }) => LanguageModelV2ToolResultOutput;
};

const modelToolResultSchema = jsonSchema({});

function createToolDefinitionBase(tool: ToolSet[string]) {
    return {
        inputSchema: jsonSchema(tool.parameters),
        ...(tool.description ? { description: tool.description } : {}),
    };
}

export function createExecutableToolDefinitions(
    tools: ToolSet,
    options: ExecutableToolDefinitionsOptions
): VercelToolSet {
    const definitions: VercelToolSet = {};
    for (const [toolName, tool] of Object.entries(tools)) {
        definitions[toolName] = {
            ...createToolDefinitionBase(tool),
            execute: (args: unknown, toolOptions: ToolCallOptions) =>
                options.execute({
                    toolName,
                    args,
                    options: toolOptions,
                }),
            toModelOutput: (result: unknown) =>
                options.toModelOutput({
                    toolName,
                    result,
                }),
        };
    }
    return definitions;
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

import { jsonSchema, type ToolCallOptions, type ToolSet as VercelToolSet } from 'ai';
import type { LanguageModelV2ToolResultOutput } from '@ai-sdk/provider';
import type { ToolSet } from '../../tools/types.js';

type ToolDefinitionsOptions = {
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

export function createVercelToolDefinitions(
    tools: ToolSet,
    options: ToolDefinitionsOptions
): VercelToolSet {
    const definitions: VercelToolSet = {};
    for (const [toolName, tool] of Object.entries(tools)) {
        const base = {
            inputSchema: jsonSchema(tool.parameters),
            ...(tool.description ? { description: tool.description } : {}),
        };

        definitions[toolName] = {
            ...base,
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

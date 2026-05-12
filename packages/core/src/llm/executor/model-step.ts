import {
    streamText,
    stepCountIs,
    type FinishReason,
    type LanguageModel,
    type ModelMessage,
} from 'ai';
import type { ToolSet } from '../../tools/types.js';
import { createModelToolDefinitions } from './tool-definitions.js';

export type ModelToolCall = {
    toolCallId: string;
    toolName: string;
    input: unknown;
};

export type ModelStepResult = {
    finishReason: FinishReason;
    toolCalls: ModelToolCall[];
};

export async function runModelStep(input: {
    model: LanguageModel;
    messages: ModelMessage[];
    tools: ToolSet;
    abortSignal?: AbortSignal;
}): Promise<ModelStepResult> {
    const result = streamText({
        model: input.model,
        messages: input.messages,
        tools: createModelToolDefinitions(input.tools),
        stopWhen: stepCountIs(1),
        ...(input.abortSignal !== undefined && { abortSignal: input.abortSignal }),
    });

    await result.consumeStream();
    const toolCalls = await result.toolCalls;

    return {
        finishReason: await result.finishReason,
        toolCalls: toolCalls.map((toolCall) => ({
            toolCallId: toolCall.toolCallId,
            toolName: toolCall.toolName,
            input: toolCall.input,
        })),
    };
}

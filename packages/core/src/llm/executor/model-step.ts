import {
    streamText,
    stepCountIs,
    type FinishReason,
    type LanguageModel,
    type ModelMessage,
} from 'ai';
import type { ToolSet } from '../../tools/types.js';
import { createIntentVercelToolDefinitions } from './tool-definitions.js';

export type ModelToolIntent = {
    toolCallId: string;
    toolName: string;
    input: unknown;
};

export type ModelIntentStepResult = {
    finishReason: FinishReason;
    toolCalls: ModelToolIntent[];
};

export async function runModelIntentStep(input: {
    model: LanguageModel;
    messages: ModelMessage[];
    tools: ToolSet;
    abortSignal?: AbortSignal;
}): Promise<ModelIntentStepResult> {
    const result = streamText({
        model: input.model,
        messages: input.messages,
        tools: createIntentVercelToolDefinitions(input.tools, {
            onInputAvailable: () => undefined,
        }),
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

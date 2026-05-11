/* global ReadableStream */
import { describe, expect, it, vi } from 'vitest';
import type { LanguageModel, ModelMessage } from 'ai';
import type { LanguageModelV2CallOptions, LanguageModelV2StreamPart } from '@ai-sdk/provider';
import { runModelIntentStep } from './model-step.js';
import type { ToolSet } from '../../tools/types.js';

const messages: ModelMessage[] = [{ role: 'user', content: 'read package json' }];

const tools: ToolSet = {
    read_file: {
        name: 'read_file',
        description: 'Read a file',
        parameters: {
            type: 'object',
            properties: {
                path: { type: 'string' },
            },
            required: ['path'],
        },
    },
};

function streamFrom(parts: LanguageModelV2StreamPart[]): ReadableStream<LanguageModelV2StreamPart> {
    return new ReadableStream({
        start(controller) {
            for (const part of parts) {
                controller.enqueue(part);
            }
            controller.close();
        },
    });
}

describe('runModelIntentStep', () => {
    it('collects tool-call intent without providing executable tool callbacks', async () => {
        const doStream = vi.fn((options: LanguageModelV2CallOptions) => {
            return Promise.resolve({
                stream: streamFrom([
                    { type: 'stream-start', warnings: [] },
                    {
                        type: 'tool-call',
                        toolCallId: 'call-1',
                        toolName: 'read_file',
                        input: JSON.stringify({ path: 'package.json' }),
                    },
                    {
                        type: 'finish',
                        finishReason: 'tool-calls',
                        usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
                    },
                ]),
                request: { body: options },
            });
        });
        const model = {
            specificationVersion: 'v2',
            provider: 'test-provider',
            modelId: 'test-model',
            supportedUrls: {},
            doGenerate: () => {
                throw new Error('doGenerate should not run');
            },
            doStream,
        } satisfies LanguageModel;

        const result = await runModelIntentStep({
            model,
            messages,
            tools,
        });

        expect(result).toEqual({
            finishReason: 'tool-calls',
            toolCalls: [
                {
                    toolCallId: 'call-1',
                    toolName: 'read_file',
                    input: { path: 'package.json' },
                },
            ],
        });

        const modelCall = doStream.mock.calls[0]?.[0];
        if (modelCall === undefined) {
            throw new Error('model was not called');
        }
        expect(modelCall.tools).toEqual([
            {
                type: 'function',
                name: 'read_file',
                description: 'Read a file',
                inputSchema: tools.read_file?.parameters,
            },
        ]);
    });
});

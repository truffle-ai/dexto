import { describe, expect, it, vi } from 'vitest';
import { createNonExecutableVercelTools } from './tool-definitions.js';
import type { ToolSet } from '../../tools/types.js';

describe('createNonExecutableVercelTools', () => {
    it('creates AI SDK tool definitions without execute callbacks', () => {
        const tools: ToolSet = {
            write_file: {
                name: 'write_file',
                description: 'Write a file',
                parameters: {
                    type: 'object',
                    properties: {
                        path: { type: 'string' },
                    },
                    required: ['path'],
                    additionalProperties: false,
                },
            },
        };

        const converted = createNonExecutableVercelTools(tools);

        expect(converted.write_file).toEqual(
            expect.objectContaining({
                description: 'Write a file',
                inputSchema: expect.objectContaining({
                    jsonSchema: expect.objectContaining({
                        type: 'object',
                        required: ['path'],
                        additionalProperties: false,
                    }),
                }),
                outputSchema: expect.any(Object),
            })
        );
        expect(converted.write_file).not.toHaveProperty('execute');
    });

    it('keeps model input callbacks available for pending tool call capture', async () => {
        const onInputAvailable = vi.fn();
        const converted = createNonExecutableVercelTools(
            {
                inspect: {
                    name: 'inspect',
                    parameters: {
                        type: 'object',
                        properties: {},
                        additionalProperties: false,
                    },
                },
            },
            onInputAvailable
        );

        await converted.inspect?.onInputAvailable?.({
            input: { value: true },
            toolCallId: 'call-1',
            messages: [],
            abortSignal: new AbortController().signal,
        });

        expect(onInputAvailable).toHaveBeenCalledWith({
            toolName: 'inspect',
            toolCallId: 'call-1',
            input: { value: true },
        });
    });
});

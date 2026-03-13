import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
    JSONSchema7,
    LanguageModelV2CallOptions,
    LanguageModelV2StreamPart,
} from '@ai-sdk/provider';
import { CodexAppServerClient, createCodexLanguageModel } from './codex-app-server.js';

type TestNotification = {
    method: string;
    params?: unknown;
};

type TestServerRequest = {
    id: number | string;
    method: string;
    params?: unknown;
};

const TOOL_SCHEMA: JSONSchema7 = {
    type: 'object',
    properties: {
        query: { type: 'string' },
    },
    required: ['query'],
    additionalProperties: false,
};

function createCallOptions(
    overrides: Partial<LanguageModelV2CallOptions> = {}
): LanguageModelV2CallOptions {
    return {
        prompt: [
            {
                role: 'user',
                content: [{ type: 'text', text: 'Search the repo for Codex integration details.' }],
            },
        ],
        tools: [
            {
                type: 'function',
                name: 'lookup_repo',
                description: 'Search the repository for matching files.',
                inputSchema: TOOL_SCHEMA,
            },
        ],
        ...overrides,
    };
}

function createMockClient() {
    const notifications = new Set<(message: TestNotification) => void>();
    const requests = new Set<(message: TestServerRequest) => void>();
    let resolveRequestReady: (() => void) | null = null;
    const requestReady = new Promise<void>((resolve) => {
        resolveRequestReady = resolve;
    });

    const client = {
        readAccount: vi.fn().mockResolvedValue({
            account: {
                type: 'chatgpt',
                email: 'user@example.com',
                planType: 'plus',
            },
            requiresOpenaiAuth: false,
        }),
        startEphemeralThread: vi.fn().mockResolvedValue({
            thread: {
                id: 'thread-1',
            },
        }),
        startTurn: vi.fn().mockResolvedValue({
            turn: {
                id: 'turn-1',
            },
        }),
        onNotification: vi.fn((listener: (message: TestNotification) => void) => {
            notifications.add(listener);
            return () => {
                notifications.delete(listener);
            };
        }),
        onServerRequest: vi.fn((listener: (message: TestServerRequest) => void) => {
            requests.add(listener);
            resolveRequestReady?.();
            resolveRequestReady = null;
            return () => {
                requests.delete(listener);
            };
        }),
        rejectServerRequest: vi.fn(),
        close: vi.fn().mockResolvedValue(undefined),
    };

    return {
        client,
        requestReady,
        emitNotification(message: TestNotification) {
            for (const listener of notifications) {
                listener(message);
            }
        },
        emitServerRequest(message: TestServerRequest) {
            for (const listener of requests) {
                listener(message);
            }
        },
    };
}

async function readAllParts(
    stream: ReadableStream<LanguageModelV2StreamPart>
): Promise<LanguageModelV2StreamPart[]> {
    const reader = stream.getReader();
    const parts: LanguageModelV2StreamPart[] = [];

    while (true) {
        const { done, value } = await reader.read();
        if (done) {
            return parts;
        }

        parts.push(value);
    }
}

describe('createCodexLanguageModel', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('bridges Codex dynamic tool requests into AI SDK tool-call stream parts', async () => {
        const mock = createMockClient();
        vi.spyOn(CodexAppServerClient, 'create').mockResolvedValue(
            mock.client as unknown as CodexAppServerClient
        );

        const model = createCodexLanguageModel({
            modelId: 'gpt-5.4',
            baseURL: 'codex://chatgpt',
        });

        const execution = await model.doStream(createCallOptions({ toolChoice: { type: 'auto' } }));
        await mock.requestReady;

        mock.emitServerRequest({
            id: 1,
            method: 'item/tool/call',
            params: {
                threadId: 'thread-1',
                turnId: 'turn-1',
                callId: 'call-1',
                tool: 'lookup_repo',
                arguments: {
                    query: 'codex app server',
                },
            },
        });

        const parts = await readAllParts(execution.stream);

        expect(mock.client.startEphemeralThread).toHaveBeenCalledWith(
            expect.objectContaining({
                dynamicTools: [
                    {
                        name: 'lookup_repo',
                        description: 'Search the repository for matching files.',
                        inputSchema: TOOL_SCHEMA,
                    },
                ],
                developerInstructions: expect.stringContaining(
                    'Host-provided dynamic tools are available'
                ),
            })
        );
        expect(parts.map((part) => part.type)).toEqual([
            'stream-start',
            'tool-input-start',
            'tool-input-delta',
            'tool-input-end',
            'tool-call',
            'finish',
        ]);
        expect(parts[1]).toEqual({
            type: 'tool-input-start',
            id: 'call-1',
            toolName: 'lookup_repo',
        });
        expect(parts[2]).toEqual({
            type: 'tool-input-delta',
            id: 'call-1',
            delta: '{"query":"codex app server"}',
        });
        expect(parts[4]).toEqual({
            type: 'tool-call',
            toolCallId: 'call-1',
            toolName: 'lookup_repo',
            input: '{"query":"codex app server"}',
        });
        expect(parts[5]).toEqual({
            type: 'finish',
            finishReason: 'tool-calls',
            usage: {
                inputTokens: undefined,
                outputTokens: undefined,
                totalTokens: undefined,
            },
        });
        expect(mock.client.rejectServerRequest).not.toHaveBeenCalled();
        expect(mock.client.close).toHaveBeenCalledTimes(1);
    });

    it('returns tool-call content from doGenerate so AI SDK loops can execute tools', async () => {
        const mock = createMockClient();
        vi.spyOn(CodexAppServerClient, 'create').mockResolvedValue(
            mock.client as unknown as CodexAppServerClient
        );

        const model = createCodexLanguageModel({
            modelId: 'gpt-5.4',
            baseURL: 'codex://chatgpt',
        });

        const resultPromise = model.doGenerate(
            createCallOptions({ toolChoice: { type: 'tool', toolName: 'lookup_repo' } })
        );
        await mock.requestReady;

        mock.emitServerRequest({
            id: 7,
            method: 'item/tool/call',
            params: {
                threadId: 'thread-1',
                turnId: 'turn-1',
                callId: 'call-7',
                tool: 'lookup_repo',
                arguments: {
                    query: 'where is the codex provider',
                },
            },
        });

        const result = await resultPromise;

        expect(result.finishReason).toBe('tool-calls');
        expect(result.content).toEqual([
            {
                type: 'tool-call',
                toolCallId: 'call-7',
                toolName: 'lookup_repo',
                input: {
                    query: 'where is the codex provider',
                },
            },
        ]);
        expect(result.warnings).toEqual([]);
        expect(mock.client.startEphemeralThread).toHaveBeenCalledWith(
            expect.objectContaining({
                dynamicTools: [
                    {
                        name: 'lookup_repo',
                        description: 'Search the repository for matching files.',
                        inputSchema: TOOL_SCHEMA,
                    },
                ],
                developerInstructions: expect.stringContaining(
                    'use only the host tool named "lookup_repo"'
                ),
            })
        );
    });

    it('removes the abort listener after the stream finishes', async () => {
        const mock = createMockClient();
        vi.spyOn(CodexAppServerClient, 'create').mockResolvedValue(
            mock.client as unknown as CodexAppServerClient
        );

        const model = createCodexLanguageModel({
            modelId: 'gpt-5.4',
            baseURL: 'codex://chatgpt',
        });
        const abortController = new AbortController();

        const execution = await model.doStream(
            createCallOptions({ abortSignal: abortController.signal })
        );
        await mock.requestReady;

        mock.emitServerRequest({
            id: 9,
            method: 'item/tool/call',
            params: {
                threadId: 'thread-1',
                turnId: 'turn-1',
                callId: 'call-9',
                tool: 'lookup_repo',
                arguments: {
                    query: 'cleanup',
                },
            },
        });

        const parts = await readAllParts(execution.stream);
        abortController.abort(new Error('late abort'));
        await new Promise((resolve) => setTimeout(resolve, 0));

        expect(parts.at(-1)).toEqual({
            type: 'finish',
            finishReason: 'tool-calls',
            usage: {
                inputTokens: undefined,
                outputTokens: undefined,
                totalTokens: undefined,
            },
        });
    });
});

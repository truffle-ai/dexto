import { context, trace } from '@opentelemetry/api';
import { AsyncHooksContextManager } from '@opentelemetry/context-async-hooks';
import {
    BasicTracerProvider,
    InMemorySpanExporter,
    SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-base';
import { describe, expect, it, vi } from 'vitest';
import { createMockLogger } from '../logger/v2/test-utils.js';
import { ApprovalStatus } from '../approval/types.js';
import { DextoMcpClient } from './mcp-client.js';

describe('DextoMcpClient', () => {
    it('keeps tool payloads and failures out of logs and telemetry', async () => {
        const contextManager = new AsyncHooksContextManager().enable();
        const exporter = new InMemorySpanExporter();
        const provider = new BasicTracerProvider();
        provider.addSpanProcessor(new SimpleSpanProcessor(exporter));
        provider.register({ contextManager });
        Reflect.set(globalThis, '__TELEMETRY__', { isInitialized: () => true });
        const logger = createMockLogger();
        const privateArgument = 'provider-private-argument';
        const privateResult = 'provider-private-result';
        const privateError = new Error('provider-private-error');
        const sdkClient = {
            callTool: vi
                .fn()
                .mockResolvedValueOnce({ value: privateResult })
                .mockRejectedValueOnce(privateError),
        };
        const client = new DextoMcpClient(logger);
        Reflect.set(client, 'client', sdkClient);
        Reflect.set(client, 'isConnected', true);
        Reflect.set(client, 'serverAlias', 'private-provider');

        try {
            await expect(client.callTool('lookup', { value: privateArgument })).resolves.toEqual({
                value: privateResult,
            });
            await expect(client.callTool('lookup', {})).rejects.toBe(privateError);

            const exposedObservability = JSON.stringify({
                logs: [
                    ...vi.mocked(logger.debug).mock.calls,
                    ...vi.mocked(logger.error).mock.calls,
                ],
                spans: exporter.getFinishedSpans().map((span) => ({
                    attributes: span.attributes,
                    events: span.events,
                    status: span.status,
                })),
            });
            expect(exposedObservability).not.toContain(privateArgument);
            expect(exposedObservability).not.toContain(privateResult);
            expect(exposedObservability).not.toContain(privateError.message);
        } finally {
            await provider.shutdown();
            contextManager.disable();
            Reflect.deleteProperty(globalThis, '__TELEMETRY__');
            trace.disable();
        }
    });

    it('rejects MCP error results with their canonical text', async () => {
        const sdkClient = {
            callTool: vi.fn().mockResolvedValue({
                content: [{ text: 'provider rejected the operation', type: 'text' }],
                isError: true,
            }),
        };
        const client = new DextoMcpClient(createMockLogger());
        Reflect.set(client, 'client', sdkClient);
        Reflect.set(client, 'isConnected', true);

        await expect(client.callTool('lookup', {})).rejects.toThrow(
            'provider rejected the operation'
        );
    });

    it('should pass active tool invocation context to elicitation approvals', async () => {
        let elicitationHandler:
            | ((request: {
                  method: 'elicitation/create';
                  params: {
                      message: string;
                      requestedSchema: Record<string, unknown>;
                  };
              }) => Promise<unknown>)
            | undefined;
        const sdkClient = {
            setRequestHandler: vi.fn((_schema, handler) => {
                elicitationHandler = handler;
            }),
            callTool: vi.fn(async () => {
                if (!elicitationHandler) {
                    throw new Error('Expected elicitation handler to be registered');
                }

                await elicitationHandler({
                    method: 'elicitation/create',
                    params: {
                        message: 'Need input',
                        requestedSchema: {
                            type: 'object',
                            properties: {
                                token: { type: 'string' },
                            },
                        },
                    },
                });

                return { content: [] };
            }),
        };
        const requestElicitation = vi.fn().mockResolvedValue({
            approvalId: 'approval-1',
            status: ApprovalStatus.APPROVED,
            data: {
                formData: {
                    token: 'secret',
                },
            },
        });
        const client = new DextoMcpClient(createMockLogger());
        const runContext = {
            sessionId: 'session-1',
            hostRuntime: {
                ids: {
                    runId: 'run-1',
                    attemptId: 'attempt-1',
                },
            },
            telemetryContext: context.active(),
        };

        Reflect.set(client, 'client', sdkClient);
        Reflect.set(client, 'isConnected', true);
        Reflect.set(client, 'serverAlias', 'filesystem');
        client.setApprovalManager({
            requestElicitation,
        } as any);

        await client.callTool(
            'prompt_user',
            {},
            {
                sessionId: 'session-1',
                runContext,
            }
        );

        expect(requestElicitation).toHaveBeenCalledWith(
            expect.objectContaining({
                prompt: 'Need input',
                serverName: 'filesystem',
                sessionId: 'session-1',
                hostRuntime: runContext.hostRuntime,
            })
        );
    });
});

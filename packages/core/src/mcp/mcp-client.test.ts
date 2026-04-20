import { context } from '@opentelemetry/api';
import { describe, expect, it, vi } from 'vitest';
import { createMockLogger } from '../logger/v2/test-utils.js';
import { ApprovalStatus } from '../approval/types.js';
import { DextoMcpClient } from './mcp-client.js';

describe('DextoMcpClient', () => {
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

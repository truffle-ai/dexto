import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { handleHeadlessApproval } from './headless-approval-handler.js';
import {
    DextoAgent,
    AgentEventBus,
    InMemoryDextoStores,
    createLogger,
    ApprovalType,
    ApprovalStatus,
    DenialReason,
    type Tool,
} from '@dexto/core';

describe('headless approval handling', () => {
    it('preserves the request correlation envelope without remembering a grant', async () => {
        const hostRuntime = { ids: { runId: 'run-1' } };
        const eventBus = new AgentEventBus();
        const events: string[] = [];
        eventBus.on('approval:request', () => events.push('request'));
        eventBus.on('approval:response', () => events.push('response'));
        const response = await handleHeadlessApproval(
            {
                type: ApprovalType.TOOL_APPROVAL,
                approvalId: 'a77f04bd-d7e9-4c51-9b6b-49adcdde02a9',
                sessionId: 'session-1',
                hostRuntime,
                timestamp: new Date(),
                autoApproval: 'disallowed',
                metadata: { toolName: 'protected_operation', toolCallId: 'call-1', args: {} },
            },
            eventBus,
            undefined
        );
        expect(events).toEqual(['request', 'response']);
        expect(response).toMatchObject({
            approvalId: 'a77f04bd-d7e9-4c51-9b6b-49adcdde02a9',
            sessionId: 'session-1',
            hostRuntime,
            status: ApprovalStatus.DENIED,
            reason: DenialReason.SYSTEM_DENIED,
        });
        expect(response).not.toHaveProperty('data');
        expect(response.message).toContain('Dexto TUI');
    });
    it('attributes unscoped events to the run while preserving the original denial envelope', async () => {
        const eventBus = new AgentEventBus();
        const requestEvent = vi.fn();
        const responseEvent = vi.fn();
        eventBus.on('approval:request', requestEvent);
        eventBus.on('approval:response', responseEvent);
        const request = {
            type: ApprovalType.TOOL_APPROVAL,
            approvalId: 'a77f04bd-d7e9-4c51-9b6b-49adcdde02a9',
            timestamp: new Date(),
            metadata: { toolName: 'protected_operation', toolCallId: 'call-1', args: {} },
        } as const;
        const response = await handleHeadlessApproval(request, eventBus, 'active-run-session');
        expect(requestEvent).toHaveBeenCalledWith({ ...request, sessionId: 'active-run-session' });
        expect(responseEvent).toHaveBeenCalledWith({
            ...response,
            sessionId: 'active-run-session',
        });
        expect(response).not.toHaveProperty('sessionId');
        expect(request).not.toHaveProperty('sessionId');
        expect(response.status).toBe(ApprovalStatus.DENIED);
    });

    it('prevents a mandatory side effect with an actionable denial and allows recovery', async () => {
        let protectedEffects = 0;
        let ordinaryEffects = 0;
        const tools: Tool[] = [
            {
                id: 'protected_operation',
                description: 'Requires interactive approval',
                inputSchema: z.object({}).strict(),
                execute: async (_input, context) => {
                    if (!context.services || !context.toolCallId)
                        throw new Error('Expected injected services and call ID');
                    await context.services.approval.checkToolApproval({
                        toolName: 'protected_operation',
                        toolCallId: context.toolCallId,
                        args: {},
                        autoApproval: 'disallowed',
                    });
                    protectedEffects++;
                    return 'protected';
                },
            },
            {
                id: 'ordinary_operation',
                description: 'Normal automatic operation',
                inputSchema: z.object({}).strict(),
                needsApproval: () => true,
                execute: () => {
                    ordinaryEffects++;
                    return 'ordinary';
                },
            },
        ];
        const agent = new DextoAgent({
            agentId: 'headless-approval-test',
            systemPrompt: 'Test agent',
            llm: { provider: 'openai', model: 'gpt-5', apiKey: 'unused-test-key' },
            permissions: { mode: 'auto-approve' },
            elicitation: { enabled: false },
            stores: new InMemoryDextoStores(),
            logger: createLogger({
                agentId: 'headless-approval-test',
                config: { level: 'error', transports: [{ type: 'silent' }] },
            }),
            tools,
        });
        const handler = vi.fn((request) => handleHeadlessApproval(request, agent, undefined));
        agent.setApprovalHandler(handler);
        await agent.start();
        try {
            await expect(agent.executeTool('protected_operation', {})).rejects.toThrow(
                'requires interactive approval'
            );
            expect(protectedEffects).toBe(0);
            await agent.executeTool('ordinary_operation', {});
            expect(ordinaryEffects).toBe(1);
            expect(handler).toHaveBeenCalledTimes(1);
        } finally {
            await agent.stop();
        }
    });
});

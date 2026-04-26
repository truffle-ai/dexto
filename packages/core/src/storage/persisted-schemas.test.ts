import { describe, expect, it } from 'vitest';
import { ApprovalType } from '../approval/index.js';
import { InternalMessageSchema } from '../context/index.js';
import { QueuedMessagesSchema, SessionDataSchema, parseSessionData } from '../session/index.js';
import { SessionToolPreferencesSchema } from '../tools/index.js';
import { SessionApprovalStateSchema } from './index.js';

describe('persisted storage schemas', () => {
    it('parses core session state shapes used by host stores', () => {
        expect(
            SessionDataSchema.parse({
                createdAt: 1,
                id: 'session-1',
                lastActivity: 2,
                messageCount: 3,
                metadata: { title: 'Hello' },
            })
        ).toMatchObject({
            id: 'session-1',
            metadata: { title: 'Hello' },
        });
        expect(SessionApprovalStateSchema.parse({})).toEqual({
            approvedDirectories: [],
            toolPatterns: {},
        });
        expect(SessionToolPreferencesSchema.parse({})).toEqual({
            disabledTools: [],
            userAutoApproveTools: [],
        });
    });

    it('normalizes optional session fields for exact optional property consumers', () => {
        expect(
            parseSessionData({
                createdAt: 1,
                id: 'session-1',
                lastActivity: 2,
                messageCount: 3,
                usageTracking: {},
            })
        ).toEqual({
            createdAt: 1,
            id: 'session-1',
            lastActivity: 2,
            messageCount: 3,
            usageTracking: {},
        });
    });

    it('parses queued message and internal message payloads', () => {
        const queue = QueuedMessagesSchema.parse([
            {
                id: 'queued-1',
                content: [{ type: 'text', text: 'hello' }],
                queuedAt: 1,
                kind: 'background',
                metadata: { reason: 'retry' },
            },
        ]);
        const assistantMessage = InternalMessageSchema.parse({
            role: 'assistant',
            id: 'message-1',
            timestamp: 1,
            content: null,
            toolCalls: [
                {
                    id: 'tool-call-1',
                    type: 'function',
                    function: {
                        name: 'todo_write',
                        arguments: '{}',
                    },
                },
            ],
        });

        expect(queue[0]?.content).toEqual([{ type: 'text', text: 'hello' }]);
        expect(assistantMessage).toMatchObject({
            role: 'assistant',
            toolCalls: [{ function: { name: 'todo_write' } }],
        });
    });

    it('keeps existing approval request schemas available for store adapters', () => {
        expect(ApprovalType.TOOL_APPROVAL).toBe('tool_confirmation');
    });
});

/**
 * Activity Middleware Tests
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { activityMiddleware } from './activity.js';
import { useEventLogStore } from '../../stores/eventLogStore.js';
import type { ClientEvent } from '../types.js';
import { ApprovalType, ApprovalStatus } from '@dexto/core';

describe('activityMiddleware', () => {
    beforeEach(() => {
        // Reset event log store
        useEventLogStore.setState({ events: [], maxEvents: 1000 });
    });

    describe('middleware execution', () => {
        it('should call next() to propagate event', () => {
            const next = vi.fn();
            const event: ClientEvent = {
                name: 'llm:thinking',
                sessionId: 'session-1',
            };

            activityMiddleware(event, next);

            expect(next).toHaveBeenCalledWith(event);
        });

        it('should call next before logging', () => {
            const callOrder: string[] = [];
            const next = vi.fn(() => {
                callOrder.push('next');
            });

            const originalAddEvent = useEventLogStore.getState().addEvent;
            useEventLogStore.setState({
                addEvent: (event) => {
                    callOrder.push('addEvent');
                    originalAddEvent(event);
                },
            });

            const event: ClientEvent = {
                name: 'llm:thinking',
                sessionId: 'session-1',
            };

            activityMiddleware(event, next);

            expect(callOrder).toEqual(['next', 'addEvent']);
        });
    });

    describe('event logging', () => {
        it('should log llm:thinking event', () => {
            const next = vi.fn();
            const event: ClientEvent = {
                name: 'llm:thinking',
                sessionId: 'session-1',
            };

            activityMiddleware(event, next);

            const { events } = useEventLogStore.getState();
            expect(events).toHaveLength(1);
            expect(events[0].name).toBe('llm:thinking');
            expect(events[0].category).toBe('agent');
            expect(events[0].description).toBe('Agent started processing');
            expect(events[0].sessionId).toBe('session-1');
        });

        it('should log llm:chunk with content preview', () => {
            const next = vi.fn();
            const event: ClientEvent = {
                name: 'llm:chunk',
                chunkType: 'text',
                content: 'This is a long piece of content that should be truncated in the preview',
                sessionId: 'session-1',
            };

            activityMiddleware(event, next);

            const { events } = useEventLogStore.getState();
            expect(events).toHaveLength(1);
            expect(events[0].category).toBe('agent');
            expect(events[0].description).toContain('Streaming text:');
            expect(events[0].description).toContain(
                'This is a long piece of content that should be tru...'
            );
        });

        it('should log llm:response with token count', () => {
            const next = vi.fn();
            const event: ClientEvent = {
                name: 'llm:response',
                content: 'Response content',
                sessionId: 'session-1',
                tokenUsage: {
                    inputTokens: 100,
                    outputTokens: 50,
                    totalTokens: 150,
                },
            };

            activityMiddleware(event, next);

            const { events } = useEventLogStore.getState();
            expect(events).toHaveLength(1);
            expect(events[0].category).toBe('agent');
            expect(events[0].description).toBe('Response complete (150 tokens)');
        });

        it('should log llm:response without token count', () => {
            const next = vi.fn();
            const event: ClientEvent = {
                name: 'llm:response',
                content: 'Response content',
                sessionId: 'session-1',
            };

            activityMiddleware(event, next);

            const { events } = useEventLogStore.getState();
            expect(events[0].description).toBe('Response complete');
        });

        it('should log llm:tool-call with tool name', () => {
            const next = vi.fn();
            const event: ClientEvent = {
                name: 'llm:tool-call',
                toolName: 'read_file',
                args: { path: '/test.txt' },
                callId: 'call-123',
                sessionId: 'session-1',
            };

            activityMiddleware(event, next);

            const { events } = useEventLogStore.getState();
            expect(events).toHaveLength(1);
            expect(events[0].category).toBe('tool');
            expect(events[0].description).toBe('Calling tool: read_file');
        });

        it('should log llm:tool-result with success status', () => {
            const next = vi.fn();
            const event: ClientEvent = {
                name: 'llm:tool-result',
                toolName: 'read_file',
                callId: 'call-123',
                success: true,
                sessionId: 'session-1',
            };

            activityMiddleware(event, next);

            const { events } = useEventLogStore.getState();
            expect(events).toHaveLength(1);
            expect(events[0].category).toBe('tool');
            expect(events[0].description).toBe('Tool read_file succeeded');
        });

        it('should log llm:tool-result with failure status', () => {
            const next = vi.fn();
            const event: ClientEvent = {
                name: 'llm:tool-result',
                toolName: 'write_file',
                callId: 'call-456',
                success: false,
                error: 'Permission denied',
                sessionId: 'session-1',
            };

            activityMiddleware(event, next);

            const { events } = useEventLogStore.getState();
            expect(events[0].description).toBe('Tool write_file failed');
        });

        it('should log llm:error with error message', () => {
            const next = vi.fn();
            const error = new Error('API rate limit exceeded');
            const event: ClientEvent = {
                name: 'llm:error',
                error,
                context: 'chat completion',
                sessionId: 'session-1',
            };

            activityMiddleware(event, next);

            const { events } = useEventLogStore.getState();
            expect(events).toHaveLength(1);
            expect(events[0].category).toBe('system');
            expect(events[0].description).toBe('Error: API rate limit exceeded');
        });

        it('should log approval:request with tool name', () => {
            const next = vi.fn();
            const event: ClientEvent = {
                name: 'approval:request',
                type: ApprovalType.TOOL_CONFIRMATION,
                approvalId: '123',
                timeout: 30000,
                timestamp: new Date(),
                metadata: {
                    toolName: 'execute_command',
                    toolCallId: 'call-exec-123',
                    args: { command: 'rm -rf /' },
                },
                sessionId: 'session-1',
            };

            activityMiddleware(event, next);

            const { events } = useEventLogStore.getState();
            expect(events).toHaveLength(1);
            expect(events[0].category).toBe('approval');
            expect(events[0].description).toBe('Approval requested for execute_command');
        });

        it('should log approval:response with granted status', () => {
            const next = vi.fn();
            const event: ClientEvent = {
                name: 'approval:response',
                status: ApprovalStatus.APPROVED,
                approvalId: '123',
                sessionId: 'session-1',
            };

            activityMiddleware(event, next);

            const { events } = useEventLogStore.getState();
            expect(events[0].description).toBe('Approval granted');
        });

        it('should log approval:response with denied status', () => {
            const next = vi.fn();
            const event: ClientEvent = {
                name: 'approval:response',
                status: ApprovalStatus.DENIED,
                approvalId: '123',
                sessionId: 'session-1',
            };

            activityMiddleware(event, next);

            const { events } = useEventLogStore.getState();
            expect(events[0].description).toBe('Approval denied');
        });

        it('should log run:complete with finish reason', () => {
            const next = vi.fn();
            const event: ClientEvent = {
                name: 'run:complete',
                finishReason: 'stop',
                stepCount: 5,
                durationMs: 2000,
                sessionId: 'session-1',
            };

            activityMiddleware(event, next);

            const { events } = useEventLogStore.getState();
            expect(events[0].category).toBe('agent');
            expect(events[0].description).toBe('Run complete (stop)');
        });

        it('should log session:title-updated with title', () => {
            const next = vi.fn();
            const event: ClientEvent = {
                name: 'session:title-updated',
                sessionId: 'session-1',
                title: 'My Conversation',
            };

            activityMiddleware(event, next);

            const { events } = useEventLogStore.getState();
            expect(events[0].category).toBe('system');
            expect(events[0].description).toBe('Session title: "My Conversation"');
        });

        it('should log message:queued with position', () => {
            const next = vi.fn();
            const event: ClientEvent = {
                name: 'message:queued',
                position: 2,
                id: 'msg-123',
                sessionId: 'session-1',
            };

            activityMiddleware(event, next);

            const { events } = useEventLogStore.getState();
            expect(events[0].category).toBe('user');
            expect(events[0].description).toBe('Message queued at position 2');
        });

        it('should log message:dequeued', () => {
            const next = vi.fn();
            const event: ClientEvent = {
                name: 'message:dequeued',
                count: 2,
                ids: ['msg-1', 'msg-2'],
                coalesced: true,
                content: [{ type: 'text', text: 'Hello' }],
                sessionId: 'session-1',
            };

            activityMiddleware(event, next);

            const { events } = useEventLogStore.getState();
            expect(events[0].category).toBe('user');
            expect(events[0].description).toBe('Queued message processed');
        });

        it('should log context:compacted with token counts', () => {
            const next = vi.fn();
            const event: ClientEvent = {
                name: 'context:compacted',
                originalTokens: 10000,
                compactedTokens: 5000,
                originalMessages: 50,
                compactedMessages: 25,
                strategy: 'llm-summary',
                reason: 'overflow',
                sessionId: 'session-1',
            };

            activityMiddleware(event, next);

            const { events } = useEventLogStore.getState();
            expect(events[0].category).toBe('system');
            expect(events[0].description).toBe('Context compacted: 10000 → 5000 tokens');
        });

        it('should log context:pruned with counts', () => {
            const next = vi.fn();
            const event: ClientEvent = {
                name: 'context:pruned',
                prunedCount: 10,
                savedTokens: 2000,
                sessionId: 'session-1',
            };

            activityMiddleware(event, next);

            const { events } = useEventLogStore.getState();
            expect(events[0].category).toBe('system');
            expect(events[0].description).toBe('Context pruned: 10 messages, saved 2000 tokens');
        });

        it('should log connection:status event', () => {
            const next = vi.fn();
            const event: ClientEvent = {
                name: 'connection:status',
                status: 'reconnecting',
                timestamp: Date.now(),
            };

            activityMiddleware(event, next);

            const { events } = useEventLogStore.getState();
            expect(events[0].category).toBe('system');
            expect(events[0].description).toBe('Connection reconnecting');
        });
    });

    describe('unknown events', () => {
        it('should log unknown events as system category', () => {
            const next = vi.fn();
            const event: ClientEvent = {
                name: 'custom:event' as any,
                data: 'test',
            } as any;

            activityMiddleware(event, next);

            const { events } = useEventLogStore.getState();
            expect(events).toHaveLength(1);
            expect(events[0].category).toBe('system');
            expect(events[0].description).toBe('Unknown event: custom:event');
        });
    });

    describe('sessionId capture', () => {
        it('should capture sessionId from events that have it', () => {
            const next = vi.fn();
            const event: ClientEvent = {
                name: 'llm:thinking',
                sessionId: 'session-123',
            };

            activityMiddleware(event, next);

            const { events } = useEventLogStore.getState();
            expect(events[0].sessionId).toBe('session-123');
        });

        it('should handle events without sessionId', () => {
            const next = vi.fn();
            const event: ClientEvent = {
                name: 'connection:status',
                status: 'connected',
                timestamp: Date.now(),
            };

            activityMiddleware(event, next);

            const { events } = useEventLogStore.getState();
            expect(events[0].sessionId).toBeUndefined();
        });
    });

    describe('metadata storage', () => {
        it('should store full event as metadata', () => {
            const next = vi.fn();
            const event: ClientEvent = {
                name: 'llm:tool-call',
                toolName: 'read_file',
                args: { path: '/test.txt', encoding: 'utf-8' },
                callId: 'call-123',
                sessionId: 'session-1',
            };

            activityMiddleware(event, next);

            const { events } = useEventLogStore.getState();
            expect(events[0].metadata).toEqual({
                name: 'llm:tool-call',
                toolName: 'read_file',
                args: { path: '/test.txt', encoding: 'utf-8' },
                callId: 'call-123',
                sessionId: 'session-1',
            });
        });
    });
});

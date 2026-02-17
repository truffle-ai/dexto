/**
 * EventBus Integration Tests
 *
 * Tests the full flow of events through the EventBus to stores:
 * Event → EventBus → Handlers → Store Actions → State Updates
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ClientEventBus } from './EventBus.js';
import { setupEventHandlers } from './handlers.js';
import { useChatStore } from '../stores/chatStore.js';
import { useAgentStore } from '../stores/agentStore.js';
import { ApprovalType, ApprovalStatus } from '@dexto/core';

describe('EventBus Integration', () => {
    let bus: ClientEventBus;
    let cleanup: () => void;

    beforeEach(() => {
        bus = new ClientEventBus();
        cleanup = setupEventHandlers(bus);

        // Reset stores to clean state
        useChatStore.setState({ sessions: new Map() });
        useAgentStore.setState({
            status: 'idle',
            connectionStatus: 'disconnected',
            lastHeartbeat: null,
            activeSessionId: null,
            currentToolName: null,
            connectionError: null,
            reconnectAttempts: 0,
        });
    });

    afterEach(() => {
        cleanup();
    });

    // =========================================================================
    // LLM Events
    // =========================================================================

    describe('LLM Events', () => {
        it('should process llm:thinking and update stores', () => {
            bus.dispatch({
                name: 'llm:thinking',
                sessionId: 'test-session',
            });

            // Check agent status
            expect(useAgentStore.getState().status).toBe('thinking');
            expect(useAgentStore.getState().activeSessionId).toBe('test-session');

            // Check chat processing state
            const sessionState = useChatStore.getState().getSessionState('test-session');
            expect(sessionState.processing).toBe(true);
        });

        it('should process llm:chunk and create streaming message', () => {
            bus.dispatch({
                name: 'llm:chunk',
                sessionId: 'test-session',
                content: 'Hello',
                chunkType: 'text',
            });

            const sessionState = useChatStore.getState().getSessionState('test-session');
            expect(sessionState.streamingMessage).not.toBeNull();
            expect(sessionState.streamingMessage?.content).toBe('Hello');
            expect(sessionState.streamingMessage?.role).toBe('assistant');
        });

        it('should append chunks to streaming message', () => {
            // First chunk
            bus.dispatch({
                name: 'llm:chunk',
                sessionId: 'test-session',
                content: 'Hello',
                chunkType: 'text',
            });

            // Second chunk
            bus.dispatch({
                name: 'llm:chunk',
                sessionId: 'test-session',
                content: ' world',
                chunkType: 'text',
            });

            const sessionState = useChatStore.getState().getSessionState('test-session');
            expect(sessionState.streamingMessage?.content).toBe('Hello world');
        });

        it('should handle reasoning chunks separately', () => {
            // Text chunk
            bus.dispatch({
                name: 'llm:chunk',
                sessionId: 'test-session',
                content: 'Answer',
                chunkType: 'text',
            });

            // Reasoning chunk
            bus.dispatch({
                name: 'llm:chunk',
                sessionId: 'test-session',
                content: 'Thinking...',
                chunkType: 'reasoning',
            });

            const sessionState = useChatStore.getState().getSessionState('test-session');
            expect(sessionState.streamingMessage?.content).toBe('Answer');
            expect(sessionState.streamingMessage?.reasoning).toBe('Thinking...');
        });

        it('should finalize streaming message on llm:response', () => {
            // Create streaming message
            bus.dispatch({
                name: 'llm:chunk',
                sessionId: 'test-session',
                content: 'Complete response',
                chunkType: 'text',
            });

            // Finalize
            bus.dispatch({
                name: 'llm:response',
                sessionId: 'test-session',
                content: 'Complete response',
                model: 'gpt-4',
                provider: 'openai',
                tokenUsage: {
                    inputTokens: 10,
                    outputTokens: 20,
                    totalTokens: 30,
                },
            });

            const sessionState = useChatStore.getState().getSessionState('test-session');
            expect(sessionState.streamingMessage).toBeNull();
            expect(sessionState.messages).toHaveLength(1);
            expect(sessionState.messages[0].content).toBe('Complete response');
            expect(sessionState.messages[0].model).toBe('gpt-4');
            expect(sessionState.messages[0].tokenUsage?.totalTokens).toBe(30);
        });

        it('should handle llm:error and update stores', () => {
            bus.dispatch({
                name: 'llm:error',
                sessionId: 'test-session',
                error: {
                    name: 'TestError',
                    message: 'Something went wrong',
                },
                context: 'During generation',
                recoverable: true,
            });

            // Check agent status
            expect(useAgentStore.getState().status).toBe('idle');

            // Check error state
            const sessionState = useChatStore.getState().getSessionState('test-session');
            expect(sessionState.error).not.toBeNull();
            expect(sessionState.error?.message).toBe('Something went wrong');
            expect(sessionState.error?.recoverable).toBe(true);
            expect(sessionState.processing).toBe(false);
        });
    });

    // =========================================================================
    // Tool Events
    // =========================================================================

    describe('Tool Events', () => {
        it('should process llm:tool-call and create tool message', () => {
            bus.dispatch({
                name: 'llm:tool-call',
                sessionId: 'test-session',
                toolName: 'read_file',
                args: { path: '/test.txt' },
                callId: 'call-123',
            });

            // Check agent status
            expect(useAgentStore.getState().status).toBe('executing_tool');
            expect(useAgentStore.getState().currentToolName).toBe('read_file');

            // Check tool message
            const sessionState = useChatStore.getState().getSessionState('test-session');
            expect(sessionState.messages).toHaveLength(1);
            expect(sessionState.messages[0].toolName).toBe('read_file');
            expect(sessionState.messages[0].toolCallId).toBe('call-123');
        });

        it('should update tool message with result', () => {
            // Create tool call
            bus.dispatch({
                name: 'llm:tool-call',
                sessionId: 'test-session',
                toolName: 'read_file',
                args: { path: '/test.txt' },
                callId: 'call-123',
            });

            // Add result
            const sanitizedResult = {
                content: [{ type: 'text' as const, text: 'File contents' }],
                meta: { toolName: 'read_file', toolCallId: 'call-123', success: true },
            };
            bus.dispatch({
                name: 'llm:tool-result',
                sessionId: 'test-session',
                toolName: 'read_file',
                callId: 'call-123',
                success: true,
                sanitized: sanitizedResult,
            });

            const sessionState = useChatStore.getState().getSessionState('test-session');
            const toolMessage = sessionState.messages[0];
            expect(toolMessage.toolResult).toEqual(sanitizedResult);
            expect(toolMessage.toolResultSuccess).toBe(true);
        });

        it('should handle tool result with approval requirements', () => {
            // Create tool call
            bus.dispatch({
                name: 'llm:tool-call',
                sessionId: 'test-session',
                toolName: 'write_file',
                args: { path: '/test.txt', content: 'data' },
                callId: 'call-456',
            });

            // Add result with approval
            const sanitizedResult = {
                content: [{ type: 'text' as const, text: 'File written' }],
                meta: { toolName: 'write_file', toolCallId: 'call-456', success: true },
            };
            bus.dispatch({
                name: 'llm:tool-result',
                sessionId: 'test-session',
                toolName: 'write_file',
                callId: 'call-456',
                success: true,
                sanitized: sanitizedResult,
                requireApproval: true,
                approvalStatus: 'approved',
            });

            const sessionState = useChatStore.getState().getSessionState('test-session');
            const toolMessage = sessionState.messages[0];
            expect(toolMessage.requireApproval).toBe(true);
            expect(toolMessage.approvalStatus).toBe('approved');
        });
    });

    // =========================================================================
    // Approval Events
    // =========================================================================

    describe('Approval Events', () => {
        it('should process approval:request', () => {
            bus.dispatch({
                name: 'approval:request',
                sessionId: 'test-session',
                type: ApprovalType.TOOL_APPROVAL,
                approvalId: 'approval-123',
                timeout: 30000,
                timestamp: new Date(),
                metadata: {
                    toolName: 'write_file',
                    toolCallId: 'call-write-123',
                    args: { path: '/test.txt' },
                },
            });

            expect(useAgentStore.getState().status).toBe('awaiting_approval');
            expect(useAgentStore.getState().activeSessionId).toBe('test-session');
        });

        it('should process approval:response with approved status', () => {
            // Set awaiting approval
            bus.dispatch({
                name: 'approval:request',
                sessionId: 'test-session',
                type: ApprovalType.TOOL_APPROVAL,
                approvalId: 'approval-123',
                timeout: 30000,
                timestamp: new Date(),
                metadata: {
                    toolName: 'write_file',
                    toolCallId: 'call-write-123',
                    args: { path: '/test.txt' },
                },
            });

            // Approve
            bus.dispatch({
                name: 'approval:response',
                sessionId: 'test-session',
                approvalId: 'approval-123',
                status: ApprovalStatus.APPROVED,
            });

            // Status transitions to 'thinking' - agent is resuming execution after approval
            expect(useAgentStore.getState().status).toBe('thinking');
        });

        it('should process approval:response with rejected status', () => {
            // Set awaiting approval
            bus.dispatch({
                name: 'approval:request',
                sessionId: 'test-session',
                type: ApprovalType.TOOL_APPROVAL,
                approvalId: 'approval-456',
                timeout: 30000,
                timestamp: new Date(),
                metadata: {
                    toolName: 'write_file',
                    toolCallId: 'call-write-456',
                    args: { path: '/test.txt' },
                },
            });

            // Reject
            bus.dispatch({
                name: 'approval:response',
                sessionId: 'test-session',
                approvalId: 'approval-456',
                status: ApprovalStatus.DENIED,
            });

            expect(useAgentStore.getState().status).toBe('idle');
        });
    });

    // =========================================================================
    // Run Events
    // =========================================================================

    describe('Run Events', () => {
        it('should process run:complete', () => {
            // Set processing state
            useChatStore.getState().setProcessing('test-session', true);
            useAgentStore.getState().setThinking('test-session');

            // Complete run
            bus.dispatch({
                name: 'run:complete',
                sessionId: 'test-session',
                finishReason: 'stop',
                stepCount: 3,
                durationMs: 1500,
            });

            // Check states reset
            const sessionState = useChatStore.getState().getSessionState('test-session');
            expect(sessionState.processing).toBe(false);
            expect(useAgentStore.getState().status).toBe('idle');
        });
    });

    // =========================================================================
    // Message Events
    // =========================================================================

    describe('Message Events', () => {
        it('should process message:dequeued with text content', () => {
            bus.dispatch({
                name: 'message:dequeued',
                sessionId: 'test-session',
                count: 1,
                ids: ['queued-1'],
                coalesced: false,
                content: [{ type: 'text', text: 'Hello from queue' }],
                messages: [
                    {
                        id: 'queued-1',
                        content: [{ type: 'text', text: 'Hello from queue' }],
                        queuedAt: Date.now(),
                    },
                ],
            });

            const sessionState = useChatStore.getState().getSessionState('test-session');
            expect(sessionState.messages).toHaveLength(1);
            expect(sessionState.messages[0].role).toBe('user');
            expect(sessionState.messages[0].content).toBe('Hello from queue');
        });

        it('should process message:dequeued with image attachment', () => {
            bus.dispatch({
                name: 'message:dequeued',
                sessionId: 'test-session',
                count: 1,
                ids: ['queued-2'],
                coalesced: false,
                content: [
                    { type: 'text', text: 'Check this image' },
                    { type: 'image', image: 'base64data', mimeType: 'image/png' },
                ],
                messages: [
                    {
                        id: 'queued-2',
                        content: [
                            { type: 'text', text: 'Check this image' },
                            { type: 'image', image: 'base64data', mimeType: 'image/png' },
                        ],
                        queuedAt: Date.now(),
                    },
                ],
            });

            const sessionState = useChatStore.getState().getSessionState('test-session');
            expect(sessionState.messages).toHaveLength(1);
            expect(sessionState.messages[0].content).toBe('Check this image');
            expect(sessionState.messages[0].imageData).toEqual({
                image: 'base64data',
                mimeType: 'image/png',
            });
        });

        it('should process message:dequeued with file attachment', () => {
            bus.dispatch({
                name: 'message:dequeued',
                sessionId: 'test-session',
                count: 1,
                ids: ['queued-3'],
                coalesced: false,
                content: [
                    { type: 'text', text: 'Here is the file' },
                    {
                        type: 'file',
                        data: 'filedata',
                        mimeType: 'text/plain',
                        filename: 'test.txt',
                    },
                ],
                messages: [
                    {
                        id: 'queued-3',
                        content: [
                            { type: 'text', text: 'Here is the file' },
                            {
                                type: 'file',
                                data: 'filedata',
                                mimeType: 'text/plain',
                                filename: 'test.txt',
                            },
                        ],
                        queuedAt: Date.now(),
                    },
                ],
            });

            const sessionState = useChatStore.getState().getSessionState('test-session');
            expect(sessionState.messages).toHaveLength(1);
            expect(sessionState.messages[0].fileData).toEqual({
                data: 'filedata',
                mimeType: 'text/plain',
                filename: 'test.txt',
            });
        });
    });

    // =========================================================================
    // Multi-Session Support
    // =========================================================================

    describe('Multi-Session Support', () => {
        it('should handle events for multiple sessions independently', () => {
            // Session 1
            bus.dispatch({
                name: 'llm:thinking',
                sessionId: 'session-1',
            });

            bus.dispatch({
                name: 'llm:chunk',
                sessionId: 'session-1',
                content: 'Response 1',
                chunkType: 'text',
            });

            // Session 2
            bus.dispatch({
                name: 'llm:thinking',
                sessionId: 'session-2',
            });

            bus.dispatch({
                name: 'llm:chunk',
                sessionId: 'session-2',
                content: 'Response 2',
                chunkType: 'text',
            });

            // Verify isolation
            const session1 = useChatStore.getState().getSessionState('session-1');
            const session2 = useChatStore.getState().getSessionState('session-2');

            expect(session1.streamingMessage?.content).toBe('Response 1');
            expect(session2.streamingMessage?.content).toBe('Response 2');
            expect(session1.processing).toBe(true);
            expect(session2.processing).toBe(true);
        });
    });

    // =========================================================================
    // Error Handling
    // =========================================================================

    describe('Error Handling', () => {
        it('should handle unknown events gracefully', () => {
            // Dispatch unknown event (should not throw)
            expect(() => {
                bus.dispatch({
                    // @ts-expect-error Testing unknown event
                    name: 'unknown:event',
                    sessionId: 'test-session',
                });
            }).not.toThrow();
        });

        it('should handle events with missing sessionId', () => {
            // Some events might not have sessionId
            expect(() => {
                bus.dispatch({
                    name: 'context:compacted',
                    sessionId: 'test-session',
                    originalTokens: 1000,
                    compactedTokens: 500,
                    originalMessages: 10,
                    compactedMessages: 5,
                    strategy: 'auto',
                    reason: 'overflow',
                });
            }).not.toThrow();
        });
    });
});

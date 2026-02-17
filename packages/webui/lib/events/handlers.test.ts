/**
 * Event Handler Registry Tests
 *
 * Tests each handler to ensure correct store updates.
 * Uses Zustand's test utilities to spy on store actions.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { StreamingEvent } from '@dexto/core';
import { ApprovalType, ApprovalStatus } from '@dexto/core';
import {
    registerHandlers,
    getHandler,
    handleLLMThinking,
    handleLLMChunk,
    handleLLMResponse,
    handleToolCall,
    handleToolResult,
    handleLLMError,
    handleApprovalRequest,
    handleApprovalResponse,
    handleRunComplete,
    handleSessionTitleUpdated,
    handleMessageDequeued,
    handleContextCompacted,
} from './handlers.js';
import { useChatStore } from '../stores/chatStore.js';
import { useAgentStore } from '../stores/agentStore.js';

// Mock generateMessageId to return predictable IDs
vi.mock('../stores/chatStore.js', async () => {
    const actual = await vi.importActual('../stores/chatStore.js');
    return {
        ...actual,
        generateMessageId: vi.fn(() => 'test-msg-id'),
    };
});

describe('Event Handler Registry', () => {
    const TEST_SESSION_ID = 'test-session';

    beforeEach(() => {
        // Reset stores before each test
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

        // Initialize session in chat store
        useChatStore.getState().initSession(TEST_SESSION_ID);

        // Clear mock calls
        vi.clearAllMocks();
    });

    describe('Registry Management', () => {
        it('should register all handlers', () => {
            registerHandlers();

            // Check that all expected handlers are registered
            expect(getHandler('llm:thinking')).toBeDefined();
            expect(getHandler('llm:chunk')).toBeDefined();
            expect(getHandler('llm:response')).toBeDefined();
            expect(getHandler('llm:tool-call')).toBeDefined();
            expect(getHandler('llm:tool-result')).toBeDefined();
            expect(getHandler('llm:error')).toBeDefined();
            expect(getHandler('approval:request')).toBeDefined();
            expect(getHandler('approval:response')).toBeDefined();
            expect(getHandler('run:complete')).toBeDefined();
            expect(getHandler('session:title-updated')).toBeDefined();
            expect(getHandler('message:dequeued')).toBeDefined();
            expect(getHandler('context:compacted')).toBeDefined();
        });

        it('should return undefined for unregistered handlers', () => {
            registerHandlers();
            expect(getHandler('nonexistent:event')).toBeUndefined();
        });
    });

    describe('handleLLMThinking', () => {
        it('should set processing=true and agent status to thinking', () => {
            const event: Extract<StreamingEvent, { name: 'llm:thinking' }> = {
                name: 'llm:thinking',
                sessionId: TEST_SESSION_ID,
            };

            handleLLMThinking(event);

            // Check chat store
            const chatState = useChatStore.getState().getSessionState(TEST_SESSION_ID);
            expect(chatState.processing).toBe(true);

            // Check agent store
            const agentState = useAgentStore.getState();
            expect(agentState.status).toBe('thinking');
            expect(agentState.activeSessionId).toBe(TEST_SESSION_ID);
        });
    });

    describe('handleLLMChunk', () => {
        it('should create streaming message on first chunk', () => {
            const event: Extract<StreamingEvent, { name: 'llm:chunk' }> = {
                name: 'llm:chunk',
                sessionId: TEST_SESSION_ID,
                chunkType: 'text',
                content: 'Hello',
            };

            handleLLMChunk(event);

            const chatState = useChatStore.getState().getSessionState(TEST_SESSION_ID);
            expect(chatState.streamingMessage).toBeDefined();
            expect(chatState.streamingMessage?.content).toBe('Hello');
            expect(chatState.streamingMessage?.role).toBe('assistant');
        });

        it('should append to existing streaming message', () => {
            // Create initial streaming message
            useChatStore.getState().setStreamingMessage(TEST_SESSION_ID, {
                id: 'msg-1',
                role: 'assistant',
                content: 'Hello',
                createdAt: Date.now(),
            });

            const event: Extract<StreamingEvent, { name: 'llm:chunk' }> = {
                name: 'llm:chunk',
                sessionId: TEST_SESSION_ID,
                chunkType: 'text',
                content: ' world',
            };

            handleLLMChunk(event);

            const chatState = useChatStore.getState().getSessionState(TEST_SESSION_ID);
            expect(chatState.streamingMessage?.content).toBe('Hello world');
        });

        it('should handle reasoning chunks', () => {
            const event: Extract<StreamingEvent, { name: 'llm:chunk' }> = {
                name: 'llm:chunk',
                sessionId: TEST_SESSION_ID,
                chunkType: 'reasoning',
                content: 'Thinking...',
            };

            handleLLMChunk(event);

            const chatState = useChatStore.getState().getSessionState(TEST_SESSION_ID);
            expect(chatState.streamingMessage?.reasoning).toBe('Thinking...');
        });
    });

    describe('handleLLMResponse', () => {
        it('should finalize streaming message with metadata', () => {
            // Create streaming message
            useChatStore.getState().setStreamingMessage(TEST_SESSION_ID, {
                id: 'msg-1',
                role: 'assistant',
                content: 'Response content',
                createdAt: Date.now(),
            });

            const event: Extract<StreamingEvent, { name: 'llm:response' }> = {
                name: 'llm:response',
                sessionId: TEST_SESSION_ID,
                content: 'Response content',
                provider: 'openai',
                model: 'gpt-4',
                tokenUsage: {
                    inputTokens: 10,
                    outputTokens: 20,
                    totalTokens: 30,
                },
            };

            handleLLMResponse(event);

            const chatState = useChatStore.getState().getSessionState(TEST_SESSION_ID);
            expect(chatState.streamingMessage).toBeNull();
            expect(chatState.messages).toHaveLength(1);
            expect(chatState.messages[0].tokenUsage).toEqual(event.tokenUsage);
            expect(chatState.messages[0].model).toBe('gpt-4');
            expect(chatState.messages[0].provider).toBe('openai');
        });
    });

    describe('handleToolCall', () => {
        it('should add tool message to chat', () => {
            const event: Extract<StreamingEvent, { name: 'llm:tool-call' }> = {
                name: 'llm:tool-call',
                sessionId: TEST_SESSION_ID,
                toolName: 'calculator',
                args: { expression: '2+2' },
                callId: 'call-123',
            };

            handleToolCall(event);

            const chatState = useChatStore.getState().getSessionState(TEST_SESSION_ID);
            expect(chatState.messages).toHaveLength(1);
            expect(chatState.messages[0].role).toBe('tool');
            expect(chatState.messages[0].toolName).toBe('calculator');
            expect(chatState.messages[0].toolArgs).toEqual({ expression: '2+2' });
            expect(chatState.messages[0].toolCallId).toBe('call-123');

            // Check agent status
            const agentState = useAgentStore.getState();
            expect(agentState.status).toBe('executing_tool');
            expect(agentState.currentToolName).toBe('calculator');
        });
    });

    describe('handleToolResult', () => {
        it('should update tool message with result', () => {
            // Add tool message first
            useChatStore.getState().addMessage(TEST_SESSION_ID, {
                id: 'tool-msg',
                role: 'tool',
                content: null,
                toolName: 'calculator',
                toolCallId: 'call-123',
                createdAt: Date.now(),
            });

            const event: Extract<StreamingEvent, { name: 'llm:tool-result' }> = {
                name: 'llm:tool-result',
                sessionId: TEST_SESSION_ID,
                toolName: 'calculator',
                callId: 'call-123',
                success: true,
                sanitized: {
                    content: [{ type: 'text', text: '4' }],
                    meta: { toolName: 'calculator', toolCallId: 'call-123', success: true },
                },
            };

            handleToolResult(event);

            const message = useChatStore.getState().getMessage(TEST_SESSION_ID, 'tool-msg');
            expect(message?.toolResult).toEqual(event.sanitized);
            expect(message?.toolResultSuccess).toBe(true);
        });

        it('should handle approval metadata', () => {
            useChatStore.getState().addMessage(TEST_SESSION_ID, {
                id: 'tool-msg',
                role: 'tool',
                content: null,
                toolName: 'dangerous-tool',
                toolCallId: 'call-456',
                createdAt: Date.now(),
            });

            const event: Extract<StreamingEvent, { name: 'llm:tool-result' }> = {
                name: 'llm:tool-result',
                sessionId: TEST_SESSION_ID,
                toolName: 'dangerous-tool',
                callId: 'call-456',
                success: true,
                sanitized: {
                    content: [],
                    meta: { toolName: 'dangerous-tool', toolCallId: 'call-456', success: true },
                },
                requireApproval: true,
                approvalStatus: 'approved',
            };

            handleToolResult(event);

            const message = useChatStore.getState().getMessage(TEST_SESSION_ID, 'tool-msg');
            expect(message?.requireApproval).toBe(true);
            expect(message?.approvalStatus).toBe('approved');
        });
    });

    describe('handleLLMError', () => {
        it('should set error and stop processing', () => {
            const event: Extract<StreamingEvent, { name: 'llm:error' }> = {
                name: 'llm:error',
                sessionId: TEST_SESSION_ID,
                error: new Error('Test error'),
                context: 'test-context',
                recoverable: true,
            };

            handleLLMError(event);

            const chatState = useChatStore.getState().getSessionState(TEST_SESSION_ID);
            expect(chatState.error).toBeDefined();
            expect(chatState.error?.message).toBe('Test error');
            expect(chatState.error?.context).toBe('test-context');
            expect(chatState.error?.recoverable).toBe(true);
            expect(chatState.processing).toBe(false);

            // Check agent status
            const agentState = useAgentStore.getState();
            expect(agentState.status).toBe('idle');
        });
    });

    describe('handleApprovalRequest', () => {
        it('should set agent status to awaiting approval', () => {
            const event: Extract<StreamingEvent, { name: 'approval:request' }> = {
                name: 'approval:request',
                sessionId: TEST_SESSION_ID,
                approvalId: 'approval-1',
                type: ApprovalType.TOOL_APPROVAL,
                metadata: {
                    toolName: 'dangerous-tool',
                    toolCallId: 'call-dangerous-1',
                    args: {},
                },
                timeout: 30000,
                timestamp: new Date(),
            };

            handleApprovalRequest(event);

            const agentState = useAgentStore.getState();
            expect(agentState.status).toBe('awaiting_approval');
            expect(agentState.activeSessionId).toBe(TEST_SESSION_ID);
        });
    });

    describe('handleApprovalResponse', () => {
        it('should set agent to thinking when approved', () => {
            const event: Extract<StreamingEvent, { name: 'approval:response' }> = {
                name: 'approval:response',
                sessionId: TEST_SESSION_ID,
                approvalId: 'approval-1',
                status: ApprovalStatus.APPROVED,
            };

            handleApprovalResponse(event);

            const agentState = useAgentStore.getState();
            // Agent resumes execution after approval - set to thinking (not idle)
            expect(agentState.status).toBe('thinking');
        });

        it('should set agent to idle when rejected', () => {
            const event: Extract<StreamingEvent, { name: 'approval:response' }> = {
                name: 'approval:response',
                sessionId: TEST_SESSION_ID,
                approvalId: 'approval-1',
                status: ApprovalStatus.DENIED,
            };

            handleApprovalResponse(event);

            const agentState = useAgentStore.getState();
            expect(agentState.status).toBe('idle');
        });
    });

    describe('handleRunComplete', () => {
        it('should stop processing and set agent to idle', () => {
            // Set up initial state
            useChatStore.getState().setProcessing(TEST_SESSION_ID, true);
            useAgentStore.getState().setThinking(TEST_SESSION_ID);

            const event = {
                name: 'run:complete' as const,
                sessionId: TEST_SESSION_ID,
                finishReason: 'stop',
                stepCount: 3,
            };

            handleRunComplete(event as any);

            const chatState = useChatStore.getState().getSessionState(TEST_SESSION_ID);
            expect(chatState.processing).toBe(false);

            const agentState = useAgentStore.getState();
            expect(agentState.status).toBe('idle');
        });
    });

    describe('handleSessionTitleUpdated', () => {
        it('should log debug message (placeholder)', () => {
            const consoleSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});

            const event: Extract<StreamingEvent, { name: 'session:title-updated' }> = {
                name: 'session:title-updated',
                sessionId: TEST_SESSION_ID,
                title: 'New Title',
            };

            handleSessionTitleUpdated(event);

            expect(consoleSpy).toHaveBeenCalledWith(
                '[handlers] session:title-updated',
                TEST_SESSION_ID,
                'New Title'
            );

            consoleSpy.mockRestore();
        });
    });

    describe('handleMessageDequeued', () => {
        it('should add user message with text content', () => {
            const event = {
                name: 'message:dequeued' as const,
                sessionId: TEST_SESSION_ID,
                count: 1,
                ids: ['queued-1'],
                coalesced: false,
                content: [{ type: 'text', text: 'Queued message' }],
            };

            handleMessageDequeued(event as any);

            const chatState = useChatStore.getState().getSessionState(TEST_SESSION_ID);
            expect(chatState.messages).toHaveLength(1);
            expect(chatState.messages[0].role).toBe('user');
            expect(chatState.messages[0].content).toBe('Queued message');
        });

        it('should handle image attachments', () => {
            const event = {
                name: 'message:dequeued' as const,
                sessionId: TEST_SESSION_ID,
                count: 1,
                ids: ['queued-1'],
                coalesced: false,
                content: [
                    { type: 'text', text: 'Check this out' },
                    { type: 'image', image: 'base64data', mimeType: 'image/png' },
                ],
            };

            handleMessageDequeued(event as any);

            const chatState = useChatStore.getState().getSessionState(TEST_SESSION_ID);
            expect(chatState.messages[0].imageData).toEqual({
                image: 'base64data',
                mimeType: 'image/png',
            });
        });

        it('should handle file attachments', () => {
            const event = {
                name: 'message:dequeued' as const,
                sessionId: TEST_SESSION_ID,
                count: 1,
                ids: ['queued-1'],
                coalesced: false,
                content: [
                    { type: 'text', text: 'Here is a file' },
                    {
                        type: 'file',
                        data: 'file-data',
                        mimeType: 'text/plain',
                        filename: 'test.txt',
                    },
                ],
            };

            handleMessageDequeued(event as any);

            const chatState = useChatStore.getState().getSessionState(TEST_SESSION_ID);
            expect(chatState.messages[0].fileData).toEqual({
                data: 'file-data',
                mimeType: 'text/plain',
                filename: 'test.txt',
            });
        });
    });

    describe('handleContextCompacted', () => {
        it('should log debug message', () => {
            const consoleSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});

            const event = {
                name: 'context:compacted' as const,
                sessionId: TEST_SESSION_ID,
                originalTokens: 10000,
                compactedTokens: 5000,
                originalMessages: 20,
                compactedMessages: 10,
                strategy: 'llm-based',
                reason: 'overflow',
            };

            handleContextCompacted(event as any);

            expect(consoleSpy).toHaveBeenCalled();
            const call = consoleSpy.mock.calls[0];
            expect(call[0]).toContain('Context compacted');
            expect(call[0]).toContain('10,000 → 5,000 tokens');

            consoleSpy.mockRestore();
        });
    });
});

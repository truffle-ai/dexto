import { describe, it, expect, beforeEach } from 'vitest';
import { useChatStore, generateMessageId, type Message } from './chatStore.js';

// Helper to create a test message
function createTestMessage(overrides: Partial<Message> = {}): Message {
    return {
        id: generateMessageId(),
        role: 'user',
        content: 'Test message',
        createdAt: Date.now(),
        ...overrides,
    };
}

describe('chatStore', () => {
    const sessionId = 'test-session';

    beforeEach(() => {
        // Reset store to default state
        useChatStore.setState({ sessions: new Map() });
    });

    describe('generateMessageId', () => {
        it('should generate unique IDs', () => {
            const id1 = generateMessageId();
            const id2 = generateMessageId();
            expect(id1).not.toBe(id2);
        });

        it('should start with msg- prefix', () => {
            const id = generateMessageId();
            expect(id.startsWith('msg-')).toBe(true);
        });
    });

    describe('initSession', () => {
        it('should initialize a session with default state', () => {
            useChatStore.getState().initSession(sessionId);

            const state = useChatStore.getState().getSessionState(sessionId);
            expect(state.messages).toEqual([]);
            expect(state.streamingMessage).toBeNull();
            expect(state.processing).toBe(false);
            expect(state.error).toBeNull();
            expect(state.loadingHistory).toBe(false);
        });

        it('should not overwrite existing session', () => {
            const message = createTestMessage();
            useChatStore.getState().initSession(sessionId);
            useChatStore.getState().addMessage(sessionId, message);
            useChatStore.getState().initSession(sessionId);

            const messages = useChatStore.getState().getMessages(sessionId);
            expect(messages).toHaveLength(1);
        });
    });

    describe('addMessage', () => {
        it('should add a message to a session', () => {
            const message = createTestMessage();
            useChatStore.getState().addMessage(sessionId, message);

            const messages = useChatStore.getState().getMessages(sessionId);
            expect(messages).toHaveLength(1);
            expect(messages[0]).toEqual(message);
        });

        it('should create session if not exists', () => {
            const message = createTestMessage();
            useChatStore.getState().addMessage('new-session', message);

            const messages = useChatStore.getState().getMessages('new-session');
            expect(messages).toHaveLength(1);
        });

        it('should append multiple messages in order', () => {
            const msg1 = createTestMessage({ content: 'First' });
            const msg2 = createTestMessage({ content: 'Second' });

            useChatStore.getState().addMessage(sessionId, msg1);
            useChatStore.getState().addMessage(sessionId, msg2);

            const messages = useChatStore.getState().getMessages(sessionId);
            expect(messages).toHaveLength(2);
            expect(messages[0].content).toBe('First');
            expect(messages[1].content).toBe('Second');
        });
    });

    describe('updateMessage', () => {
        it('should update an existing message', () => {
            const message = createTestMessage({ content: 'Original' });
            useChatStore.getState().addMessage(sessionId, message);

            useChatStore.getState().updateMessage(sessionId, message.id, {
                content: 'Updated',
            });

            const updated = useChatStore.getState().getMessage(sessionId, message.id);
            expect(updated?.content).toBe('Updated');
        });

        it('should not modify state for non-existent message', () => {
            const message = createTestMessage();
            useChatStore.getState().addMessage(sessionId, message);

            useChatStore.getState().updateMessage(sessionId, 'non-existent', {
                content: 'Updated',
            });

            // State should be unchanged - original message still present
            const messages = useChatStore.getState().getMessages(sessionId);
            expect(messages).toHaveLength(1);
            expect(messages[0].content).toBe(message.content);
        });

        it('should not modify state for non-existent session', () => {
            useChatStore.getState().updateMessage('non-existent', 'msg-id', {
                content: 'Updated',
            });

            expect(useChatStore.getState().sessions.has('non-existent')).toBe(false);
        });
    });

    describe('removeMessage', () => {
        it('should remove a message from a session', () => {
            const message = createTestMessage();
            useChatStore.getState().addMessage(sessionId, message);
            useChatStore.getState().removeMessage(sessionId, message.id);

            const messages = useChatStore.getState().getMessages(sessionId);
            expect(messages).toHaveLength(0);
        });

        it('should not affect other messages', () => {
            const msg1 = createTestMessage({ content: 'Keep' });
            const msg2 = createTestMessage({ content: 'Remove' });

            useChatStore.getState().addMessage(sessionId, msg1);
            useChatStore.getState().addMessage(sessionId, msg2);
            useChatStore.getState().removeMessage(sessionId, msg2.id);

            const messages = useChatStore.getState().getMessages(sessionId);
            expect(messages).toHaveLength(1);
            expect(messages[0].content).toBe('Keep');
        });
    });

    describe('clearMessages', () => {
        it('should clear all messages in a session', () => {
            useChatStore.getState().addMessage(sessionId, createTestMessage());
            useChatStore.getState().addMessage(sessionId, createTestMessage());
            useChatStore.getState().clearMessages(sessionId);

            const messages = useChatStore.getState().getMessages(sessionId);
            expect(messages).toHaveLength(0);
        });

        it('should also clear streaming message', () => {
            const streaming = createTestMessage({ role: 'assistant' });
            useChatStore.getState().setStreamingMessage(sessionId, streaming);
            useChatStore.getState().clearMessages(sessionId);

            const state = useChatStore.getState().getSessionState(sessionId);
            expect(state.streamingMessage).toBeNull();
        });
    });

    describe('streaming message', () => {
        it('should set streaming message', () => {
            const message = createTestMessage({ role: 'assistant', content: '' });
            useChatStore.getState().setStreamingMessage(sessionId, message);

            const state = useChatStore.getState().getSessionState(sessionId);
            expect(state.streamingMessage).toEqual(message);
        });

        it('should clear streaming message', () => {
            const message = createTestMessage({ role: 'assistant' });
            useChatStore.getState().setStreamingMessage(sessionId, message);
            useChatStore.getState().setStreamingMessage(sessionId, null);

            const state = useChatStore.getState().getSessionState(sessionId);
            expect(state.streamingMessage).toBeNull();
        });

        it('should append text content to streaming message', () => {
            const message = createTestMessage({ role: 'assistant', content: 'Hello' });
            useChatStore.getState().setStreamingMessage(sessionId, message);
            useChatStore.getState().appendToStreamingMessage(sessionId, ' World');

            const state = useChatStore.getState().getSessionState(sessionId);
            expect(state.streamingMessage?.content).toBe('Hello World');
        });

        it('should append reasoning content to streaming message', () => {
            const message = createTestMessage({ role: 'assistant', content: '', reasoning: '' });
            useChatStore.getState().setStreamingMessage(sessionId, message);
            useChatStore.getState().appendToStreamingMessage(sessionId, 'Thinking...', 'reasoning');

            const state = useChatStore.getState().getSessionState(sessionId);
            expect(state.streamingMessage?.reasoning).toBe('Thinking...');
        });

        it('should not append if no streaming message', () => {
            // Should not throw
            useChatStore.getState().appendToStreamingMessage(sessionId, 'Test');

            const state = useChatStore.getState().getSessionState(sessionId);
            expect(state.streamingMessage).toBeNull();
        });

        it('should finalize streaming message', () => {
            const message = createTestMessage({ role: 'assistant', content: 'Response' });
            useChatStore.getState().setStreamingMessage(sessionId, message);
            useChatStore.getState().finalizeStreamingMessage(sessionId, {
                tokenUsage: { totalTokens: 100 },
            });

            const state = useChatStore.getState().getSessionState(sessionId);
            expect(state.streamingMessage).toBeNull();
            expect(state.messages).toHaveLength(1);
            expect(state.messages[0].content).toBe('Response');
            expect(state.messages[0].tokenUsage?.totalTokens).toBe(100);
        });

        it('should not finalize if no streaming message', () => {
            useChatStore.getState().finalizeStreamingMessage(sessionId);

            const state = useChatStore.getState().getSessionState(sessionId);
            expect(state.messages).toHaveLength(0);
        });
    });

    describe('state flags', () => {
        it('should set processing flag', () => {
            useChatStore.getState().setProcessing(sessionId, true);
            expect(useChatStore.getState().getSessionState(sessionId).processing).toBe(true);

            useChatStore.getState().setProcessing(sessionId, false);
            expect(useChatStore.getState().getSessionState(sessionId).processing).toBe(false);
        });

        it('should set error state', () => {
            const error = {
                id: 'error-1',
                message: 'Test error',
                timestamp: Date.now(),
            };
            useChatStore.getState().setError(sessionId, error);
            expect(useChatStore.getState().getSessionState(sessionId).error).toEqual(error);

            useChatStore.getState().setError(sessionId, null);
            expect(useChatStore.getState().getSessionState(sessionId).error).toBeNull();
        });

        it('should set loading history flag', () => {
            useChatStore.getState().setLoadingHistory(sessionId, true);
            expect(useChatStore.getState().getSessionState(sessionId).loadingHistory).toBe(true);
        });
    });

    describe('removeSession', () => {
        it('should remove a session completely', () => {
            useChatStore.getState().addMessage(sessionId, createTestMessage());
            useChatStore.getState().removeSession(sessionId);

            expect(useChatStore.getState().sessions.has(sessionId)).toBe(false);
        });
    });

    describe('selectors', () => {
        it('getSessionState should return default for unknown session', () => {
            const state = useChatStore.getState().getSessionState('unknown');
            expect(state.messages).toEqual([]);
            expect(state.processing).toBe(false);
        });

        it('getMessage should find message by ID', () => {
            const message = createTestMessage();
            useChatStore.getState().addMessage(sessionId, message);

            const found = useChatStore.getState().getMessage(sessionId, message.id);
            expect(found).toEqual(message);
        });

        it('getMessage should return undefined for unknown ID', () => {
            const found = useChatStore.getState().getMessage(sessionId, 'unknown');
            expect(found).toBeUndefined();
        });

        it('getMessageByToolCallId should find tool message', () => {
            const message = createTestMessage({
                role: 'tool',
                toolCallId: 'tool-call-123',
            });
            useChatStore.getState().addMessage(sessionId, message);

            const found = useChatStore
                .getState()
                .getMessageByToolCallId(sessionId, 'tool-call-123');
            expect(found).toEqual(message);
        });
    });

    describe('session isolation', () => {
        it('should keep sessions separate', () => {
            const session1 = 'session-1';
            const session2 = 'session-2';

            useChatStore
                .getState()
                .addMessage(session1, createTestMessage({ content: 'Session 1' }));
            useChatStore
                .getState()
                .addMessage(session2, createTestMessage({ content: 'Session 2' }));

            expect(useChatStore.getState().getMessages(session1)).toHaveLength(1);
            expect(useChatStore.getState().getMessages(session2)).toHaveLength(1);
            expect(useChatStore.getState().getMessages(session1)[0].content).toBe('Session 1');
            expect(useChatStore.getState().getMessages(session2)[0].content).toBe('Session 2');
        });

        it('should not affect other sessions when clearing', () => {
            const session1 = 'session-1';
            const session2 = 'session-2';

            useChatStore.getState().addMessage(session1, createTestMessage());
            useChatStore.getState().addMessage(session2, createTestMessage());
            useChatStore.getState().clearMessages(session1);

            expect(useChatStore.getState().getMessages(session1)).toHaveLength(0);
            expect(useChatStore.getState().getMessages(session2)).toHaveLength(1);
        });
    });
});

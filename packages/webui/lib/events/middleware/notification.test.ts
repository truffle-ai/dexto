/**
 * Tests for notification middleware
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { notificationMiddleware } from './notification.js';
import { useSessionStore } from '../../stores/sessionStore.js';
import { useNotificationStore } from '../../stores/notificationStore.js';
import type { ClientEvent } from '../types.js';

describe('notificationMiddleware', () => {
    // Mock next function
    const next = vi.fn();

    beforeEach(() => {
        // Reset stores
        useSessionStore.setState({
            currentSessionId: 'current-session',
            isWelcomeState: false,
            isCreatingSession: false,
            isSwitchingSession: false,
            isReplayingHistory: false,
            isLoadingHistory: false,
        });

        useNotificationStore.setState({
            toasts: [],
            maxToasts: 5,
        });

        // Clear mock
        next.mockClear();
    });

    it('should always call next', () => {
        const event: ClientEvent = {
            name: 'llm:thinking',
            sessionId: 'test-session',
        };

        notificationMiddleware(event, next);

        expect(next).toHaveBeenCalledWith(event);
        expect(next).toHaveBeenCalledTimes(1);
    });

    describe('notification suppression', () => {
        it('should suppress notifications during history replay', () => {
            useSessionStore.setState({ isReplayingHistory: true });

            const event: ClientEvent = {
                name: 'llm:error',
                error: new Error('Test error'),
                sessionId: 'test-session',
            };

            notificationMiddleware(event, next);

            expect(next).toHaveBeenCalled();
            expect(useNotificationStore.getState().toasts).toHaveLength(0);
        });

        it('should suppress notifications during session switch', () => {
            useSessionStore.setState({ isSwitchingSession: true });

            const event: ClientEvent = {
                name: 'llm:error',
                error: new Error('Test error'),
                sessionId: 'test-session',
            };

            notificationMiddleware(event, next);

            expect(next).toHaveBeenCalled();
            expect(useNotificationStore.getState().toasts).toHaveLength(0);
        });

        it('should suppress notifications during history loading', () => {
            useSessionStore.setState({ isLoadingHistory: true });

            const event: ClientEvent = {
                name: 'llm:response',
                content: 'Test response',
                sessionId: 'background-session',
            };

            notificationMiddleware(event, next);

            expect(next).toHaveBeenCalled();
            expect(useNotificationStore.getState().toasts).toHaveLength(0);
        });
    });

    describe('llm:error events', () => {
        it('should NOT create toast for errors in current session (shown inline)', () => {
            useSessionStore.setState({ currentSessionId: 'current-session' });

            const event: ClientEvent = {
                name: 'llm:error',
                error: new Error('Test error message'),
                sessionId: 'current-session',
            };

            notificationMiddleware(event, next);

            // Errors in current session are shown inline via ErrorBanner, not as toasts
            const { toasts } = useNotificationStore.getState();
            expect(toasts).toHaveLength(0);
        });

        it('should create toast for errors in background session', () => {
            useSessionStore.setState({ currentSessionId: 'current-session' });

            const event: ClientEvent = {
                name: 'llm:error',
                error: new Error('Test error'),
                sessionId: 'background-session',
            };

            notificationMiddleware(event, next);

            const { toasts } = useNotificationStore.getState();
            expect(toasts).toHaveLength(1);
            expect(toasts[0].title).toBe('Error in background session');
            expect(toasts[0].description).toBe('Test error');
            expect(toasts[0].intent).toBe('danger');
            expect(toasts[0].sessionId).toBe('background-session');
        });

        it('should handle error without message in background session', () => {
            useSessionStore.setState({ currentSessionId: 'current-session' });

            const event: ClientEvent = {
                name: 'llm:error',
                error: new Error(),
                sessionId: 'background-session',
            };

            notificationMiddleware(event, next);

            const { toasts } = useNotificationStore.getState();
            expect(toasts).toHaveLength(1);
            expect(toasts[0].description).toBe('An error occurred');
        });
    });

    describe('llm:response events', () => {
        it('should NOT create toast for responses in current session', () => {
            useSessionStore.setState({ currentSessionId: 'current-session' });

            const event: ClientEvent = {
                name: 'llm:response',
                content: 'Test response',
                sessionId: 'current-session',
            };

            notificationMiddleware(event, next);

            const { toasts } = useNotificationStore.getState();
            expect(toasts).toHaveLength(0);
        });

        it('should create toast for responses in background session', () => {
            useSessionStore.setState({ currentSessionId: 'current-session' });

            const event: ClientEvent = {
                name: 'llm:response',
                content: 'Test response',
                sessionId: 'background-session',
            };

            notificationMiddleware(event, next);

            const { toasts } = useNotificationStore.getState();
            expect(toasts).toHaveLength(1);
            expect(toasts[0].title).toBe('Response Ready');
            expect(toasts[0].description).toBe('Agent completed in background session');
            expect(toasts[0].intent).toBe('info');
            expect(toasts[0].sessionId).toBe('background-session');
        });

        it('should create toast when no session is active (treated as background)', () => {
            useSessionStore.setState({ currentSessionId: null });

            const event: ClientEvent = {
                name: 'llm:response',
                content: 'Test response',
                sessionId: 'some-session',
            };

            notificationMiddleware(event, next);

            const { toasts } = useNotificationStore.getState();
            // When no session is active, any session is considered "background"
            expect(toasts).toHaveLength(1);
            expect(toasts[0].sessionId).toBe('some-session');
        });
    });

    describe('other events', () => {
        it('should not create toast for llm:thinking', () => {
            const event: ClientEvent = {
                name: 'llm:thinking',
                sessionId: 'test-session',
            };

            notificationMiddleware(event, next);

            expect(useNotificationStore.getState().toasts).toHaveLength(0);
        });

        it('should not create toast for llm:chunk', () => {
            const event: ClientEvent = {
                name: 'llm:chunk',
                chunkType: 'text',
                content: 'Test chunk',
                sessionId: 'test-session',
            };

            notificationMiddleware(event, next);

            expect(useNotificationStore.getState().toasts).toHaveLength(0);
        });

        it('should not create toast for llm:tool-call', () => {
            const event: ClientEvent = {
                name: 'llm:tool-call',
                toolName: 'test-tool',
                args: {},
                callId: 'call-123',
                sessionId: 'test-session',
            };

            notificationMiddleware(event, next);

            expect(useNotificationStore.getState().toasts).toHaveLength(0);
        });

        it('should not create toast for connection:status', () => {
            const event: ClientEvent = {
                name: 'connection:status',
                status: 'connected',
                timestamp: Date.now(),
            };

            notificationMiddleware(event, next);

            expect(useNotificationStore.getState().toasts).toHaveLength(0);
        });
    });
});

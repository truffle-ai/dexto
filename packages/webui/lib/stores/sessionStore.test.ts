import { describe, it, expect, beforeEach } from 'vitest';
import { useSessionStore } from './sessionStore.js';

describe('sessionStore', () => {
    beforeEach(() => {
        // Reset store to default state
        useSessionStore.setState({
            currentSessionId: null,
            isWelcomeState: true,
            isCreatingSession: false,
            isSwitchingSession: false,
            isReplayingHistory: false,
            isLoadingHistory: false,
        });
    });

    describe('setCurrentSession', () => {
        it('should set the current session ID', () => {
            useSessionStore.getState().setCurrentSession('session-123');
            expect(useSessionStore.getState().currentSessionId).toBe('session-123');
        });

        it('should set isWelcomeState to false when setting a session', () => {
            useSessionStore.getState().setCurrentSession('session-123');
            expect(useSessionStore.getState().isWelcomeState).toBe(false);
        });

        it('should set isWelcomeState to true when setting null', () => {
            useSessionStore.getState().setCurrentSession('session-123');
            useSessionStore.getState().setCurrentSession(null);
            expect(useSessionStore.getState().isWelcomeState).toBe(true);
            expect(useSessionStore.getState().currentSessionId).toBeNull();
        });
    });

    describe('setWelcomeState', () => {
        it('should set welcome state to true and clear session', () => {
            useSessionStore.getState().setCurrentSession('session-123');
            useSessionStore.getState().setWelcomeState(true);
            expect(useSessionStore.getState().isWelcomeState).toBe(true);
            expect(useSessionStore.getState().currentSessionId).toBeNull();
        });

        it('should set welcome state to false without clearing session', () => {
            useSessionStore.getState().setCurrentSession('session-123');
            useSessionStore.getState().setWelcomeState(false);
            expect(useSessionStore.getState().isWelcomeState).toBe(false);
            expect(useSessionStore.getState().currentSessionId).toBe('session-123');
        });
    });

    describe('returnToWelcome', () => {
        it('should reset to welcome state and clear all flags', () => {
            useSessionStore.setState({
                currentSessionId: 'session-123',
                isWelcomeState: false,
                isCreatingSession: true,
                isSwitchingSession: true,
                isReplayingHistory: true,
                isLoadingHistory: true,
            });

            useSessionStore.getState().returnToWelcome();

            expect(useSessionStore.getState().currentSessionId).toBeNull();
            expect(useSessionStore.getState().isWelcomeState).toBe(true);
            expect(useSessionStore.getState().isCreatingSession).toBe(false);
            expect(useSessionStore.getState().isSwitchingSession).toBe(false);
            expect(useSessionStore.getState().isReplayingHistory).toBe(false);
            expect(useSessionStore.getState().isLoadingHistory).toBe(false);
        });
    });

    describe('session creation flow', () => {
        it('should handle beginSessionCreation', () => {
            useSessionStore.getState().beginSessionCreation();
            expect(useSessionStore.getState().isCreatingSession).toBe(true);
            expect(useSessionStore.getState().isWelcomeState).toBe(false);
        });

        it('should handle completeSessionCreation', () => {
            useSessionStore.getState().beginSessionCreation();
            useSessionStore.getState().completeSessionCreation('new-session-id');

            expect(useSessionStore.getState().currentSessionId).toBe('new-session-id');
            expect(useSessionStore.getState().isCreatingSession).toBe(false);
            expect(useSessionStore.getState().isWelcomeState).toBe(false);
        });

        it('should handle cancelSessionCreation returning to welcome', () => {
            // Start from welcome state
            useSessionStore.getState().beginSessionCreation();
            useSessionStore.getState().cancelSessionCreation();

            expect(useSessionStore.getState().isCreatingSession).toBe(false);
            expect(useSessionStore.getState().isWelcomeState).toBe(true);
        });

        it('should handle cancelSessionCreation staying in session', () => {
            // Start from existing session
            useSessionStore.getState().setCurrentSession('existing-session');
            useSessionStore.getState().beginSessionCreation();
            useSessionStore.getState().cancelSessionCreation();

            expect(useSessionStore.getState().isCreatingSession).toBe(false);
            // Should stay on existing session, not go to welcome
            expect(useSessionStore.getState().isWelcomeState).toBe(false);
        });
    });

    describe('selectors', () => {
        it('isSessionOperationPending should return true when creating', () => {
            useSessionStore.setState({ isCreatingSession: true });
            expect(useSessionStore.getState().isSessionOperationPending()).toBe(true);
        });

        it('isSessionOperationPending should return true when switching', () => {
            useSessionStore.setState({ isSwitchingSession: true });
            expect(useSessionStore.getState().isSessionOperationPending()).toBe(true);
        });

        it('isSessionOperationPending should return true when loading history', () => {
            useSessionStore.setState({ isLoadingHistory: true });
            expect(useSessionStore.getState().isSessionOperationPending()).toBe(true);
        });

        it('isSessionOperationPending should return false when idle', () => {
            expect(useSessionStore.getState().isSessionOperationPending()).toBe(false);
        });

        it('shouldSuppressNotifications should return true during replay', () => {
            useSessionStore.setState({ isReplayingHistory: true });
            expect(useSessionStore.getState().shouldSuppressNotifications()).toBe(true);
        });

        it('shouldSuppressNotifications should return true during switch', () => {
            useSessionStore.setState({ isSwitchingSession: true });
            expect(useSessionStore.getState().shouldSuppressNotifications()).toBe(true);
        });

        it('shouldSuppressNotifications should return false during normal operation', () => {
            expect(useSessionStore.getState().shouldSuppressNotifications()).toBe(false);
        });
    });

    describe('individual setters', () => {
        it('should set creating session flag', () => {
            useSessionStore.getState().setCreatingSession(true);
            expect(useSessionStore.getState().isCreatingSession).toBe(true);
            useSessionStore.getState().setCreatingSession(false);
            expect(useSessionStore.getState().isCreatingSession).toBe(false);
        });

        it('should set switching session flag', () => {
            useSessionStore.getState().setSwitchingSession(true);
            expect(useSessionStore.getState().isSwitchingSession).toBe(true);
        });

        it('should set replaying history flag', () => {
            useSessionStore.getState().setReplayingHistory(true);
            expect(useSessionStore.getState().isReplayingHistory).toBe(true);
        });

        it('should set loading history flag', () => {
            useSessionStore.getState().setLoadingHistory(true);
            expect(useSessionStore.getState().isLoadingHistory).toBe(true);
        });
    });
});

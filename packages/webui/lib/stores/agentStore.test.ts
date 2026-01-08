import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { useAgentStore } from './agentStore.js';

describe('agentStore', () => {
    beforeEach(() => {
        // Reset store to default state
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
        vi.useRealTimers();
    });

    describe('status actions', () => {
        it('should set status with setStatus', () => {
            useAgentStore.getState().setStatus('thinking', 'session-1');
            expect(useAgentStore.getState().status).toBe('thinking');
            expect(useAgentStore.getState().activeSessionId).toBe('session-1');
        });

        it('should clear activeSessionId when setting to idle', () => {
            useAgentStore.getState().setStatus('thinking', 'session-1');
            useAgentStore.getState().setStatus('idle');
            expect(useAgentStore.getState().activeSessionId).toBeNull();
        });

        it('should set thinking status', () => {
            useAgentStore.getState().setThinking('session-1');
            expect(useAgentStore.getState().status).toBe('thinking');
            expect(useAgentStore.getState().activeSessionId).toBe('session-1');
            expect(useAgentStore.getState().currentToolName).toBeNull();
        });

        it('should set executing tool status with tool name', () => {
            useAgentStore.getState().setExecutingTool('session-1', 'read_file');
            expect(useAgentStore.getState().status).toBe('executing_tool');
            expect(useAgentStore.getState().activeSessionId).toBe('session-1');
            expect(useAgentStore.getState().currentToolName).toBe('read_file');
        });

        it('should set awaiting approval status', () => {
            useAgentStore.getState().setAwaitingApproval('session-1');
            expect(useAgentStore.getState().status).toBe('awaiting_approval');
            expect(useAgentStore.getState().activeSessionId).toBe('session-1');
        });

        it('should set idle and clear all', () => {
            useAgentStore.getState().setExecutingTool('session-1', 'bash');
            useAgentStore.getState().setIdle();
            expect(useAgentStore.getState().status).toBe('idle');
            expect(useAgentStore.getState().activeSessionId).toBeNull();
            expect(useAgentStore.getState().currentToolName).toBeNull();
        });

        it('should clear tool name when transitioning from executing_tool to other status', () => {
            useAgentStore.getState().setExecutingTool('session-1', 'bash');
            useAgentStore.getState().setThinking('session-1');
            expect(useAgentStore.getState().currentToolName).toBeNull();
        });
    });

    describe('connection actions', () => {
        it('should set connection status', () => {
            useAgentStore.getState().setConnectionStatus('connected');
            expect(useAgentStore.getState().connectionStatus).toBe('connected');
        });

        it('should handle setConnected', () => {
            vi.useFakeTimers();
            vi.setSystemTime(new Date('2024-01-01'));

            useAgentStore.setState({
                connectionError: 'Previous error',
                reconnectAttempts: 5,
            });

            useAgentStore.getState().setConnected();

            expect(useAgentStore.getState().connectionStatus).toBe('connected');
            expect(useAgentStore.getState().connectionError).toBeNull();
            expect(useAgentStore.getState().reconnectAttempts).toBe(0);
            expect(useAgentStore.getState().lastHeartbeat).toBe(Date.now());
        });

        it('should handle setDisconnected without error', () => {
            useAgentStore.getState().setDisconnected();
            expect(useAgentStore.getState().connectionStatus).toBe('disconnected');
            expect(useAgentStore.getState().connectionError).toBeNull();
        });

        it('should handle setDisconnected with error', () => {
            useAgentStore.getState().setDisconnected('Network error');
            expect(useAgentStore.getState().connectionStatus).toBe('disconnected');
            expect(useAgentStore.getState().connectionError).toBe('Network error');
        });

        it('should handle setReconnecting', () => {
            useAgentStore.getState().setReconnecting();
            expect(useAgentStore.getState().connectionStatus).toBe('reconnecting');
        });

        it('should update heartbeat timestamp', () => {
            vi.useFakeTimers();
            vi.setSystemTime(new Date('2024-01-01T12:00:00'));

            useAgentStore.getState().updateHeartbeat();
            expect(useAgentStore.getState().lastHeartbeat).toBe(Date.now());
        });

        it('should increment reconnect attempts', () => {
            useAgentStore.getState().incrementReconnectAttempts();
            expect(useAgentStore.getState().reconnectAttempts).toBe(1);
            useAgentStore.getState().incrementReconnectAttempts();
            expect(useAgentStore.getState().reconnectAttempts).toBe(2);
        });

        it('should reset reconnect attempts', () => {
            useAgentStore.setState({ reconnectAttempts: 5 });
            useAgentStore.getState().resetReconnectAttempts();
            expect(useAgentStore.getState().reconnectAttempts).toBe(0);
        });
    });

    describe('selectors', () => {
        it('isBusy should return true when not idle', () => {
            useAgentStore.getState().setThinking('session-1');
            expect(useAgentStore.getState().isBusy()).toBe(true);
        });

        it('isBusy should return false when idle', () => {
            expect(useAgentStore.getState().isBusy()).toBe(false);
        });

        it('isConnected should return true when connected', () => {
            useAgentStore.getState().setConnected();
            expect(useAgentStore.getState().isConnected()).toBe(true);
        });

        it('isConnected should return false when disconnected', () => {
            expect(useAgentStore.getState().isConnected()).toBe(false);
        });

        it('isConnected should return false when reconnecting', () => {
            useAgentStore.getState().setReconnecting();
            expect(useAgentStore.getState().isConnected()).toBe(false);
        });

        it('isActiveForSession should return true for matching session', () => {
            useAgentStore.getState().setThinking('session-1');
            expect(useAgentStore.getState().isActiveForSession('session-1')).toBe(true);
        });

        it('isActiveForSession should return false for different session', () => {
            useAgentStore.getState().setThinking('session-1');
            expect(useAgentStore.getState().isActiveForSession('session-2')).toBe(false);
        });

        it('isActiveForSession should return false when idle', () => {
            expect(useAgentStore.getState().isActiveForSession('session-1')).toBe(false);
        });

        it('getHeartbeatAge should return null when no heartbeat', () => {
            expect(useAgentStore.getState().getHeartbeatAge()).toBeNull();
        });

        it('getHeartbeatAge should return age in milliseconds', () => {
            vi.useFakeTimers();
            vi.setSystemTime(new Date('2024-01-01T12:00:00'));

            useAgentStore.getState().updateHeartbeat();

            // Advance time by 5 seconds
            vi.advanceTimersByTime(5000);

            expect(useAgentStore.getState().getHeartbeatAge()).toBe(5000);
        });
    });

    describe('status transitions', () => {
        it('should handle full lifecycle: idle -> thinking -> executing -> idle', () => {
            expect(useAgentStore.getState().status).toBe('idle');

            useAgentStore.getState().setThinking('session-1');
            expect(useAgentStore.getState().status).toBe('thinking');

            useAgentStore.getState().setExecutingTool('session-1', 'read_file');
            expect(useAgentStore.getState().status).toBe('executing_tool');

            useAgentStore.getState().setIdle();
            expect(useAgentStore.getState().status).toBe('idle');
        });

        it('should handle approval flow: thinking -> awaiting_approval -> idle', () => {
            useAgentStore.getState().setThinking('session-1');
            useAgentStore.getState().setAwaitingApproval('session-1');
            expect(useAgentStore.getState().status).toBe('awaiting_approval');

            // After approval, back to thinking or idle
            useAgentStore.getState().setThinking('session-1');
            expect(useAgentStore.getState().status).toBe('thinking');
        });
    });
});

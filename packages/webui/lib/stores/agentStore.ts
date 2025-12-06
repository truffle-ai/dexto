/**
 * Agent Store
 *
 * Manages the agent's status and connection state.
 * This is global state (not per-session) as there's one agent connection.
 */

import { create } from 'zustand';

// =============================================================================
// Types
// =============================================================================

/**
 * Agent's current activity status
 */
export type AgentStatus =
    | 'idle' // Ready for input
    | 'thinking' // Processing/generating response
    | 'executing_tool' // Running a tool
    | 'awaiting_approval'; // Waiting for user approval

/**
 * Connection status to the backend
 */
export type ConnectionStatus = 'connected' | 'disconnected' | 'reconnecting';

/**
 * Agent state
 */
export interface AgentState {
    /**
     * Current agent activity status
     */
    status: AgentStatus;

    /**
     * Connection status to the backend
     */
    connectionStatus: ConnectionStatus;

    /**
     * Timestamp of last heartbeat (for connection health monitoring)
     */
    lastHeartbeat: number | null;

    /**
     * Currently active session for the agent (for status context)
     */
    activeSessionId: string | null;

    /**
     * Name of the tool currently being executed (if any)
     */
    currentToolName: string | null;

    /**
     * Error message if connection failed
     */
    connectionError: string | null;

    /**
     * Number of reconnection attempts
     */
    reconnectAttempts: number;
}

// =============================================================================
// Store Interface
// =============================================================================

interface AgentStore extends AgentState {
    // -------------------------------------------------------------------------
    // Status Actions
    // -------------------------------------------------------------------------

    /**
     * Set the agent's activity status
     */
    setStatus: (status: AgentStatus, sessionId?: string) => void;

    /**
     * Set status to thinking
     */
    setThinking: (sessionId: string) => void;

    /**
     * Set status to executing tool
     */
    setExecutingTool: (sessionId: string, toolName: string) => void;

    /**
     * Set status to awaiting approval
     */
    setAwaitingApproval: (sessionId: string) => void;

    /**
     * Set status to idle
     */
    setIdle: () => void;

    // -------------------------------------------------------------------------
    // Connection Actions
    // -------------------------------------------------------------------------

    /**
     * Set the connection status
     */
    setConnectionStatus: (status: ConnectionStatus) => void;

    /**
     * Mark connection as established
     */
    setConnected: () => void;

    /**
     * Mark connection as lost
     */
    setDisconnected: (error?: string) => void;

    /**
     * Mark as attempting reconnection
     */
    setReconnecting: () => void;

    /**
     * Update the heartbeat timestamp
     */
    updateHeartbeat: () => void;

    /**
     * Increment reconnection attempt counter
     */
    incrementReconnectAttempts: () => void;

    /**
     * Reset reconnection attempt counter
     */
    resetReconnectAttempts: () => void;

    // -------------------------------------------------------------------------
    // Selectors
    // -------------------------------------------------------------------------

    /**
     * Check if the agent is busy (not idle)
     */
    isBusy: () => boolean;

    /**
     * Check if connected
     */
    isConnected: () => boolean;

    /**
     * Check if the agent is working on a specific session
     */
    isActiveForSession: (sessionId: string) => boolean;

    /**
     * Get time since last heartbeat (ms), or null if no heartbeat
     */
    getHeartbeatAge: () => number | null;
}

// =============================================================================
// Default State
// =============================================================================

const defaultState: AgentState = {
    status: 'idle',
    connectionStatus: 'disconnected',
    lastHeartbeat: null,
    activeSessionId: null,
    currentToolName: null,
    connectionError: null,
    reconnectAttempts: 0,
};

// =============================================================================
// Store Implementation
// =============================================================================

export const useAgentStore = create<AgentStore>()((set, get) => ({
    ...defaultState,

    // -------------------------------------------------------------------------
    // Status Actions
    // -------------------------------------------------------------------------

    setStatus: (status, sessionId) => {
        set({
            status,
            activeSessionId: sessionId ?? (status === 'idle' ? null : get().activeSessionId),
            // Clear tool name if not executing
            currentToolName: status === 'executing_tool' ? get().currentToolName : null,
        });
    },

    setThinking: (sessionId) => {
        set({
            status: 'thinking',
            activeSessionId: sessionId,
            currentToolName: null,
        });
    },

    setExecutingTool: (sessionId, toolName) => {
        set({
            status: 'executing_tool',
            activeSessionId: sessionId,
            currentToolName: toolName,
        });
    },

    setAwaitingApproval: (sessionId) => {
        set({
            status: 'awaiting_approval',
            activeSessionId: sessionId,
            currentToolName: null,
        });
    },

    setIdle: () => {
        set({
            status: 'idle',
            activeSessionId: null,
            currentToolName: null,
        });
    },

    // -------------------------------------------------------------------------
    // Connection Actions
    // -------------------------------------------------------------------------

    setConnectionStatus: (status) => {
        set({ connectionStatus: status });
    },

    setConnected: () => {
        set({
            connectionStatus: 'connected',
            connectionError: null,
            reconnectAttempts: 0,
            lastHeartbeat: Date.now(),
        });
    },

    setDisconnected: (error) => {
        set({
            connectionStatus: 'disconnected',
            connectionError: error ?? null,
        });
    },

    setReconnecting: () => {
        set({
            connectionStatus: 'reconnecting',
        });
    },

    updateHeartbeat: () => {
        set({ lastHeartbeat: Date.now() });
    },

    incrementReconnectAttempts: () => {
        set((state) => ({
            reconnectAttempts: state.reconnectAttempts + 1,
        }));
    },

    resetReconnectAttempts: () => {
        set({ reconnectAttempts: 0 });
    },

    // -------------------------------------------------------------------------
    // Selectors
    // -------------------------------------------------------------------------

    isBusy: () => {
        return get().status !== 'idle';
    },

    isConnected: () => {
        return get().connectionStatus === 'connected';
    },

    isActiveForSession: (sessionId) => {
        const state = get();
        return state.status !== 'idle' && state.activeSessionId === sessionId;
    },

    getHeartbeatAge: () => {
        const { lastHeartbeat } = get();
        if (lastHeartbeat === null) return null;
        return Date.now() - lastHeartbeat;
    },
}));

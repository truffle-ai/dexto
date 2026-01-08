/**
 * Session Store
 *
 * Manages the current session state and navigation state.
 * Separate from chatStore which handles per-session message state.
 */

import { create } from 'zustand';

// =============================================================================
// Types
// =============================================================================

/**
 * Session navigation and UI state
 */
export interface SessionState {
    /**
     * Currently active session ID (null = welcome state)
     */
    currentSessionId: string | null;

    /**
     * Whether we're showing the welcome/landing screen
     */
    isWelcomeState: boolean;

    /**
     * Session is being created (new session in progress)
     */
    isCreatingSession: boolean;

    /**
     * Session switch in progress
     */
    isSwitchingSession: boolean;

    /**
     * History replay in progress (suppress notifications during this)
     */
    isReplayingHistory: boolean;

    /**
     * Loading history for a session
     */
    isLoadingHistory: boolean;
}

// =============================================================================
// Store Interface
// =============================================================================

interface SessionStore extends SessionState {
    // -------------------------------------------------------------------------
    // Session Actions
    // -------------------------------------------------------------------------

    /**
     * Set the current active session
     * Setting to null transitions to welcome state
     */
    setCurrentSession: (sessionId: string | null) => void;

    /**
     * Explicitly set welcome state
     */
    setWelcomeState: (isWelcome: boolean) => void;

    /**
     * Set session creation in progress
     */
    setCreatingSession: (isCreating: boolean) => void;

    /**
     * Set session switch in progress
     */
    setSwitchingSession: (isSwitching: boolean) => void;

    /**
     * Set history replay in progress
     */
    setReplayingHistory: (isReplaying: boolean) => void;

    /**
     * Set history loading state
     */
    setLoadingHistory: (isLoading: boolean) => void;

    // -------------------------------------------------------------------------
    // Composite Actions
    // -------------------------------------------------------------------------

    /**
     * Return to welcome screen (clear current session)
     */
    returnToWelcome: () => void;

    /**
     * Start creating a new session
     */
    beginSessionCreation: () => void;

    /**
     * Complete session creation and activate the new session
     * @param newSessionId - The newly created session ID
     */
    completeSessionCreation: (newSessionId: string) => void;

    /**
     * Cancel session creation (e.g., on error)
     */
    cancelSessionCreation: () => void;

    // -------------------------------------------------------------------------
    // Selectors
    // -------------------------------------------------------------------------

    /**
     * Check if any session operation is in progress
     */
    isSessionOperationPending: () => boolean;

    /**
     * Check if we should suppress notifications
     * (during history replay or session operations)
     */
    shouldSuppressNotifications: () => boolean;
}

// =============================================================================
// Default State
// =============================================================================

const defaultState: SessionState = {
    currentSessionId: null,
    isWelcomeState: true,
    isCreatingSession: false,
    isSwitchingSession: false,
    isReplayingHistory: false,
    isLoadingHistory: false,
};

// =============================================================================
// Store Implementation
// =============================================================================

export const useSessionStore = create<SessionStore>()((set, get) => ({
    ...defaultState,

    // -------------------------------------------------------------------------
    // Session Actions
    // -------------------------------------------------------------------------

    setCurrentSession: (sessionId) => {
        set({
            currentSessionId: sessionId,
            isWelcomeState: sessionId === null,
        });
    },

    setWelcomeState: (isWelcome) => {
        set({
            isWelcomeState: isWelcome,
            // Clear session when going to welcome
            ...(isWelcome ? { currentSessionId: null } : {}),
        });
    },

    setCreatingSession: (isCreating) => {
        set({ isCreatingSession: isCreating });
    },

    setSwitchingSession: (isSwitching) => {
        set({ isSwitchingSession: isSwitching });
    },

    setReplayingHistory: (isReplaying) => {
        set({ isReplayingHistory: isReplaying });
    },

    setLoadingHistory: (isLoading) => {
        set({ isLoadingHistory: isLoading });
    },

    // -------------------------------------------------------------------------
    // Composite Actions
    // -------------------------------------------------------------------------

    returnToWelcome: () => {
        set({
            currentSessionId: null,
            isWelcomeState: true,
            isCreatingSession: false,
            isSwitchingSession: false,
            isReplayingHistory: false,
            isLoadingHistory: false,
        });
    },

    beginSessionCreation: () => {
        set({
            isCreatingSession: true,
            isWelcomeState: false,
        });
    },

    completeSessionCreation: (newSessionId) => {
        set({
            currentSessionId: newSessionId,
            isCreatingSession: false,
            isWelcomeState: false,
        });
    },

    cancelSessionCreation: () => {
        set({
            isCreatingSession: false,
            // Return to welcome if we were there before
            isWelcomeState: get().currentSessionId === null,
        });
    },

    // -------------------------------------------------------------------------
    // Selectors
    // -------------------------------------------------------------------------

    isSessionOperationPending: () => {
        const state = get();
        return state.isCreatingSession || state.isSwitchingSession || state.isLoadingHistory;
    },

    shouldSuppressNotifications: () => {
        const state = get();
        return state.isReplayingHistory || state.isSwitchingSession || state.isLoadingHistory;
    },
}));

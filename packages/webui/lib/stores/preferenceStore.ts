/**
 * Preference Store
 *
 * Manages user preferences with localStorage persistence.
 * Uses zustand persist middleware for automatic sync.
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';

// =============================================================================
// Types
// =============================================================================

/**
 * User preference state
 */
export interface PreferenceState {
    /**
     * Whether streaming mode is enabled (SSE vs sync)
     * @default true
     */
    isStreaming: boolean;
}

// =============================================================================
// Store Interface
// =============================================================================

interface PreferenceStore extends PreferenceState {
    /**
     * Toggle streaming mode
     */
    setStreaming: (enabled: boolean) => void;
}

// =============================================================================
// Default State
// =============================================================================

const defaultState: PreferenceState = {
    isStreaming: true, // Default to streaming enabled
};

// =============================================================================
// Store Implementation
// =============================================================================

export const usePreferenceStore = create<PreferenceStore>()(
    persist(
        (set) => ({
            ...defaultState,

            setStreaming: (enabled) => {
                set({ isStreaming: enabled });
            },
        }),
        {
            name: 'dexto-preferences', // localStorage key
            version: 1,
        }
    )
);

/**
 * React hook for streaming state
 *
 * Subscribes to the streaming state manager and returns current value.
 * Components using this hook will re-render when streaming is toggled.
 */

import { useState, useEffect } from 'react';
import {
    isStreamingEnabled,
    subscribeToStreaming,
    setStreamingEnabled,
    toggleStreaming,
} from '../state/streaming-state.js';

export interface UseStreamingResult {
    /** Current streaming state */
    streaming: boolean;
    /** Set streaming state */
    setStreaming: (enabled: boolean) => void;
    /** Toggle streaming state */
    toggleStreaming: () => boolean;
}

/**
 * Hook to access and modify streaming state
 */
export function useStreaming(): UseStreamingResult {
    const [streaming, setStreamingState] = useState(isStreamingEnabled);

    useEffect(() => {
        // Subscribe to changes from command or other sources
        const unsubscribe = subscribeToStreaming((enabled) => {
            setStreamingState(enabled);
        });

        return unsubscribe;
    }, []);

    return {
        streaming,
        setStreaming: setStreamingEnabled,
        toggleStreaming,
    };
}

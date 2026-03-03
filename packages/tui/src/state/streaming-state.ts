/**
 * Streaming state manager for CLI
 *
 * Simple module-level state that can be accessed by both React components
 * and command handlers. Uses a subscription pattern for React integration.
 */

type StreamingListener = (enabled: boolean) => void;

let streamingEnabled = false;
const listeners = new Set<StreamingListener>();

/**
 * Get current streaming state
 */
export function isStreamingEnabled(): boolean {
    return streamingEnabled;
}

/**
 * Set streaming state and notify listeners
 */
export function setStreamingEnabled(enabled: boolean): void {
    if (streamingEnabled !== enabled) {
        streamingEnabled = enabled;
        listeners.forEach((listener) => listener(enabled));
    }
}

/**
 * Toggle streaming state
 * @returns New streaming state
 */
export function toggleStreaming(): boolean {
    setStreamingEnabled(!streamingEnabled);
    return streamingEnabled;
}

/**
 * Subscribe to streaming state changes
 * @returns Unsubscribe function
 */
export function subscribeToStreaming(listener: StreamingListener): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
}

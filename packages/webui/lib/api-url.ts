/**
 * Calculate the API URL at runtime based on the current frontend location.
 *
 * Convention: API server runs on frontend_port + 1
 * - Frontend on 3000 → API on 3001
 * - Frontend on 8080 → API on 8081
 */
export function getApiUrl(): string {
    if (typeof window === 'undefined') {
        // SSR fallback
        return 'http://localhost:3001';
    }

    const frontendPort = parseInt(window.location.port || '3000', 10);
    const apiPort = frontendPort + 1;
    const protocol = window.location.protocol === 'https:' ? 'https:' : 'http:';

    return `${protocol}//${window.location.hostname}:${apiPort}`;
}

/**
 * Calculate the WebSocket URL at runtime based on the current frontend location.
 */
export function getWsUrl(): string {
    if (typeof window === 'undefined') {
        // SSR fallback
        return 'ws://localhost:3001';
    }

    const frontendPort = parseInt(window.location.port || '3000', 10);
    const apiPort = frontendPort + 1;
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';

    return `${protocol}//${window.location.hostname}:${apiPort}`;
}

// Extend Window interface to include our injected global
declare global {
    interface Window {
        __DEXTO_API_PORT__?: string;
    }
}

/**
 * Calculate the API URL at runtime based on the current frontend location.
 *
 * Reads the API port from the injected __DEXTO_API_PORT__ global variable.
 * Falls back to convention: API server runs on frontend_port + 1
 * - Frontend on 3000 → API on 3001
 * - Frontend on 8080 → API on 8081
 */
export function getApiUrl(): string {
    if (typeof window === 'undefined') {
        // SSR fallback
        return 'http://localhost:3001';
    }

    // Use injected API port if available, otherwise fall back to frontend port + 1
    const frontendPort = parseInt(window.location.port || '3000', 10);
    const apiPort = window.__DEXTO_API_PORT__
        ? parseInt(window.__DEXTO_API_PORT__, 10)
        : frontendPort + 1;
    const protocol = window.location.protocol === 'https:' ? 'https:' : 'http:';

    return `${protocol}//${window.location.hostname}:${apiPort}`;
}

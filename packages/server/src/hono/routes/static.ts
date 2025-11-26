import { Hono } from 'hono';
import type { NotFoundHandler } from 'hono';
import { serveStatic } from '@hono/node-server/serve-static';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * Runtime configuration injected into WebUI via window globals.
 * This replaces the Next.js SSR injection that was lost in the Vite migration.
 */
export interface WebUIRuntimeConfig {
    analytics?: {
        distinctId: string;
        posthogKey: string;
        posthogHost: string;
        appVersion: string;
    } | null;
}

/**
 * Create a static file router for serving WebUI assets.
 *
 * Serves static files from the specified webRoot directory.
 * Note: SPA fallback is handled separately via createSpaFallbackHandler.
 *
 * @param webRoot - Absolute path to the directory containing WebUI build output
 */
export function createStaticRouter(webRoot: string) {
    const app = new Hono();

    // Serve static assets from /assets/
    app.use('/assets/*', serveStatic({ root: webRoot }));

    // Serve static files from /logos/
    app.use('/logos/*', serveStatic({ root: webRoot }));

    // Serve other static files (favicon, etc.)
    app.use('/favicon.ico', serveStatic({ root: webRoot }));

    return app;
}

/**
 * Build the injection script for runtime config.
 * Escapes values to prevent XSS and script injection.
 */
function buildInjectionScript(config: WebUIRuntimeConfig): string {
    const scripts: string[] = [];

    if (config.analytics) {
        // Escape < to prevent script injection via JSON values
        const safeJson = JSON.stringify(config.analytics).replace(/</g, '\\u003c');
        scripts.push(`window.__DEXTO_ANALYTICS__ = ${safeJson};`);
    }

    if (scripts.length === 0) return '';
    return `<script>${scripts.join('\n')}</script>`;
}

/**
 * Create a notFound handler for SPA fallback.
 *
 * This handler serves index.html for client-side routes (paths without file extensions).
 * For paths with file extensions (like /openapi.json), it returns a standard 404.
 *
 * This should be registered as app.notFound() to run after all routes fail to match.
 *
 * @param webRoot - Absolute path to the directory containing WebUI build output
 * @param runtimeConfig - Optional runtime configuration to inject into the HTML
 */
export function createSpaFallbackHandler(
    webRoot: string,
    runtimeConfig?: WebUIRuntimeConfig
): NotFoundHandler {
    // Pre-build the injection script once (not per-request)
    const injectionScript = runtimeConfig ? buildInjectionScript(runtimeConfig) : '';

    return async (c) => {
        const path = c.req.path;

        // If path ends with a file extension, it's a real 404 (not an SPA route)
        // This allows /openapi.json, /.well-known/agent-card.json etc. to 404 properly
        // Uses regex to avoid false positives like /session/2024.01.01
        if (/\.[a-zA-Z0-9]+$/.test(path)) {
            return c.json({ error: 'Not Found', path }, 404);
        }

        // SPA fallback - serve index.html for client-side routes
        try {
            let html = await readFile(join(webRoot, 'index.html'), 'utf-8');

            // Inject runtime config into <head> if provided
            if (injectionScript) {
                html = html.replace('</head>', `${injectionScript}</head>`);
            }

            return c.html(html);
        } catch {
            // index.html not found - WebUI not available
            return c.html(
                `<!DOCTYPE html>
<html>
<head><title>Dexto API Server</title></head>
<body>
<h1>Dexto API Server</h1>
<p>WebUI is not available. API endpoints are accessible at <code>/api/*</code></p>
</body>
</html>`,
                200
            );
        }
    };
}

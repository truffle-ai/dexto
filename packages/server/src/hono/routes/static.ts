import { Hono } from 'hono';
import type { NotFoundHandler } from 'hono';
import { serveStatic } from '@hono/node-server/serve-static';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

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
 * Create a notFound handler for SPA fallback.
 *
 * This handler serves index.html for client-side routes (paths without file extensions).
 * For paths with file extensions (like /openapi.json), it returns a standard 404.
 *
 * This should be registered as app.notFound() to run after all routes fail to match.
 *
 * @param webRoot - Absolute path to the directory containing WebUI build output
 */
export function createSpaFallbackHandler(webRoot: string): NotFoundHandler {
    return async (c) => {
        const path = c.req.path;

        // If path has a file extension, it's a real 404 (not an SPA route)
        // This allows /openapi.json, /.well-known/agent-card.json etc. to 404 properly
        if (path.includes('.')) {
            return c.json({ error: 'Not Found', path }, 404);
        }

        // SPA fallback - serve index.html for client-side routes
        try {
            const html = await readFile(join(webRoot, 'index.html'), 'utf-8');
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

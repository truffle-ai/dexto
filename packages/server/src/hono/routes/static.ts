import { Hono } from 'hono';
import { serveStatic } from '@hono/node-server/serve-static';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * Create a static file router for serving WebUI assets.
 *
 * Serves static files from the specified webRoot directory and provides
 * SPA fallback (serves index.html for all non-API routes).
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

    // SPA fallback - serve index.html for all non-API routes
    app.get('*', async (c) => {
        // Skip API routes - let them 404 naturally
        const path = c.req.path;
        if (path.startsWith('/api') || path.startsWith('/health') || path.startsWith('/openapi')) {
            return c.notFound();
        }

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
    });

    return app;
}

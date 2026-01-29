import { createServer } from 'node:http';
import { URL } from 'node:url';
import { ensurePortAvailable } from './oauth-utils.js';

export async function createMcpCallbackServer(redirectUrl: string): Promise<string> {
    const parsed = new URL(redirectUrl);
    const port = Number(parsed.port || 80);
    if (!Number.isFinite(port) || port <= 0) {
        throw new Error(`Invalid redirect port: ${parsed.port}`);
    }
    await ensurePortAvailable(port);

    return new Promise((resolve, reject) => {
        const server = createServer((req, res) => {
            if (!req.url) {
                res.writeHead(400);
                res.end('Bad Request');
                return;
            }

            const requestUrl = new URL(req.url, redirectUrl);
            const code = requestUrl.searchParams.get('code');
            const error = requestUrl.searchParams.get('error');
            const errorDescription = requestUrl.searchParams.get('error_description');

            if (code) {
                res.writeHead(200, { 'Content-Type': 'text/html' });
                res.end(`
                    <html>
                      <body>
                        <h1>Authorization Successful</h1>
                        <p>You can close this window and return to your terminal.</p>
                      </body>
                    </html>
                `);
                resolve(code);
                setTimeout(() => server.close(), 3000);
                return;
            }

            if (error) {
                res.writeHead(400, { 'Content-Type': 'text/html' });
                res.end(`
                    <html>
                      <body>
                        <h1>Authorization Failed</h1>
                        <p>Error: ${error}</p>
                        ${errorDescription ? `<p>${errorDescription}</p>` : ''}
                      </body>
                    </html>
                `);
                reject(
                    new Error(
                        `OAuth authorization failed: ${error}${
                            errorDescription ? ` (${errorDescription})` : ''
                        }`
                    )
                );
                setTimeout(() => server.close(), 3000);
                return;
            }

            res.writeHead(400);
            res.end('Missing authorization code');
        });

        server.listen(port, () => {
            console.log(`🔐 Awaiting MCP OAuth callback on ${redirectUrl}`);
        });
    });
}

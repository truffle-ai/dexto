// packages/cli/src/cli/utils/oauth-flow.ts

import * as http from 'http';
import * as crypto from 'crypto';
import * as url from 'url';
import * as querystring from 'querystring';
import chalk from 'chalk';
import * as p from '@clack/prompts';
import { logger } from '@dexto/core';

interface OAuthConfig {
    authUrl: string; // e.g. "https://project.supabase.co"
    clientId: string; // Supabase anon key
    provider?: string; // OAuth provider: 'google', 'github', 'discord', etc.
    scopes?: string[]; // OAuth scopes
}

interface OAuthResult {
    accessToken: string;
    refreshToken?: string | undefined;
    expiresIn?: number | undefined;
    user?:
        | {
              id: string;
              email: string;
              name?: string | undefined;
          }
        | undefined;
}

/**
 * Find available port for local callback server
 */
function findAvailablePort(): Promise<number> {
    return new Promise((resolve, reject) => {
        const server = http.createServer();
        server.listen(0, () => {
            const address = server.address();
            const port = typeof address === 'object' && address ? address.port : 0;
            server.close(() => resolve(port));
        });
        server.on('error', reject);
    });
}

/**
 * Start local HTTP server to receive OAuth callback
 */
function startCallbackServer(port: number, config: OAuthConfig): Promise<OAuthResult> {
    return new Promise((resolve, reject) => {
        const server = http.createServer(async (req, res) => {
            try {
                if (!req.url) {
                    res.writeHead(400);
                    res.end('Bad Request');
                    return;
                }

                const parsedUrl = url.parse(req.url, true);

                if (req.method === 'GET') {
                    // Serve callback page that handles Supabase OAuth redirect
                    res.writeHead(200, { 'Content-Type': 'text/html' });
                    res.end(`
                        <html>
                        <head>
                            <style>
                                body { font-family: -apple-system, BlinkMacSystemFont, sans-serif; text-align: center; padding: 50px; background: #f5f5f5; }
                                .container { background: white; padding: 40px; border-radius: 8px; box-shadow: 0 2px 8px rgba(0,0,0,0.1); max-width: 400px; margin: 0 auto; }
                                .spinner { font-size: 48px; }
                                h1 { margin: 20px 0; }
                                p { color: #6b7280; }
                            </style>
                        </head>
                        <body>
                            <div class="container">
                                <div class="spinner">⏳</div>
                                <h1>Processing Authentication...</h1>
                                <p>Please wait while we complete your login.</p>
                            </div>
                            
                            <script>
                            // Handle Supabase OAuth callback (fragment-based)
                            const hashParams = new URLSearchParams(window.location.hash.substring(1));
                            const urlParams = new URLSearchParams(window.location.search);
                            
                            const accessToken = hashParams.get('access_token') || urlParams.get('access_token');
                            const refreshToken = hashParams.get('refresh_token') || urlParams.get('refresh_token');
                            const expiresIn = hashParams.get('expires_in') || urlParams.get('expires_in');
                            const error = hashParams.get('error') || urlParams.get('error');
                            
                            if (error) {
                                fetch('/callback', {
                                    method: 'POST',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify({ error: error })
                                }).then(() => {
                                    document.querySelector('.container').innerHTML = 
                                        '<div style="font-size: 48px; color: #ef4444;">❌</div><h1 style="color: #dc2626;">Authentication Failed</h1><p>You can close this window and try again.</p>';
                                });
                            } else if (accessToken) {
                                fetch('/callback', {
                                    method: 'POST',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify({ 
                                        access_token: accessToken,
                                        refresh_token: refreshToken,
                                        expires_in: expiresIn ? parseInt(expiresIn) : undefined
                                    })
                                }).then(() => {
                                    document.querySelector('.container').innerHTML = 
                                        '<div style="font-size: 48px; color: #22c55e;">✅</div><h1 style="color: #16a34a;">Login Successful!</h1><p>You can close this window and return to your terminal.</p>';
                                });
                            } else {
                                document.querySelector('.container').innerHTML = 
                                    '<div style="font-size: 48px; color: #ef4444;">❌</div><h1 style="color: #dc2626;">No Authentication Data</h1><p>Please try the login process again.</p>';
                            }
                            </script>
                        </body>
                        </html>
                    `);
                } else if (req.method === 'POST' && parsedUrl.pathname === '/callback') {
                    // Handle POST callback from the JavaScript
                    let body = '';
                    req.on('data', (chunk) => {
                        body += chunk.toString();
                    });

                    req.on('end', async () => {
                        try {
                            const data = JSON.parse(body);

                            if (data.error) {
                                res.writeHead(200);
                                res.end('OK');
                                server.close();
                                reject(new Error(`OAuth error: ${data.error}`));
                                return;
                            }

                            if (data.access_token) {
                                // Get user info from access token
                                const userResponse = await fetch(`${config.authUrl}/auth/v1/user`, {
                                    headers: {
                                        Authorization: `Bearer ${data.access_token}`,
                                        apikey: config.clientId,
                                    },
                                });

                                const userData = userResponse.ok ? await userResponse.json() : null;

                                const result: OAuthResult = {
                                    accessToken: data.access_token,
                                    refreshToken: data.refresh_token,
                                    expiresIn: data.expires_in,
                                    user: userData
                                        ? {
                                              id: userData.id,
                                              email: userData.email,
                                              name:
                                                  userData.user_metadata?.full_name ||
                                                  userData.email,
                                          }
                                        : undefined,
                                };

                                res.writeHead(200);
                                res.end('OK');
                                server.close();
                                resolve(result);
                            } else {
                                res.writeHead(400);
                                res.end('Missing tokens');
                                server.close();
                                reject(new Error('No access token received'));
                            }
                        } catch (err) {
                            res.writeHead(400);
                            res.end('Invalid data');
                            server.close();
                            reject(new Error('Invalid callback data'));
                        }
                    });
                } else {
                    res.writeHead(404);
                    res.end('Not Found');
                }
            } catch (error) {
                logger.error(`Callback server error: ${error}`);
                res.writeHead(500);
                res.end('Internal Server Error');
                server.close();
                reject(error);
            }
        });

        server.listen(port, 'localhost', () => {
            logger.debug(`OAuth callback server listening on http://localhost:${port}`);
        });

        server.on('error', (error) => {
            reject(new Error(`Failed to start callback server: ${error.message}`));
        });

        // Timeout after 5 minutes
        setTimeout(
            () => {
                server.close();
                reject(new Error('Authentication timed out'));
            },
            5 * 60 * 1000
        );
    });
}

/**
 * Perform OAuth login flow with Supabase
 */
export async function performOAuthLogin(config: OAuthConfig): Promise<OAuthResult> {
    try {
        // Find available port
        const port = await findAvailablePort();
        const redirectUri = `http://localhost:${port}`;

        // Build Supabase authorization URL
        const authParams = querystring.stringify({
            provider: config.provider || 'google',
            redirect_to: redirectUri,
        });

        const authUrl = `${config.authUrl}/auth/v1/authorize?${authParams}`;

        // Start callback server
        const tokenPromise = startCallbackServer(port, config);

        // Open browser
        console.log(chalk.cyan('🌐 Opening browser for authentication...'));

        try {
            const { default: open } = await import('open');
            await open(authUrl);
            console.log(chalk.green('✅ Browser opened'));
        } catch (error) {
            console.log(chalk.yellow(`💡 Please open manually: ${authUrl}`));
        }

        // Show spinner while waiting
        const spinner = p.spinner();
        spinner.start('Waiting for authentication...');

        try {
            const result = await tokenPromise;
            spinner.stop('Authentication successful!');
            return result;
        } catch (error) {
            spinner.stop('Authentication failed');
            throw error;
        }
    } catch (error) {
        throw new Error(
            `OAuth login failed: ${error instanceof Error ? error.message : String(error)}`
        );
    }
}

/**
 * Default Supabase OAuth config
 */
export const DEFAULT_OAUTH_CONFIG: OAuthConfig = {
    authUrl: process.env.SUPABASE_URL || 'https://your-project.supabase.co',
    clientId: process.env.SUPABASE_ANON_KEY || 'your-supabase-anon-key',
    provider: 'google', // Can be 'google', 'github', 'discord', etc.
    scopes: ['openid', 'email', 'profile'],
};

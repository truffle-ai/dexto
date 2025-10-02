// packages/cli/src/cli/utils/oauth-flow.ts

import * as http from 'http';
// OAuth flow implementation
import * as url from 'url';
import * as querystring from 'querystring';
import chalk from 'chalk';
import * as p from '@clack/prompts';
import { logger } from '@dexto/core';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './constants.js';

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
                            <title>Dexto Authentication</title>
                            <meta name="viewport" content="width=device-width, initial-scale=1.0">
                            <link href="https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600;700&display=swap" rel="stylesheet">
                            <style>
                                * {
                                    margin: 0;
                                    padding: 0;
                                    box-sizing: border-box;
                                }
                                
                                body {
                                    font-family: 'Geist', -apple-system, BlinkMacSystemFont, sans-serif;
                                    background: linear-gradient(135deg, #0f0f0f 0%, #1a1a1a 100%);
                                    color: #fafafa;
                                    min-height: 100vh;
                                    display: flex;
                                    align-items: center;
                                    justify-content: center;
                                    padding: 20px;
                                }
                                
                                .container {
                                    background: #141414;
                                    border: 1px solid #262626;
                                    padding: 48px;
                                    border-radius: 12px;
                                    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
                                    max-width: 450px;
                                    width: 100%;
                                    text-align: center;
                                }
                                
                                .logo {
                                    width: 64px;
                                    height: 64px;
                                    background: linear-gradient(135deg, #3b82f6 0%, #8b5cf6 100%);
                                    border-radius: 12px;
                                    margin: 0 auto 24px;
                                    display: flex;
                                    align-items: center;
                                    justify-content: center;
                                    font-weight: 700;
                                    font-size: 24px;
                                    color: white;
                                    box-shadow: 0 4px 16px rgba(59, 130, 246, 0.3);
                                }
                                
                                .spinner {
                                    font-size: 48px;
                                    margin-bottom: 24px;
                                    animation: pulse 2s infinite;
                                }
                                
                                @keyframes pulse {
                                    0%, 100% { opacity: 1; }
                                    50% { opacity: 0.6; }
                                }
                                
                                h1 {
                                    font-size: 24px;
                                    font-weight: 600;
                                    margin-bottom: 12px;
                                    color: #fafafa;
                                }
                                
                                p {
                                    color: #a1a1aa;
                                    font-size: 16px;
                                    line-height: 1.5;
                                }
                                
                                .success-icon {
                                    color: #22c55e;
                                    font-size: 64px;
                                    margin-bottom: 24px;
                                }
                                
                                .error-icon {
                                    color: #dc2626;
                                    font-size: 64px;
                                    margin-bottom: 24px;
                                }
                                
                                .success-title {
                                    color: #22c55e;
                                }
                                
                                .error-title {
                                    color: #dc2626;
                                }
                                
                                @media (max-width: 640px) {
                                    .container {
                                        padding: 32px 24px;
                                    }
                                    h1 {
                                        font-size: 20px;
                                    }
                                    .spinner, .success-icon, .error-icon {
                                        font-size: 48px;
                                    }
                                }
                            </style>
                        </head>
                        <body>
                            <div class="container">
                                <div class="logo">D</div>
                                <div class="spinner">◐</div>
                                <h1>Processing Authentication...</h1>
                                <p>Please wait while we complete your Dexto login.</p>
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
                                        '<div class="logo">D</div><div class="error-icon">✕</div><h1 class="error-title">Authentication Failed</h1><p>You can close this window and try again in your terminal.</p>';
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
                                        '<div class="logo">D</div><div class="success-icon">✓</div><h1 class="success-title">Login Successful!</h1><p>Welcome to Dexto! You can close this window and return to your terminal.</p>';
                                });
                            } else {
                                document.querySelector('.container').innerHTML = 
                                    '<div class="logo">D</div><div class="error-icon">✕</div><h1 class="error-title">No Authentication Data</h1><p>Please try the login process again in your terminal.</p>';
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
                        } catch (_err) {
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
        const provider = config.provider || 'google';
        const authParams = querystring.stringify({
            redirect_to: redirectUri,
        });

        const authUrl = `${config.authUrl}/auth/v1/authorize?provider=${provider}&${authParams}`;

        // Start callback server
        const tokenPromise = startCallbackServer(port, config);

        // Open browser
        console.log(chalk.cyan('🌐 Opening browser for authentication...'));

        try {
            const { default: open } = await import('open');
            await open(authUrl);
            console.log(chalk.green('✅ Browser opened'));
        } catch (_error) {
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
    } catch (_error) {
        throw new Error(
            `OAuth login failed: ${_error instanceof Error ? _error.message : String(_error)}`
        );
    }
}

/**
 * Default Supabase OAuth configuration for Dexto CLI
 */
export const DEFAULT_OAUTH_CONFIG: OAuthConfig = {
    authUrl: SUPABASE_URL,
    clientId: SUPABASE_ANON_KEY,
    provider: 'google',
    scopes: ['openid', 'email', 'profile'],
};

/** File for all web server starting up code */
import { noOpLogger } from '@dexto/core';
import { spawn } from 'child_process';
import { existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

/**
 * Discovers the webui path and starts the standalone Next.js server
 * @param apiUrl - The URL of the API server
 * @param frontPort - The port to run the web server on
 * @param frontUrl - The URL of the web server
 */
export async function startNextJsWebServer(
    apiUrl: string,
    frontPort: number = 3000,
    frontUrl: string = `http://localhost:${frontPort}`
): Promise<boolean> {
    // Path discovery logic for the built webui
    const scriptDir = path.dirname(fileURLToPath(import.meta.url));
    noOpLogger.debug(`Script directory for web mode: ${scriptDir}`);

    // Look for embedded webui in CLI's dist folder
    const webuiPath = path.resolve(scriptDir, 'webui');

    if (!existsSync(webuiPath)) {
        console.warn('WebUI not found in this build.');
        console.info('For production: Run "pnpm build:all" to embed the WebUI');
        console.info('For development with hot reload:');
        console.info('  1. Run: pnpm run dev to build core, and set hot reload for web UI');
        return false;
    }

    noOpLogger.debug(`Found embedded webui at: ${webuiPath}`);

    // Check if we have a built standalone app
    const serverScriptPath = path.join(webuiPath, 'server.js');
    const standaloneRoot = path.join(webuiPath, '.next', 'standalone');

    // Next.js standalone entry can live in different places depending on app subpath/version (legacy src/app/webui or new packages/webui)
    const standaloneCandidates = [
        path.join(standaloneRoot, 'server.js'),
        // When app lives under packages/webui or earlier under packages/cli/src/webui
        path.join(standaloneRoot, 'webui', 'server.js'),
        path.join(standaloneRoot, 'cli', 'src', 'webui', 'server.js'),
        path.join(standaloneRoot, 'packages', 'webui', 'server.js'),
    ];

    const resolvedStandalone = standaloneCandidates.find((p) => existsSync(p));

    if (!resolvedStandalone && !existsSync(serverScriptPath)) {
        noOpLogger.warn(
            'Built WebUI not found. This may indicate the package was not built correctly.',
            null,
            'yellow'
        );
        noOpLogger.error(
            'Please ensure the package was built with "npm run build" which includes building the WebUI.'
        );
        return false;
    }

    try {
        // Extract API port from API URL
        const apiPort = (() => {
            try {
                return String(new URL(apiUrl).port || 3001);
            } catch {
                return '3001';
            }
        })();

        noOpLogger.info(`Starting Next.js production server on ${frontUrl}`, null, 'cyanBright');

        // Use the server.js script if it exists, otherwise use the resolved standalone server directly
        const serverToUse = existsSync(serverScriptPath)
            ? serverScriptPath
            : (resolvedStandalone as string);

        // Allow HOSTNAME/PORT overrides; default to CLI-provided frontPort
        const resolvedHostname = process.env.HOSTNAME ?? '0.0.0.0';
        const resolvedPort = process.env.FRONTEND_PORT ?? process.env.PORT ?? String(frontPort);

        // WebSocket URL uses root path for both Express and Hono
        const defaultWsUrl = `ws://localhost:${apiPort}/`;
        noOpLogger.info(`Using WS URL: ${defaultWsUrl}`);

        // TODO: env variables set here are actually not used by client side code in next-js apps
        // because process.env.NEXT_PUBLIC_WS_URL is set at build time for client side components, not at runtime
        // we might need a better solution to configure these variables, or update the client side code to fetch this from server side code (which can read these runtime provided env variables)
        const nextProc = spawn('node', [serverToUse], {
            cwd: webuiPath,
            stdio: ['inherit', 'pipe', 'inherit'],
            env: {
                ...process.env,
                NODE_ENV: 'production',
                HOSTNAME: resolvedHostname,
                PORT: String(resolvedPort),
                API_PORT: String(apiPort),
                API_URL: apiUrl,
                FRONTEND_URL: frontUrl,
                NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL ?? apiUrl,
                NEXT_PUBLIC_WS_URL: process.env.NEXT_PUBLIC_WS_URL ?? defaultWsUrl,
                NEXT_PUBLIC_FRONTEND_URL: process.env.NEXT_PUBLIC_FRONTEND_URL ?? frontUrl,
            },
        });

        // Wait for server to start or error out
        noOpLogger.debug(
            `Waiting for Next.js production server to start at: ${frontUrl}`,
            null,
            'cyan'
        );

        const success = await new Promise<boolean>((resolve) => {
            // Set a reasonable timeout (15 seconds)
            const timer = setTimeout(() => {
                noOpLogger.info(`Next.js server startup timeout reached, assuming it's running`);
                noOpLogger.info(`Next.js web UI available at: ${frontUrl}`, null, 'green');
                resolve(true);
            }, 15000);

            // Handle error event
            nextProc.once('error', (err) => {
                noOpLogger.error(`Next.js production server failed to start: ${err}`);
                noOpLogger.warn('Only API endpoints are available. Web UI could not be started.');
                clearTimeout(timer);
                resolve(false);
            });

            // Handle exit event
            nextProc.once('exit', (code) => {
                if (code !== 0) {
                    noOpLogger.error(
                        `Next.js production server exited with code ${code}`,
                        null,
                        'red'
                    );
                    noOpLogger.warn(
                        'Only API endpoints are available. Web UI could not be started.'
                    );
                } else {
                    noOpLogger.info(`Next.js production server exited normally`);
                }
                clearTimeout(timer);
                resolve(false);
            });

            // Check stdout for server ready message
            if (nextProc.stdout) {
                nextProc.stdout.on('data', (data) => {
                    const output = data.toString();
                    // Echo output to console for debugging
                    process.stdout.write(data);

                    // Look for standard Next.js server startup messages
                    if (
                        output.includes('Ready') ||
                        output.includes('started server') ||
                        output.includes('Local:')
                    ) {
                        noOpLogger.info(`Next.js production server started successfully`);
                        noOpLogger.info(`Next.js web UI available at: ${frontUrl}`, null, 'green');
                        clearTimeout(timer);
                        resolve(true);
                    }
                });
            }
        });

        return success;
    } catch (err) {
        noOpLogger.error(`Failed to spawn Next.js production server: ${err}`);
        noOpLogger.warn('Only API endpoints are available. Web UI could not be started.');
        return false;
    }
}

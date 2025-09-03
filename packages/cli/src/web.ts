/** File for all web server starting up code */
import { logger } from '@dexto/core';
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
    logger.debug(`Script directory for web mode: ${scriptDir}`);

    // Look for embedded webui in CLI's dist folder
    const webuiPath = path.resolve(scriptDir, 'webui');

    if (!existsSync(webuiPath)) {
        logger.warn('WebUI not found in this build.');
        logger.info('For production: Run "pnpm build:all" to embed the WebUI');
        logger.info('For development with hot reload:');
        logger.info('  1. Run: dexto --mode server (API on port 3001)');
        logger.info('  2. In webui folder, run: npm run dev (UI on port 3000)');
        return false;
    }

    logger.debug(`Found embedded webui at: ${webuiPath}`);

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
        logger.warn(
            'Built WebUI not found. This may indicate the package was not built correctly.',
            null,
            'yellow'
        );
        logger.error(
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

        logger.info(`Starting Next.js production server on ${frontUrl}`, null, 'cyanBright');

        // Use the server.js script if it exists, otherwise use the resolved standalone server directly
        const serverToUse = existsSync(serverScriptPath)
            ? serverScriptPath
            : (resolvedStandalone as string);

        // Allow HOSTNAME/PORT overrides; default to CLI-provided frontPort
        const resolvedHostname = process.env.HOSTNAME ?? '0.0.0.0';
        const resolvedPort = process.env.FRONTEND_PORT ?? process.env.PORT ?? String(frontPort);

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
                NEXT_PUBLIC_WS_URL: process.env.NEXT_PUBLIC_WS_URL ?? `ws://localhost:${apiPort}`,
                NEXT_PUBLIC_FRONTEND_URL: process.env.NEXT_PUBLIC_FRONTEND_URL ?? frontUrl,
            },
        });

        // Wait for server to start or error out
        logger.debug(
            `Waiting for Next.js production server to start at: ${frontUrl}`,
            null,
            'cyan'
        );

        const success = await new Promise<boolean>((resolve) => {
            // Set a reasonable timeout (15 seconds)
            const timer = setTimeout(() => {
                logger.info(`Next.js server startup timeout reached, assuming it's running`);
                logger.info(`Next.js web UI available at: ${frontUrl}`, null, 'green');
                resolve(true);
            }, 15000);

            // Handle error event
            nextProc.once('error', (err) => {
                logger.error(`Next.js production server failed to start: ${err}`);
                logger.warn('Only API endpoints are available. Web UI could not be started.');
                clearTimeout(timer);
                resolve(false);
            });

            // Handle exit event
            nextProc.once('exit', (code) => {
                if (code !== 0) {
                    logger.error(`Next.js production server exited with code ${code}`, null, 'red');
                    logger.warn('Only API endpoints are available. Web UI could not be started.');
                } else {
                    logger.info(`Next.js production server exited normally`);
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
                        logger.info(`Next.js production server started successfully`);
                        logger.info(`Next.js web UI available at: ${frontUrl}`, null, 'green');
                        clearTimeout(timer);
                        resolve(true);
                    }
                });
            }
        });

        return success;
    } catch (err) {
        logger.error(`Failed to spawn Next.js production server: ${err}`);
        logger.warn('Only API endpoints are available. Web UI could not be started.');
        return false;
    }
}

/**
 * Fallback function for development mode when source files are available
 */
async function startDevServer(
    apiUrl: string,
    frontPort: number,
    frontUrl: string,
    webuiPath: string
): Promise<boolean> {
    logger.info('Development mode detected, starting dev server...', null, 'yellow');

    try {
        // Extract API port from API URL
        const apiPort = (() => {
            try {
                return String(new URL(apiUrl).port || 3001);
            } catch {
                return '3001';
            }
        })();

        // Check if node_modules exists
        const nodeModulesPath = path.join(webuiPath, 'node_modules');
        const needsInstall = !existsSync(nodeModulesPath);

        if (needsInstall) {
            logger.info('Installing Next.js dependencies...', null, 'cyanBright');
            const installProc = spawn('npm', ['install'], {
                cwd: webuiPath,
                stdio: 'inherit',
            });

            const installSuccess = await new Promise<boolean>((resolve) => {
                installProc.on('error', () => resolve(false));
                installProc.on('exit', (code) => resolve(code === 0));
            });

            if (!installSuccess) {
                logger.error('Failed to install dependencies');
                return false;
            }
        }

        logger.info(`Starting Next.js dev server on ${frontUrl}`, null, 'cyanBright');

        const nextProc = spawn('npm', ['run', 'dev', '--', '--port', String(frontPort)], {
            cwd: webuiPath,
            stdio: ['inherit', 'pipe', 'inherit'],
            env: {
                ...process.env,
                NODE_ENV: 'development',
                API_PORT: String(apiPort),
                API_URL: apiUrl,
                FRONTEND_URL: frontUrl,
                NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL ?? apiUrl,
                NEXT_PUBLIC_WS_URL: process.env.NEXT_PUBLIC_WS_URL ?? `ws://localhost:${apiPort}`,
                NEXT_PUBLIC_FRONTEND_URL: process.env.NEXT_PUBLIC_FRONTEND_URL ?? frontUrl,
            },
        });

        const success = await new Promise<boolean>((resolve) => {
            const timer = setTimeout(() => {
                logger.info(`Dev server startup timeout reached, assuming it's running`);
                logger.info(`Next.js web UI available at: ${frontUrl}`, null, 'green');
                resolve(true);
            }, 30000);

            nextProc.once('error', (err) => {
                logger.error(`Next.js dev server failed to start: ${err}`);
                clearTimeout(timer);
                resolve(false);
            });

            nextProc.once('exit', (code) => {
                if (code !== 0) {
                    logger.error(`Next.js dev server exited with code ${code}`);
                }
                clearTimeout(timer);
                resolve(false);
            });

            if (nextProc.stdout) {
                nextProc.stdout.on('data', (data) => {
                    const output = data.toString();
                    process.stdout.write(data);

                    if (output.includes('Ready in') || output.includes('ready started server')) {
                        logger.info(`Next.js dev server started successfully`);
                        logger.info(`Next.js web UI available at: ${frontUrl}`, null, 'green');
                        clearTimeout(timer);
                        resolve(true);
                    }
                });
            }
        });

        return success;
    } catch (err) {
        logger.error(`Failed to start dev server: ${err}`);
        return false;
    }
}

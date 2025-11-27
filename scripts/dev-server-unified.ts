#!/usr/bin/env tsx

/**
 * Unified development server - single port for API + WebUI with HMR.
 *
 * Architecture:
 * - Vite serves as the main server (handles WebUI with HMR)
 * - CLI runs in server mode on an internal port (not exposed)
 * - Vite proxies /api/* to the internal CLI server
 *
 * From the user's perspective, everything is on one port.
 *
 * Usage:
 *   pnpm dev:unified                                    # Port 3000
 *   pnpm dev:unified -- --agent agents/coding-agent/coding-agent.yml
 *   pnpm dev:unified -- --port 6767
 *   pnpm dev:unified -- --agent my-agent.yml --port 6767
 */

import { execSync, spawn, ChildProcess } from 'child_process';
import { join } from 'path';
import open from 'open';

const rootDir = process.cwd();
const cliPath = join(rootDir, 'packages/cli/dist/index.js');

let apiProcess: ChildProcess | null = null;
let viteProcess: ChildProcess | null = null;

// Parse command-line arguments
const args = process.argv.slice(2);
const agentIndex = args.indexOf('--agent');
const agentPath = agentIndex !== -1 && agentIndex + 1 < args.length ? args[agentIndex + 1] : null;
const portIndex = args.indexOf('--port');
const userPort = portIndex !== -1 && portIndex + 1 < args.length ? args[portIndex + 1] : '3000';

// Internal API port (hidden from user) - use a high port to avoid conflicts
const internalApiPort = String(parseInt(userPort, 10) + 10000);

function cleanup() {
    console.log('\n🛑 Shutting down...');
    if (apiProcess) apiProcess.kill('SIGTERM');
    if (viteProcess) viteProcess.kill('SIGTERM');
    process.exit(0);
}

process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);

console.log('🔨 Building packages...\n');

try {
    execSync('pnpm run build:packages', {
        stdio: 'inherit',
        cwd: rootDir,
    });
    console.log('✅ Build complete!\n');
} catch (err) {
    console.error('❌ Build failed:', err);
    process.exit(1);
}

console.log('🚀 Starting unified development server...\n');

// Start API server on internal port
const cliArgs = [cliPath, '--mode', 'server', '--port', internalApiPort];
if (agentPath) {
    cliArgs.push('--agent', agentPath);
}

console.log(`📡 Starting API server (internal port ${internalApiPort})...`);

apiProcess = spawn('node', cliArgs, {
    stdio: ['inherit', 'pipe', 'pipe'],
    cwd: rootDir,
    env: {
        ...process.env,
        PORT: internalApiPort,
        DEXTO_DEV_MODE: 'true',
    },
});

let apiReady = false;
let browserOpened = false;

// Monitor API output
if (apiProcess.stdout) {
    apiProcess.stdout.on('data', (data) => {
        const text = data.toString();
        // Only show important API logs, prefix with [API]
        if (text.includes('Server running') || text.includes('ERROR') || text.includes('WARN')) {
            process.stdout.write(`[API] ${text}`);
        }

        // Start Vite when API is ready
        if (!apiReady && text.includes('Server running at')) {
            apiReady = true;
            startVite();
        }
    });
}

if (apiProcess.stderr) {
    apiProcess.stderr.on('data', (data) => {
        process.stderr.write(`[API] ${data}`);
    });
}

apiProcess.on('error', (err) => {
    console.error('❌ Failed to start API server:', err);
    cleanup();
});

function startVite() {
    console.log(
        `\n🎨 Starting WebUI (port ${userPort}, proxying API to internal:${internalApiPort})...`
    );

    // Run Vite with the user's port
    viteProcess = spawn('pnpm', ['exec', 'vite', '--port', userPort], {
        cwd: join(rootDir, 'packages', 'webui'),
        stdio: ['inherit', 'pipe', 'pipe'],
        env: {
            ...process.env,
            DEXTO_API_PORT: internalApiPort,
        },
    });

    if (viteProcess.stdout) {
        viteProcess.stdout.on('data', (data) => {
            const lines = data.toString().split('\n').filter(Boolean);
            lines.forEach((line: string) => {
                // Don't prefix Vite output - it's the main server
                console.log(line);

                // Open browser when Vite is ready
                if (!browserOpened && line.includes('Local:')) {
                    browserOpened = true;
                    const urlMatch = line.match(/http:\/\/localhost:\d+/);
                    const url = urlMatch ? urlMatch[0] : `http://localhost:${userPort}`;

                    console.log('\n✨ Unified development server ready!');
                    console.log(`   URL: ${url}`);
                    if (agentPath) {
                        console.log(`   Agent: ${agentPath}`);
                    }
                    console.log('\n   • Single port for API + WebUI');
                    console.log('   • Hot Module Replacement enabled');
                    console.log('\nPress Ctrl+C to stop\n');

                    open(url, { wait: false }).catch(() => {
                        console.log(`   Open ${url} in your browser`);
                    });
                }
            });
        });
    }

    if (viteProcess.stderr) {
        viteProcess.stderr.on('data', (data) => {
            process.stderr.write(data);
        });
    }

    viteProcess.on('error', (err) => {
        console.error('❌ Failed to start Vite:', err);
        cleanup();
    });
}

// Fallback: Start Vite after 30 seconds if API ready signal not detected
setTimeout(() => {
    if (!apiReady) {
        console.log('\n⚠️  API ready signal not detected after 30s, starting Vite anyway...');
        apiReady = true;
        startVite();
    }
}, 30000);

#!/usr/bin/env tsx

/**
 * Development server that:
 * 1. Builds all packages (turbo handles dependency graph)
 * 2. Runs the CLI directly from dist/index.js in server mode (API on port 3001 by default)
 * 3. Starts Vite dev server for WebUI with hot reload (port 3000)
 * 4. Opens browser automatically when WebUI is ready
 *
 * Vite proxies /api/* requests to the API server (configured in vite.config.ts)
 *
 * Usage:
 *   pnpm dev                                    # Use default agent on port 3001
 *   pnpm dev -- --agent examples/resources-demo-server/agent.yml
 *   pnpm dev -- --port 6767                     # Custom API port
 *   pnpm dev -- --agent my-agent.yml --port 6767
 */

import { execSync, spawn, ChildProcess } from 'child_process';
import { join } from 'path';
import open from 'open';

const rootDir = process.cwd();
const cliPath = join(rootDir, 'packages/cli/dist/index.js');

let apiProcess: ChildProcess | null = null;
let webuiProcess: ChildProcess | null = null;
let browserOpened = false;
let webuiStarted = false;

// Parse command-line arguments
const args = process.argv.slice(2);
const agentIndex = args.indexOf('--agent');
const agentPath = agentIndex !== -1 && agentIndex + 1 < args.length ? args[agentIndex + 1] : null;
const portIndex = args.indexOf('--port');
const rawPort = portIndex !== -1 && portIndex + 1 < args.length ? args[portIndex + 1] : undefined;
const apiPort = rawPort && rawPort.trim() !== '' ? rawPort : '3001';
const apiPortNum = parseInt(apiPort, 10);
if (isNaN(apiPortNum)) {
    console.error(`❌ Invalid port: ${apiPort}`);
    process.exit(1);
}
// WebUI port is API port - 1 (so API 3001 → WebUI 3000, API 6767 → WebUI 6766)
const webuiPort = String(apiPortNum - 1);

// Cleanup function
function cleanup() {
    console.log('\n🛑 Shutting down servers...');
    if (apiProcess) {
        apiProcess.kill('SIGTERM');
    }
    if (webuiProcess) {
        webuiProcess.kill('SIGTERM');
    }
    process.exit(0);
}

// Handle exit signals
process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);

console.log('🔨 Building packages...\n');

try {
    // Build all packages (turbo handles dependency graph)
    // This ensures webui dependencies like client-sdk are built
    execSync('pnpm run build:packages', {
        stdio: 'inherit',
        cwd: rootDir,
    });
    console.log('✅ Build complete!\n');
} catch (err) {
    console.error('❌ Build failed:', err);
    process.exit(1);
}

console.log('🚀 Starting development servers...\n');

// Start API server directly from dist
const cliArgs = [cliPath, '--mode', 'server', '--port', apiPort];
if (agentPath) {
    console.log(`📡 Starting API server on port ${apiPort} with agent: ${agentPath}...`);
    cliArgs.push('--agent', agentPath);
} else {
    console.log(`📡 Starting API server on port ${apiPort}...`);
}

apiProcess = spawn('node', cliArgs, {
    stdio: ['inherit', 'pipe', 'pipe'],
    cwd: rootDir,
    env: {
        ...process.env,
        PORT: apiPort,
        DEXTO_DEV_MODE: 'true', // Force use of repo config for development
    },
});

// Function to start WebUI (called when API is ready)
function startWebUI() {
    if (webuiStarted) return;
    webuiStarted = true;

    console.log('\n🎨 Starting WebUI dev server...');

    webuiProcess = spawn('pnpm', ['exec', 'vite', '--port', webuiPort], {
        cwd: join(rootDir, 'packages', 'webui'),
        stdio: ['inherit', 'pipe', 'pipe'],
        env: {
            ...process.env,
            DEXTO_API_PORT: apiPort,
        },
    });

    // Prefix WebUI output and detect when ready
    if (webuiProcess.stdout) {
        webuiProcess.stdout.on('data', (data) => {
            const lines = data.toString().split('\n').filter(Boolean);
            lines.forEach((line: string) => {
                console.log(`[UI]  ${line}`);

                // Open browser when Vite is ready (looks for "Local:" message)
                if (!browserOpened && line.includes('Local:')) {
                    browserOpened = true;
                    // Extract URL from Vite output (e.g., "Local:   http://localhost:3001/")
                    const urlMatch = line.match(/http:\/\/localhost:\d+/);
                    const webUrl = urlMatch ? urlMatch[0] : `http://localhost:${webuiPort}`;
                    console.log(`\n🌐 Opening browser at ${webUrl}...`);
                    open(webUrl, { wait: false }).catch((err) => {
                        console.log(`   Could not open browser automatically: ${err.message}`);
                        console.log(`   Please open ${webUrl} manually`);
                    });
                }
            });
        });
    }

    if (webuiProcess.stderr) {
        webuiProcess.stderr.on('data', (data) => {
            const lines = data.toString().split('\n').filter(Boolean);
            lines.forEach((line: string) => {
                console.error(`[UI]  ${line}`);
            });
        });
    }

    webuiProcess.on('error', (err) => {
        console.error('❌ Failed to start WebUI dev server:', err);
        cleanup();
    });

    console.log('\n✨ Development servers ready!');
    console.log(`   API:   http://localhost:${apiPort} (from dist build)`);
    console.log('   WebUI: Starting... (see Vite output for URL)');
    console.log('\nPress Ctrl+C to stop all servers\n');
}

// Prefix API output
if (apiProcess.stdout) {
    apiProcess.stdout.on('data', (data) => {
        const lines = data.toString().split('\n').filter(Boolean);
        lines.forEach((line: string) => {
            console.log(`[API] ${line}`);

            // Start WebUI when API server is ready
            if (!webuiStarted && line.includes('Server running at')) {
                startWebUI();
            }
        });
    });
}

if (apiProcess.stderr) {
    apiProcess.stderr.on('data', (data) => {
        const lines = data.toString().split('\n').filter(Boolean);
        lines.forEach((line: string) => {
            console.error(`[API] ${line}`);
        });
    });
}

apiProcess.on('error', (err) => {
    console.error('❌ Failed to start API server:', err);
    cleanup();
});

// Fallback: Start WebUI after 60 seconds if API ready signal not detected
setTimeout(() => {
    if (!webuiStarted) {
        console.log('\n⚠️  API ready signal not detected after 60s, starting WebUI anyway...');
        startWebUI();
    }
}, 60000);

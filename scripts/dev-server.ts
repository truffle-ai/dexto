#!/usr/bin/env tsx

/**
 * Development server that:
 * 1. Builds all packages (turbo handles dependency graph)
 * 2. Runs the CLI directly from dist/index.js in server mode (API on port 3001)
 * 3. Starts Vite dev server for WebUI with hot reload (port 3000)
 * 4. Opens browser automatically when WebUI is ready
 *
 * Vite proxies /api/* requests to the API server (configured in vite.config.ts)
 *
 * Usage:
 *   pnpm dev                                    # Use default agent
 *   pnpm dev -- --agent examples/resources-demo-server/agent.yml
 */

import { execSync, spawn, ChildProcess } from 'child_process';
import { join } from 'path';
import open from 'open';

const rootDir = process.cwd();
const cliPath = join(rootDir, 'packages/cli/dist/index.js');

let apiProcess: ChildProcess | null = null;
let webuiProcess: ChildProcess | null = null;
let browserOpened = false;

// Parse command-line arguments
const args = process.argv.slice(2);
const agentIndex = args.indexOf('--agent');
const agentPath = agentIndex !== -1 && agentIndex + 1 < args.length ? args[agentIndex + 1] : null;

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
const cliArgs = [cliPath, '--mode', 'server'];
if (agentPath) {
    console.log(`📡 Starting API server on port 3001 with agent: ${agentPath}...`);
    cliArgs.push('--agent', agentPath);
} else {
    console.log('📡 Starting API server on port 3001...');
}

apiProcess = spawn('node', cliArgs, {
    stdio: ['inherit', 'pipe', 'pipe'],
    cwd: rootDir,
    env: {
        ...process.env,
        PORT: '3001',
        API_PORT: '3001',
        DEXTO_DEV_MODE: 'true', // Force use of repo config for development
    },
});

// Prefix API output
if (apiProcess.stdout) {
    apiProcess.stdout.on('data', (data) => {
        const lines = data.toString().split('\n').filter(Boolean);
        lines.forEach((line: string) => {
            console.log(`[API] ${line}`);
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

// Give API server time to start
setTimeout(() => {
    console.log('\n🎨 Starting WebUI dev server on port 3000...');

    webuiProcess = spawn('pnpm', ['run', 'dev'], {
        cwd: join(rootDir, 'packages', 'webui'),
        stdio: ['inherit', 'pipe', 'pipe'],
        env: {
            ...process.env,
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
                    const webUrl = 'http://localhost:3000';
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
    console.log('   API:   http://localhost:3001 (from dist build)');
    console.log('   WebUI: http://localhost:3000 (hot reload enabled)');
    console.log('\nPress Ctrl+C to stop all servers\n');
}, 2000); // Wait 2 seconds for API to initialize

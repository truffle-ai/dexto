#!/usr/bin/env tsx

/**
 * Development server that:
 * 1. Builds core and CLI
 * 2. Runs the CLI directly from dist/index.js in server mode
 * 3. Starts WebUI in dev mode with hot reload
 *
 * No symlinks needed - runs directly from built files!
 */

import { execSync, spawn, ChildProcess } from 'child_process';
import { join } from 'path';

const rootDir = process.cwd();
const cliPath = join(rootDir, 'packages/cli/dist/index.js');

let apiProcess: ChildProcess | null = null;
let webuiProcess: ChildProcess | null = null;

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

console.log('🔨 Building core and CLI packages...\n');

try {
    // Build core and CLI (not webui since we'll run it in dev mode)
    execSync('pnpm run build:cli-only', {
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
console.log('📡 Starting API server on port 3001...');
apiProcess = spawn('node', [cliPath, '--mode', 'server'], {
    stdio: ['inherit', 'pipe', 'pipe'],
    cwd: rootDir,
    env: {
        ...process.env,
        PORT: '3001',
        API_PORT: '3001',
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
            PORT: '3000',
            API_PORT: '3001',
            NEXT_PUBLIC_API_URL: 'http://localhost:3001',
            NEXT_PUBLIC_WS_URL: 'ws://localhost:3001',
            NEXT_PUBLIC_FRONTEND_URL: 'http://localhost:3000',
        },
    });

    // Prefix WebUI output
    if (webuiProcess.stdout) {
        webuiProcess.stdout.on('data', (data) => {
            const lines = data.toString().split('\n').filter(Boolean);
            lines.forEach((line: string) => {
                console.log(`[UI]  ${line}`);
            });
        });
    }

    if (webuiProcess.stderr) {
        webuiProcess.stderr.on('data', (data) => {
            const lines = data.toString().split('\n').filter(Boolean);
            lines.forEach((line: string) => {
                // Next.js writes some normal output to stderr, so use log instead of error
                console.log(`[UI]  ${line}`);
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

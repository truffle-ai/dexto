#!/usr/bin/env tsx

/**
 * Installs the dexto CLI globally using a local npm registry (verdaccio).
 * This mimics exactly what `npm install -g dexto` does when published to npm.
 *
 * Process:
 * 1. Start verdaccio (local npm registry) in background
 * 2. Publish all @dexto/* packages and dexto CLI to it
 * 3. Install dexto globally from local registry (npm resolves deps like production)
 * 4. Stop verdaccio and clean up
 *
 * This ensures peer dependencies resolve correctly through the dependency tree,
 * exactly as they would when users install from npm.
 */
import { execSync, spawn, ChildProcess } from 'child_process';
import { existsSync, rmSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';

const REGISTRY_URL = 'http://localhost:4873';
const VERDACCIO_CONFIG_DIR = join(process.cwd(), '.verdaccio');

// Packages in dependency order (dependencies first)
const PACKAGES = [
    { name: '@dexto/analytics', path: 'packages/analytics' },
    { name: '@dexto/core', path: 'packages/core' },
    { name: '@dexto/registry', path: 'packages/registry' },
    { name: '@dexto/tools-filesystem', path: 'packages/tools-filesystem' },
    { name: '@dexto/tools-process', path: 'packages/tools-process' },
    { name: '@dexto/tools-todo', path: 'packages/tools-todo' },
    { name: '@dexto/image-local', path: 'packages/image-local' },
    { name: '@dexto/agent-management', path: 'packages/agent-management' },
    { name: '@dexto/server', path: 'packages/server' },
    { name: 'dexto', path: 'packages/cli' },
];

let verdaccioProcess: ChildProcess | null = null;

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForRegistry(maxAttempts = 30): Promise<boolean> {
    for (let i = 0; i < maxAttempts; i++) {
        try {
            execSync(`curl -s ${REGISTRY_URL} > /dev/null 2>&1`, { stdio: 'ignore' });
            return true;
        } catch {
            await sleep(500);
        }
    }
    return false;
}

function startVerdaccio(): ChildProcess {
    console.log('🚀 Starting local npm registry (verdaccio)...');

    // Create minimal config for verdaccio
    mkdirSync(VERDACCIO_CONFIG_DIR, { recursive: true });

    const configPath = join(VERDACCIO_CONFIG_DIR, 'config.yaml');
    const config = `
storage: ${join(VERDACCIO_CONFIG_DIR, 'storage')}
auth:
  htpasswd:
    file: ${join(VERDACCIO_CONFIG_DIR, 'htpasswd')}
    max_users: -1
uplinks:
  npmjs:
    url: https://registry.npmjs.org/
packages:
  '@dexto/*':
    access: $all
    publish: $anonymous
    unpublish: $anonymous
  'dexto':
    access: $all
    publish: $anonymous
    unpublish: $anonymous
  '**':
    access: $all
    proxy: npmjs
server:
  keepAliveTimeout: 60
log: { type: stdout, format: pretty, level: warn }
`;

    writeFileSync(configPath, config);

    const proc = spawn('npx', ['verdaccio', '--config', configPath], {
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: false,
    });

    proc.stdout?.on('data', (data) => {
        const str = data.toString();
        if (str.includes('warn') || str.includes('error')) {
            process.stdout.write(`  [verdaccio] ${str}`);
        }
    });

    proc.stderr?.on('data', (data) => {
        const str = data.toString();
        if (!str.includes('npm warn')) {
            process.stderr.write(`  [verdaccio] ${str}`);
        }
    });

    return proc;
}

function stopVerdaccio() {
    if (verdaccioProcess) {
        console.log('🛑 Stopping local registry...');
        verdaccioProcess.kill('SIGTERM');
        verdaccioProcess = null;
    }
}

function cleanup() {
    stopVerdaccio();
    if (existsSync(VERDACCIO_CONFIG_DIR)) {
        console.log('🧹 Cleaning up verdaccio data...');
        rmSync(VERDACCIO_CONFIG_DIR, { recursive: true, force: true });
    }
}

function publishPackage(pkg: { name: string; path: string }) {
    console.log(`  📤 Publishing ${pkg.name}...`);
    try {
        // Create a temporary .npmrc in the package directory with fake auth for local registry
        const pkgDir = join(process.cwd(), pkg.path);
        const npmrcPath = join(pkgDir, '.npmrc');
        const npmrcContent = `//localhost:4873/:_authToken="fake-token-for-local-testing"\n`;
        writeFileSync(npmrcPath, npmrcContent);

        try {
            // Use pnpm publish to correctly resolve workspace:* dependencies to actual versions
            execSync(`pnpm publish --registry ${REGISTRY_URL} --no-git-checks`, {
                cwd: pkgDir,
                stdio: ['ignore', 'ignore', 'pipe'],
            });
        } finally {
            // Clean up the temporary .npmrc
            if (existsSync(npmrcPath)) {
                rmSync(npmrcPath);
            }
        }
    } catch (error: any) {
        // Ignore "already published" errors
        const stderr = error.stderr?.toString() || '';
        if (!stderr.includes('cannot publish over')) {
            throw error;
        }
        console.log(`    (already published, skipping)`);
    }
}

async function main() {
    const rootDir = process.cwd();

    // Ensure we're in the right directory
    if (!existsSync(join(rootDir, 'packages/cli/package.json'))) {
        console.error('❌ Must run from repository root');
        process.exit(1);
    }

    // Clean up any previous state
    cleanup();

    // Register cleanup handlers
    process.on('SIGINT', () => {
        cleanup();
        process.exit(1);
    });
    process.on('SIGTERM', () => {
        cleanup();
        process.exit(1);
    });
    process.on('exit', cleanup);

    try {
        // Start verdaccio
        verdaccioProcess = startVerdaccio();

        // Wait for registry to be ready
        console.log('  ⏳ Waiting for registry to start...');
        const ready = await waitForRegistry();
        if (!ready) {
            throw new Error('Verdaccio failed to start');
        }
        console.log('  ✓ Registry ready');

        // Publish all packages
        console.log('📦 Publishing packages to local registry...');
        for (const pkg of PACKAGES) {
            publishPackage(pkg);
        }
        console.log('  ✓ All packages published');

        // Uninstall existing global dexto (both npm and pnpm)
        console.log('🗑️  Removing existing global dexto...');
        let removedAny = false;
        try {
            execSync('npm uninstall -g dexto', { stdio: 'ignore' });
            console.log('  ✓ Removed npm global installation');
            removedAny = true;
        } catch {
            // npm global not installed
        }
        try {
            // Remove pnpm global link if it exists
            const pnpmBinDir = execSync('pnpm bin -g', { encoding: 'utf-8' }).trim();
            const pnpmDextoPath = join(pnpmBinDir, 'dexto');
            if (existsSync(pnpmDextoPath)) {
                rmSync(pnpmDextoPath, { force: true });
                console.log('  ✓ Removed pnpm global link');
                removedAny = true;
            }
        } catch {
            // pnpm not available or no global link
        }
        if (!removedAny) {
            console.log('  (no existing installation)');
        }

        // Install from local registry
        console.log('📥 Installing dexto globally from local registry...');
        execSync(`npm install -g dexto --registry ${REGISTRY_URL}`, {
            stdio: 'inherit',
        });

        console.log('');
        console.log('✅ Successfully installed dexto globally!');
        console.log('   Run "dexto --help" to get started');
    } catch (error) {
        console.error('❌ Installation failed:', error);
        process.exit(1);
    } finally {
        cleanup();
    }
}

main();

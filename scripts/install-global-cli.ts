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
import {
    existsSync,
    rmSync,
    mkdirSync,
    writeFileSync,
    readdirSync,
    readFileSync,
    lstatSync,
    readlinkSync,
} from 'fs';
import { join, resolve, sep } from 'path';
import { homedir } from 'os';

const REGISTRY_URL = 'http://localhost:4873';
const VERDACCIO_CONFIG_DIR = join(process.cwd(), '.verdaccio');

let verdaccioProcess: ChildProcess | null = null;

type WorkspacePackage = {
    name: string;
    dir: string;
    private: boolean;
    dependencies: Record<string, string>;
    optionalDependencies: Record<string, string>;
};

function readJsonFile(filePath: string): unknown {
    return JSON.parse(readFileSync(filePath, 'utf-8'));
}

function getWorkspacePackages(rootDir: string): Map<string, WorkspacePackage> {
    const packagesDir = join(rootDir, 'packages');
    const entries = existsSync(packagesDir)
        ? readdirSync(packagesDir, { withFileTypes: true })
        : [];

    const map = new Map<string, WorkspacePackage>();
    for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const pkgDir = join(packagesDir, entry.name);
        const pkgJsonPath = join(pkgDir, 'package.json');
        if (!existsSync(pkgJsonPath)) continue;

        const raw = readJsonFile(pkgJsonPath);
        if (!raw || typeof raw !== 'object') continue;

        const pkg = raw as Record<string, unknown>;
        const name = typeof pkg.name === 'string' ? pkg.name : undefined;
        if (!name) continue;

        map.set(name, {
            name,
            dir: join('packages', entry.name),
            private: pkg.private === true,
            dependencies:
                pkg.dependencies && typeof pkg.dependencies === 'object'
                    ? (pkg.dependencies as Record<string, string>)
                    : {},
            optionalDependencies:
                pkg.optionalDependencies && typeof pkg.optionalDependencies === 'object'
                    ? (pkg.optionalDependencies as Record<string, string>)
                    : {},
        });
    }

    return map;
}

function resolvePublishPlan(rootDir: string): WorkspacePackage[] {
    const packages = getWorkspacePackages(rootDir);
    const rootPackage = packages.get('dexto');
    if (!rootPackage) {
        throw new Error("Could not find workspace package 'dexto' in ./packages");
    }

    const needed = new Set<string>();
    const stack = ['dexto'];
    while (stack.length > 0) {
        const name = stack.pop();
        if (!name || needed.has(name)) continue;

        const pkg = packages.get(name);
        if (!pkg) {
            throw new Error(`Workspace dependency '${name}' not found under ./packages`);
        }
        if (pkg.private) {
            throw new Error(
                `Workspace dependency '${name}' is marked private and cannot be published to the local registry`
            );
        }

        needed.add(name);

        const depNames = new Set([
            ...Object.keys(pkg.dependencies),
            ...Object.keys(pkg.optionalDependencies),
        ]);
        for (const depName of depNames) {
            if (packages.has(depName)) {
                stack.push(depName);
            }
        }
    }

    // Build dependency graph within the closure
    const indegree = new Map<string, number>();
    const dependents = new Map<string, Set<string>>();

    for (const name of needed) {
        indegree.set(name, 0);
        dependents.set(name, new Set());
    }

    for (const name of needed) {
        const pkg = packages.get(name);
        if (!pkg) continue;
        const depNames = new Set([
            ...Object.keys(pkg.dependencies),
            ...Object.keys(pkg.optionalDependencies),
        ]);

        for (const depName of depNames) {
            if (!needed.has(depName)) continue;

            // name depends on depName
            indegree.set(name, (indegree.get(name) ?? 0) + 1);
            dependents.get(depName)?.add(name);
        }
    }

    const queue: string[] = [];
    for (const [name, deg] of indegree.entries()) {
        if (deg === 0) queue.push(name);
    }
    queue.sort();

    const ordered: WorkspacePackage[] = [];
    while (queue.length > 0) {
        const name = queue.shift();
        if (!name) break;

        const pkg = packages.get(name);
        if (pkg) ordered.push(pkg);

        for (const dep of dependents.get(name) ?? []) {
            const next = (indegree.get(dep) ?? 0) - 1;
            indegree.set(dep, next);
            if (next === 0) {
                queue.push(dep);
                queue.sort();
            }
        }
    }

    if (ordered.length !== needed.size) {
        const remaining = [...needed].filter((n) => (indegree.get(n) ?? 0) > 0).sort();
        throw new Error(
            `Could not compute publish order (cycle detected). Remaining: ${remaining.join(', ')}`
        );
    }

    return ordered;
}

type RemoveResult = { removed: boolean; message?: string };

function removeBunGlobalCliShim(toolName: string): RemoveResult {
    const bunInstallDir = process.env.BUN_INSTALL || join(homedir(), '.bun');
    const bunBinDir = join(bunInstallDir, 'bin');

    const candidates =
        process.platform === 'win32'
            ? [join(bunBinDir, `${toolName}.exe`), join(bunBinDir, `${toolName}.cmd`)]
            : [join(bunBinDir, toolName)];

    const messages: string[] = [];
    let removedAny = false;

    for (const candidate of candidates) {
        if (!existsSync(candidate)) {
            continue;
        }

        try {
            const stat = lstatSync(candidate);
            if (stat.isSymbolicLink()) {
                const target = readlinkSync(candidate);
                const resolvedTarget = resolve(bunBinDir, target);
                const bunGlobalPkgDir = join(
                    bunInstallDir,
                    'install',
                    'global',
                    'node_modules',
                    toolName
                );
                const looksLikeBunGlobalDexto =
                    resolvedTarget === bunGlobalPkgDir ||
                    resolvedTarget.startsWith(`${bunGlobalPkgDir}${sep}`);

                if (!looksLikeBunGlobalDexto) {
                    messages.push(
                        `Found bun shim at ${candidate}, but its target doesn't look like a bun-managed install (${target}).`
                    );
                    continue;
                }

                rmSync(candidate, { force: true });
                removedAny = true;
                messages.push(`Removed bun shim at ${candidate}`);
                continue;
            }

            const isWindowsExe =
                process.platform === 'win32' && candidate.toLowerCase().endsWith('.exe');
            if (!isWindowsExe) {
                const firstLine = readFileSync(candidate, 'utf8').split('\n')[0] ?? '';
                if (!firstLine.includes('bun')) {
                    messages.push(
                        `Found bun bin entry at ${candidate}, but it doesn't look like a bun script (first line: ${firstLine}).`
                    );
                    continue;
                }
            }

            rmSync(candidate, { force: true });
            removedAny = true;
            messages.push(`Removed bun bin entry at ${candidate}`);
        } catch (error) {
            messages.push(
                `Failed to inspect/remove bun shim at ${candidate}: ${
                    error instanceof Error ? error.message : String(error)
                }`
            );
        }
    }

    return { removed: removedAny, message: messages.length ? messages.join('; ') : undefined };
}

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

        const publishPlan = resolvePublishPlan(rootDir);

        // Publish all packages
        console.log('📦 Publishing packages to local registry...');
        for (const pkg of publishPlan) {
            publishPackage({ name: pkg.name, path: pkg.dir });
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
        try {
            const bunRemoval = removeBunGlobalCliShim('dexto');
            if (bunRemoval.removed) {
                console.log(`  ✓ ${bunRemoval.message}`);
                removedAny = true;
            } else if (bunRemoval.message) {
                console.log(`  ⚠️  ${bunRemoval.message}`);
            }
        } catch {
            // bun not installed or no bun shim found
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

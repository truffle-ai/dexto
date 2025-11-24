#!/usr/bin/env tsx

/**
 * Installs the dexto CLI globally.
 * Equivalent to end user installing with npm i -g dexto for the current code in the repo
 * This should:
 * 1. Build everything
 * 2. Create tarballs for @dexto/core, @dexto/agent-management, @dexto/analytics, @dexto/server, and dexto
 * 3. Remove the pnpm link (this was missing before!)
 * 4. Remove any npm installation
 * 5. Install all tarballs with npm
 *
 * Then verify with:
 * # Should show no dexto in pnpm global
 * pnpm list -g
 *
 * # Should show dexto installed via npm
 * npm list -g dexto --depth=0
 *
 * # Should NOT be a symlink anymore
 * readlink $(which dexto)
 */
import { execSync } from 'child_process';
import { readdirSync, unlinkSync, existsSync, rmSync, mkdirSync, lstatSync, symlinkSync } from 'fs';
import { join, dirname, relative } from 'path';

function dedupeZod(globalPrefix: string) {
    const candidateNodeModules = [
        join(globalPrefix, 'lib', 'node_modules'),
        join(globalPrefix, 'node_modules'),
    ];
    const globalNodeModules = candidateNodeModules.find((candidate) => existsSync(candidate));

    if (!globalNodeModules) {
        console.warn('  ⚠️  Unable to find global node_modules directory, skipping Zod dedupe.');
        return;
    }

    const possibleSources = [
        join(globalNodeModules, 'dexto', 'node_modules', 'zod'),
        join(globalNodeModules, 'zod'),
    ];

    const sourceZod = possibleSources.find((candidate) => existsSync(candidate));

    if (!sourceZod) {
        console.warn(
            '  ⚠️  No shared zod installation found after npm install; skipping dedupe. ' +
                'The CLI should still work, but memory route validation may remain broken.'
        );
        return;
    }

    const packagesNeedingSymlink = [
        '@dexto/core',
        '@dexto/agent-management',
        '@dexto/server',
        '@dexto/analytics',
    ];
    const linkType = process.platform === 'win32' ? 'junction' : 'dir';

    for (const pkg of packagesNeedingSymlink) {
        const nestedZod = join(globalNodeModules, pkg, 'node_modules', 'zod');
        if (!existsSync(nestedZod)) {
            continue;
        }

        try {
            const stat = lstatSync(nestedZod);
            if (stat.isSymbolicLink()) {
                continue;
            }
        } catch (error) {
            console.warn(`  ⚠️  Unable to inspect ${nestedZod}: ${error}`);
            continue;
        }

        try {
            rmSync(nestedZod, { recursive: true, force: true });
        } catch (error) {
            console.warn(`  ⚠️  Failed to remove ${nestedZod}: ${error}`);
            continue;
        }

        try {
            mkdirSync(dirname(nestedZod), { recursive: true });
            const relativePath = relative(dirname(nestedZod), sourceZod) || '.';
            symlinkSync(relativePath, nestedZod, linkType);
            console.log(`  🔗 Linked ${nestedZod} → ${sourceZod}`);
        } catch (error) {
            console.warn(`  ⚠️  Failed to link ${nestedZod} to ${sourceZod}: ${error}`);
        }
    }
}

console.log('📦 Creating tarballs for local installation...');

const rootDir = process.cwd();

// Pack @dexto/core
console.log('  Packing @dexto/core...');
execSync('pnpm pack', {
    cwd: join(rootDir, 'packages/core'),
    stdio: 'inherit',
});

// Pack @dexto/agent-management
console.log('  Packing @dexto/agent-management...');
execSync('pnpm pack', {
    cwd: join(rootDir, 'packages/agent-management'),
    stdio: 'inherit',
});

// Pack @dexto/analytics
console.log('  Packing @dexto/analytics...');
execSync('pnpm pack', {
    cwd: join(rootDir, 'packages/analytics'),
    stdio: 'inherit',
});

// Pack @dexto/server
console.log('  Packing @dexto/server...');
execSync('pnpm pack', {
    cwd: join(rootDir, 'packages/server'),
    stdio: 'inherit',
});

// Pack dexto CLI
console.log('  Packing dexto CLI...');
execSync('pnpm pack', {
    cwd: join(rootDir, 'packages/cli'),
    stdio: 'inherit',
});

// Find and move tarballs to root
const coreDir = join(rootDir, 'packages/core');
const agentManagementDir = join(rootDir, 'packages/agent-management');
const analyticsDir = join(rootDir, 'packages/analytics');
const serverDir = join(rootDir, 'packages/server');
const cliDir = join(rootDir, 'packages/cli');

const coreTarballs = readdirSync(coreDir).filter(
    (f) => f.startsWith('dexto-core-') && f.endsWith('.tgz')
);
const agentManagementTarballs = readdirSync(agentManagementDir).filter(
    (f) => f.startsWith('dexto-agent-management-') && f.endsWith('.tgz')
);
const analyticsTarballs = readdirSync(analyticsDir).filter(
    (f) => f.startsWith('dexto-analytics-') && f.endsWith('.tgz')
);
const serverTarballs = readdirSync(serverDir).filter(
    (f) => f.startsWith('dexto-server-') && f.endsWith('.tgz')
);
const cliTarballs = readdirSync(cliDir).filter(
    (f) =>
        f.startsWith('dexto-') &&
        !f.includes('core') &&
        !f.includes('analytics') &&
        !f.includes('server') &&
        f.endsWith('.tgz')
);

if (
    coreTarballs.length === 0 ||
    agentManagementTarballs.length === 0 ||
    analyticsTarballs.length === 0 ||
    serverTarballs.length === 0 ||
    cliTarballs.length === 0
) {
    console.error('❌ Failed to find tarballs');
    process.exit(1);
}

const coreTarball = coreTarballs[0];
const agentManagementTarball = agentManagementTarballs[0];
const analyticsTarball = analyticsTarballs[0];
const serverTarball = serverTarballs[0];
const cliTarball = cliTarballs[0];

console.log(`  Found core tarball: ${coreTarball}`);
console.log(`  Found agent-management tarball: ${agentManagementTarball}`);
console.log(`  Found analytics tarball: ${analyticsTarball}`);
console.log(`  Found server tarball: ${serverTarball}`);
console.log(`  Found CLI tarball: ${cliTarball}`);

execSync(`mv packages/core/${coreTarball} .`, { stdio: 'inherit' });
execSync(`mv packages/agent-management/${agentManagementTarball} .`, { stdio: 'inherit' });
execSync(`mv packages/analytics/${analyticsTarball} .`, { stdio: 'inherit' });
execSync(`mv packages/server/${serverTarball} .`, { stdio: 'inherit' });
execSync(`mv packages/cli/${cliTarball} .`, { stdio: 'inherit' });

// Uninstall existing global dexto (both pnpm and npm)
console.log('🗑️  Removing any existing global dexto installations (npm & pnpm)...');

// Check if pnpm global has dexto
try {
    const pnpmList = execSync('pnpm list -g --depth=0', { encoding: 'utf-8' });
    if (pnpmList.includes('dexto')) {
        execSync('pnpm rm -g dexto', { stdio: 'inherit' });
        console.log('  ✓ Removed pnpm global link/install');
    }
} catch (e) {
    console.error('  ❌ Failed to remove pnpm global install');
    console.error(e instanceof Error ? e.message : String(e));
    process.exit(1);
}

// Check if npm global has dexto
try {
    const npmList = execSync('npm list -g dexto --depth=0', { encoding: 'utf-8', stdio: 'pipe' });
    if (!npmList.includes('(empty)')) {
        execSync('npm uninstall -g dexto', { stdio: 'inherit' });
        console.log('  ✓ Removed npm global install');
    }
} catch {
    // npm list returns non-zero if package not found, which is fine - nothing to uninstall
}

// Install all packages globally
// Use absolute paths and explicit prefix to avoid npm workspace detection issues
console.log('🚀 Installing packages globally...');
const coreAbsPath = join(rootDir, coreTarball);
const agentManagementAbsPath = join(rootDir, agentManagementTarball);
const analyticsAbsPath = join(rootDir, analyticsTarball);
const serverAbsPath = join(rootDir, serverTarball);
const cliAbsPath = join(rootDir, cliTarball);

// Get npm global prefix from node binary path (avoids workspace detection)
const nodePath = execSync('which node', { encoding: 'utf-8' }).trim();
// Node is typically at /path/to/prefix/bin/node, so go up one level for prefix
const npmGlobalPrefix = join(nodePath, '..', '..');
const resolvedPrefix = execSync(`cd "${npmGlobalPrefix}" && pwd`, { encoding: 'utf-8' }).trim();
console.log(`  📍 Installing to npm global prefix: ${resolvedPrefix}`);

execSync(
    `npm install --global --prefix "${resolvedPrefix}" "${coreAbsPath}" "${agentManagementAbsPath}" "${analyticsAbsPath}" "${serverAbsPath}" "${cliAbsPath}"`,
    {
        stdio: 'inherit',
        cwd: '/tmp', // Run from /tmp to avoid workspace context
    }
);

console.log('🔄 Deduplicating Zod across installed packages...');
dedupeZod(resolvedPrefix);

// Clean up tarballs
console.log('🧹 Cleaning up tarballs...');
unlinkSync(coreTarball!);
unlinkSync(agentManagementTarball!);
unlinkSync(analyticsTarball!);
unlinkSync(serverTarball!);
unlinkSync(cliTarball!);

console.log('✅ Successfully installed dexto globally!');
console.log('   Run "dexto --help" to get started');

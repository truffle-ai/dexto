#!/usr/bin/env tsx

/**
 * Installs the dexto CLI globally.
 * Equivalent to end user installing with npm i -g dexto for the current code in the repo
 * This should:
 * 1. Build everything
 * 2. Create tarballs for @dexto/core, @dexto/analytics, @dexto/server, and dexto
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
import { readdirSync, unlinkSync } from 'fs';
import { join } from 'path';

console.log('📦 Creating tarballs for local installation...');

const rootDir = process.cwd();

// Pack @dexto/core
console.log('  Packing @dexto/core...');
execSync('pnpm pack', {
    cwd: join(rootDir, 'packages/core'),
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
const analyticsDir = join(rootDir, 'packages/analytics');
const serverDir = join(rootDir, 'packages/server');
const cliDir = join(rootDir, 'packages/cli');

const coreTarballs = readdirSync(coreDir).filter(
    (f) => f.startsWith('dexto-core-') && f.endsWith('.tgz')
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
    analyticsTarballs.length === 0 ||
    serverTarballs.length === 0 ||
    cliTarballs.length === 0
) {
    console.error('❌ Failed to find tarballs');
    process.exit(1);
}

const coreTarball = coreTarballs[0];
const analyticsTarball = analyticsTarballs[0];
const serverTarball = serverTarballs[0];
const cliTarball = cliTarballs[0];

console.log(`  Found core tarball: ${coreTarball}`);
console.log(`  Found analytics tarball: ${analyticsTarball}`);
console.log(`  Found server tarball: ${serverTarball}`);
console.log(`  Found CLI tarball: ${cliTarball}`);

execSync(`mv packages/core/${coreTarball} .`, { stdio: 'inherit' });
execSync(`mv packages/analytics/${analyticsTarball} .`, { stdio: 'inherit' });
execSync(`mv packages/server/${serverTarball} .`, { stdio: 'inherit' });
execSync(`mv packages/cli/${cliTarball} .`, { stdio: 'inherit' });

// Uninstall existing global dexto (both pnpm and npm)
console.log('🗑️  Removing any existing global dexto installations (npm & pnpm)...');
try {
    // First try to remove pnpm link/install
    execSync('pnpm rm -g dexto', { stdio: 'pipe' });
    console.log('  ✓ Removed pnpm global link/install');
} catch (e) {
    // Ignore if not installed
}
try {
    // Then try to remove npm install
    execSync('npm uninstall -g dexto', { stdio: 'pipe' });
    console.log('  ✓ Removed npm global install');
} catch (e) {
    // Ignore if not installed
}

// Install all packages globally
console.log('🚀 Installing packages globally...');
execSync(
    `npm install -g ./${coreTarball} ./${analyticsTarball} ./${serverTarball} ./${cliTarball}`,
    {
        stdio: 'inherit',
    }
);

// Clean up tarballs
console.log('🧹 Cleaning up tarballs...');
unlinkSync(coreTarball);
unlinkSync(analyticsTarball);
unlinkSync(serverTarball);
unlinkSync(cliTarball);

console.log('✅ Successfully installed dexto globally!');
console.log('   Run "dexto --help" to get started');

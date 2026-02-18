#!/usr/bin/env bun

import { execSync } from 'child_process';
import { existsSync, lstatSync, rmSync } from 'fs';
import path from 'path';

function getBunGlobalBinDir(): string {
    try {
        return execSync('bun pm bin -g', { encoding: 'utf-8' }).trim();
    } catch (error) {
        console.error('❌ Failed to determine Bun global bin dir via `bun pm bin -g`.', error);
        process.exit(1);
    }
}

function safeRemoveIfExists(filePath: string): boolean {
    if (!existsSync(filePath)) return false;

    const stat = lstatSync(filePath);
    if (stat.isDirectory()) {
        console.error(`❌ Refusing to remove directory at: ${filePath}`);
        process.exit(1);
    }

    rmSync(filePath, { force: true });
    return true;
}

function main(): void {
    // Remove any Bun-installed global package (no-op if not installed).
    try {
        execSync('bun remove -g dexto', { stdio: 'ignore' });
    } catch {
        // Intentionally ignored: package may not be globally installed
    }

    const bunGlobalBinDir = getBunGlobalBinDir();
    if (!bunGlobalBinDir) {
        console.error('❌ `bun pm bin -g` returned an empty path.');
        process.exit(1);
    }

    const linkPath = path.join(bunGlobalBinDir, 'dexto');
    const removedLink = safeRemoveIfExists(linkPath);

    if (removedLink) {
        console.log('✅ Unlinked dexto CLI (Bun global)');
        console.log(`   Removed: ${linkPath}`);
    } else {
        console.log(`ℹ️  No dexto link found at: ${linkPath}`);
    }
}

main();

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

function safeRemoveIfExists(filePath: string): void {
    if (!existsSync(filePath)) return;

    const stat = lstatSync(filePath);
    if (stat.isDirectory()) {
        console.error(`❌ Refusing to remove directory at: ${filePath}`);
        process.exit(1);
    }

    rmSync(filePath, { force: true });
}

function main(): void {
    // Remove any Bun-installed global package (no-op if not installed).
    try {
        execSync('bun remove -g dexto', { stdio: 'ignore' });
    } catch {}

    const bunGlobalBinDir = getBunGlobalBinDir();
    if (!bunGlobalBinDir) {
        console.error('❌ `bun pm bin -g` returned an empty path.');
        process.exit(1);
    }

    const linkPath = path.join(bunGlobalBinDir, 'dexto');
    safeRemoveIfExists(linkPath);

    console.log('✅ Unlinked dexto CLI (Bun global)');
    console.log(`   Removed: ${linkPath}`);
}

main();

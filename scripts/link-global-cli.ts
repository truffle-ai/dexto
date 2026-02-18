#!/usr/bin/env bun

import { execSync } from 'child_process';
import { chmodSync, existsSync, lstatSync, mkdirSync, rmSync, symlinkSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');

const cliEntrypoint = path.join(rootDir, 'packages', 'cli', 'dist', 'index.js');

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
    if (!existsSync(cliEntrypoint)) {
        console.error(`❌ Missing CLI build output: ${cliEntrypoint}`);
        console.error('Run `bun run build:cli` (or `bun run build`) first.');
        process.exit(1);
    }

    // Ensure it's executable so the shebang works when invoked via symlink.
    try {
        chmodSync(cliEntrypoint, 0o755);
    } catch {}

    // Remove any Bun-installed global package first to avoid ambiguity.
    try {
        execSync('bun remove -g dexto', { stdio: 'ignore' });
    } catch {}

    const bunGlobalBinDir = getBunGlobalBinDir();
    if (!bunGlobalBinDir) {
        console.error('❌ `bun pm bin -g` returned an empty path.');
        process.exit(1);
    }

    mkdirSync(bunGlobalBinDir, { recursive: true });

    const linkPath = path.join(bunGlobalBinDir, 'dexto');
    safeRemoveIfExists(linkPath);

    symlinkSync(cliEntrypoint, linkPath, 'file');

    console.log('✅ Linked dexto CLI');
    console.log(`   Entry: ${cliEntrypoint}`);
    console.log(`   Link:  ${linkPath}`);
    console.log('');

    try {
        const resolved = execSync('command -v dexto', { encoding: 'utf-8' }).trim();
        if (resolved && resolved !== linkPath) {
            console.log(`⚠️  Note: \`dexto\` currently resolves to: ${resolved}`);
            console.log('    Ensure Bun global bin comes first in your PATH.');
            console.log('');
        }
    } catch {}

    console.log('If `dexto` still resolves to a different binary, ensure this is in PATH:');
    console.log(`  ${bunGlobalBinDir}`);
}

main();

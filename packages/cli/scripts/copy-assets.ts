#!/usr/bin/env tsx
import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync } from 'fs';
import { dirname, join, relative, sep } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const SOURCE_DIR = join(__dirname, '../src/cli/assets');
const DEST_DIR = join(__dirname, '../dist/cli/assets');

const SKIP_PREFIXES = ['sounds/downloaded'] as const;

function normalizeRelPath(pathValue: string): string {
    return pathValue.split(sep).join('/');
}

function shouldSkip(srcPath: string): boolean {
    const rel = normalizeRelPath(relative(SOURCE_DIR, srcPath));
    return SKIP_PREFIXES.some((prefix) => rel === prefix || rel.startsWith(`${prefix}/`));
}

function copyDirectory(src: string, dest: string): void {
    if (shouldSkip(src)) return;

    if (!existsSync(dest)) {
        mkdirSync(dest, { recursive: true });
    }

    const entries = readdirSync(src);

    for (const entry of entries) {
        const srcPath = join(src, entry);
        const destPath = join(dest, entry);

        if (shouldSkip(srcPath)) continue;

        const stat = statSync(srcPath);
        if (stat.isDirectory()) {
            copyDirectory(srcPath, destPath);
        } else if (stat.isFile()) {
            copyFileSync(srcPath, destPath);
        }
    }
}

function copyAssets(): void {
    console.log('📦 Copying assets to dist...');
    console.log(`🔎 Skipping: ${SKIP_PREFIXES.join(', ')}`);

    if (!existsSync(SOURCE_DIR)) {
        console.error(`❌ Source directory not found: ${SOURCE_DIR}`);
        process.exit(1);
    }

    mkdirSync(DEST_DIR, { recursive: true });
    copyDirectory(SOURCE_DIR, DEST_DIR);
    console.log('✅ Assets copied successfully');
}

if (import.meta.url === `file://${process.argv[1]}`) {
    try {
        copyAssets();
    } catch (error) {
        console.error('❌ Failed to copy assets:', error);
        process.exit(1);
    }
}

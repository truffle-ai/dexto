#!/usr/bin/env tsx
import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const SOURCE_DIR = join(__dirname, '../src/assets');
const DEST_DIR = join(__dirname, '../dist/assets');

function copyDirectory(src: string, dest: string): void {
    if (!existsSync(dest)) {
        mkdirSync(dest, { recursive: true });
    }

    const entries = readdirSync(src);
    for (const entry of entries) {
        const srcPath = join(src, entry);
        const destPath = join(dest, entry);
        const stat = statSync(srcPath);
        if (stat.isDirectory()) {
            copyDirectory(srcPath, destPath);
        } else if (stat.isFile()) {
            copyFileSync(srcPath, destPath);
        }
    }
}

function copyAssets(): void {
    if (!existsSync(SOURCE_DIR)) {
        throw new Error(`Source directory not found: ${SOURCE_DIR}`);
    }

    mkdirSync(DEST_DIR, { recursive: true });
    copyDirectory(SOURCE_DIR, DEST_DIR);
}

if (import.meta.url === `file://${process.argv[1]}`) {
    copyAssets();
}

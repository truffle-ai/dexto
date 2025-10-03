#!/usr/bin/env tsx
import { existsSync, mkdirSync, copyFileSync, readdirSync, statSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const ASSETS_SOURCE_DIR = join(__dirname, '../src/assets');
const ASSETS_DEST_DIR = join(__dirname, '../dist/assets');

/**
 * Recursively copy a directory
 */
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
        } else {
            copyFileSync(srcPath, destPath);
        }
    }
}

/**
 * Copy CLI assets to dist
 */
function copyAssets(): void {
    if (!existsSync(ASSETS_SOURCE_DIR)) {
        console.warn('⚠️  Assets directory not found, skipping...');
        return;
    }

    console.log('🎨 Copying CLI assets to dist...');
    copyDirectory(ASSETS_SOURCE_DIR, ASSETS_DEST_DIR);
    console.log('✅ Successfully copied assets to dist');
}

// Run the script
if (import.meta.url === `file://${process.argv[1]}`) {
    try {
        copyAssets();
    } catch (error) {
        console.error('❌ Failed to copy assets:', error);
        process.exit(1);
    }
}

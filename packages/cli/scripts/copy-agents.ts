#!/usr/bin/env bun
import { existsSync, mkdirSync, copyFileSync, readdirSync, statSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Configuration - which agents and files to copy
const AGENTS_TO_COPY = [
    // Core files
    'agent-registry.json',
    'agent-template.yml',
    'default-agent.yml',

    // Agent directories
    'coding-agent/',
    'database-agent/',
    'explore-agent/',
    'github-agent/',
    'image-editor-agent/',
    'music-agent/',
    'nano-banana-agent/',
    'podcast-agent/',
    'product-name-researcher/',
    'sora-video-agent/',
    'talk2pdf-agent/',
    'triage-demo/',
];

const SOURCE_DIR = join(__dirname, '../../../agents');
const DEST_DIR = join(__dirname, '../dist/agents');

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
 * Copy a single file
 */
function copyFile(src: string, dest: string): void {
    const destDir = dirname(dest);
    if (!existsSync(destDir)) {
        mkdirSync(destDir, { recursive: true });
    }
    copyFileSync(src, dest);
}

/**
 * Main copy function
 */
function copyAgents(): void {
    console.log('📦 Copying configured agents to dist...');

    // Ensure source directory exists
    if (!existsSync(SOURCE_DIR)) {
        console.error(`❌ Source directory not found: ${SOURCE_DIR}`);
        process.exit(1);
    }

    // Create destination directory
    if (!existsSync(DEST_DIR)) {
        mkdirSync(DEST_DIR, { recursive: true });
    }

    let copiedCount = 0;

    for (const item of AGENTS_TO_COPY) {
        // Normalize the item: remove any trailing slash so path.join works consistently on all OSes
        const normalizedItem = item.replace(/\/$/, '');
        const srcPath = join(SOURCE_DIR, normalizedItem);
        const destPath = join(DEST_DIR, normalizedItem);

        if (!existsSync(srcPath)) {
            console.warn(`⚠️  Skipping missing item: ${item}`);
            continue;
        }

        const stat = statSync(srcPath);

        if (stat.isDirectory()) {
            console.log(`📁 Copying directory: ${normalizedItem}`);
            copyDirectory(srcPath, destPath);
            copiedCount++;
        } else if (stat.isFile()) {
            console.log(`📄 Copying file: ${normalizedItem}`);
            copyFile(srcPath, destPath);
            copiedCount++;
        } else {
            console.warn(`⚠️  Skipping non-regular entry: ${normalizedItem}`);
        }
    }

    console.log(`✅ Successfully copied ${copiedCount}/${AGENTS_TO_COPY.length} agents to dist`);
}

// Run the script
if (import.meta.main) {
    try {
        copyAgents();
    } catch (error) {
        console.error('❌ Failed to copy agents:', error);
        process.exit(1);
    }
}

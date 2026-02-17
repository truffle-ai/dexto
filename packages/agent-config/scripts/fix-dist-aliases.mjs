#!/usr/bin/env bun
/* eslint-env node */
import console from 'node:console';
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, extname, join, relative, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const DIST_DIR = resolve(__dirname, '../dist');
const PROCESS_EXTENSIONS = new Set(['.js', '.cjs', '.mjs', '.ts', '.mts', '.cts']);
const IMPORT_PATTERN = /(['"])@agent-config\/([^'"]+)\1/g;

function collectFiles(root) {
    const entries = readdirSync(root);
    const files = [];
    for (const entry of entries) {
        const fullPath = join(root, entry);
        const stats = statSync(fullPath);
        if (stats.isDirectory()) {
            files.push(...collectFiles(fullPath));
        } else {
            files.push(fullPath);
        }
    }
    return files;
}

function resolveImport(fromFile, subpath) {
    const fromExt = extname(fromFile);
    const preferredExt = fromExt === '.cjs' ? '.cjs' : '.js';
    const candidateBase = subpath.replace(/\.(mjs|cjs|js)$/, '');
    const bases = [candidateBase];
    if (!candidateBase.endsWith('index')) {
        bases.push(join(candidateBase, 'index'));
    }

    const candidates = [];
    for (const base of bases) {
        const exts = Array.from(new Set([preferredExt, '.mjs', '.js', '.cjs']));
        for (const ext of exts) {
            candidates.push(`${base}${ext}`);
        }
    }

    for (const candidate of candidates) {
        const absolute = resolve(DIST_DIR, candidate);
        if (existsSync(absolute)) {
            let relativePath = relative(dirname(fromFile), absolute).replace(/\\/g, '/');
            if (!relativePath.startsWith('.')) {
                relativePath = `./${relativePath}`;
            }
            return relativePath;
        }
    }

    return null;
}

function rewriteAliases(filePath) {
    const ext = extname(filePath);
    if (!PROCESS_EXTENSIONS.has(ext)) {
        return false;
    }

    const original = readFileSync(filePath, 'utf8');
    let modified = false;
    const updated = original.replace(IMPORT_PATTERN, (match, quote, requested) => {
        const resolved = resolveImport(filePath, requested);
        if (!resolved) {
            console.warn(`⚠️  Unable to resolve alias @agent-config/${requested} in ${filePath}`);
            return match;
        }
        modified = true;
        return `${quote}${resolved}${quote}`;
    });

    if (modified) {
        writeFileSync(filePath, updated, 'utf8');
    }

    return modified;
}

function main() {
    if (!existsSync(DIST_DIR)) {
        console.error(`❌ dist directory not found at ${DIST_DIR}`);
        process.exit(1);
    }

    const files = collectFiles(DIST_DIR);
    let changed = 0;
    for (const file of files) {
        if (rewriteAliases(file)) {
            changed += 1;
        }
    }
    console.log(`ℹ️  Fixed alias imports in ${changed} files.`);
}

main();

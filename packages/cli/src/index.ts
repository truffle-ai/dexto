#!/usr/bin/env node
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { applyLayeredEnvironmentLoading } from './utils/env.js';

/**
 * Standalone binaries are distributed with a sibling `dist/` directory.
 * When present, set package root so shared path resolvers can find bundled assets.
 */
if (!process.env.DEXTO_PACKAGE_ROOT) {
    const executableDir = dirname(process.execPath);
    if (existsSync(join(executableDir, 'dist'))) {
        process.env.DEXTO_PACKAGE_ROOT = executableDir;
    }
}

// Ensure layered env vars are loaded before the main CLI module executes.
await applyLayeredEnvironmentLoading();

await import('./index-main.js');

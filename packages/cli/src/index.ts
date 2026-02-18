#!/usr/bin/env bun
import { applyLayeredEnvironmentLoading } from './utils/env.js';

declare const DEXTO_CLI_VERSION: string | undefined;

if (
    (!process.env.DEXTO_CLI_VERSION || process.env.DEXTO_CLI_VERSION.length === 0) &&
    typeof DEXTO_CLI_VERSION === 'string' &&
    DEXTO_CLI_VERSION.length > 0
) {
    process.env.DEXTO_CLI_VERSION = DEXTO_CLI_VERSION;
}

// Ensure layered env vars are loaded before the main CLI module executes.
await applyLayeredEnvironmentLoading();

await import('./index-main.js');

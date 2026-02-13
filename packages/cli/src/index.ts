#!/usr/bin/env node
import { applyLayeredEnvironmentLoading } from './utils/env.js';

// Ensure layered env vars are loaded before the main CLI module executes.
await applyLayeredEnvironmentLoading();

await import('./index-main.js');

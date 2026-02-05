// packages/analytics/src/state.ts

import { promises as fs } from 'fs';
import * as path from 'path';
import os from 'os';
import { randomUUID, createHash } from 'crypto';
import { createRequire } from 'module';
import { getDextoGlobalPath } from '@dexto/core/utils/path.js';

/**
 * Shape of the persisted analytics state written to
 * ~/.dexto/telemetry/state.json.
 *
 * - distinctId: Anonymous ID (UUID) for grouping events by machine.
 * - createdAt: ISO timestamp when the state was first created.
 * - commandRunCounts: Local counters per command for coarse diagnostics.
 */
export interface AnalyticsState {
    distinctId: string;
    createdAt: string; // ISO string
    commandRunCounts?: Record<string, number>;
}

const STATE_DIR = getDextoGlobalPath('telemetry');
const STATE_FILE = path.join(STATE_DIR, 'state.json');

/**
 * Load the persisted analytics state, creating a new file if missing.
 * Returns a valid state object with defaults populated.
 */
export async function loadState(): Promise<AnalyticsState> {
    try {
        const content = await fs.readFile(STATE_FILE, 'utf8');
        const parsed = JSON.parse(content) as Partial<AnalyticsState>;
        // Validate minimal shape
        if (!parsed.distinctId) throw new Error('invalid state');
        return {
            distinctId: parsed.distinctId,
            createdAt: parsed.createdAt || new Date().toISOString(),
            commandRunCounts: parsed.commandRunCounts ?? {},
        };
    } catch {
        await fs.mkdir(STATE_DIR, { recursive: true });
        const state: AnalyticsState = {
            distinctId: computeDistinctId(),
            createdAt: new Date().toISOString(),
            commandRunCounts: {},
        };
        await saveState(state);
        return state;
    }
}

/**
 * Persist the analytics state to ~/.dexto/telemetry/state.json.
 */
export async function saveState(state: AnalyticsState): Promise<void> {
    await fs.mkdir(STATE_DIR, { recursive: true });
    await fs.writeFile(STATE_FILE, JSON.stringify(state, null, 2), 'utf8');
}

/**
 * Compute a stable, privacy‑safe machine identifier so identity
 * survives ~/.dexto deletion by default.
 *
 * Strategy:
 * - Prefer node-machine-id (hashed), which abstracts platform differences.
 * - Fallback to a salted/hashed hostname.
 * - As a last resort, generate a random UUID.
 */
function computeDistinctId(): string {
    try {
        // node-machine-id is CommonJS; require lazily to avoid import-time failures
        const requireCJS = createRequire(import.meta.url);
        const { machineIdSync } = requireCJS('node-machine-id') as {
            machineIdSync: (original?: boolean) => string;
        };
        // machineIdSync(true) returns a hashed, stable identifier
        const id = machineIdSync(true);
        if (typeof id === 'string' && id.length > 0) return `DEXTO-${id}`;
    } catch {
        // fall through to hostname hash
    }
    // Fallback: hash hostname to avoid exposing raw value
    const hostname = os.hostname() || 'unknown-host';
    const digest = createHash('sha256').update(hostname).digest('hex');
    if (digest) return `DEXTO-${digest.slice(0, 32)}`;
    // Last resort
    return `DEXTO-${randomUUID()}`;
}

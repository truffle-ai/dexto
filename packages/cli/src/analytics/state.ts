// packages/cli/src/analytics/state.ts

import { promises as fs } from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { getDextoGlobalPath } from '@dexto/core';

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
            distinctId: randomUUID(),
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

// packages/cli/src/analytics/state.ts

import { promises as fs } from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { getDextoGlobalPath } from '@dexto/core';

export interface AnalyticsState {
    distinctId: string;
    createdAt: string; // ISO string
    firstRunTracked?: boolean;
    firstPromptTracked?: boolean;
    commandRunCounts?: Record<string, number>;
}

const STATE_DIR = getDextoGlobalPath('telemetry');
const STATE_FILE = path.join(STATE_DIR, 'state.json');

export async function loadState(): Promise<AnalyticsState> {
    try {
        const content = await fs.readFile(STATE_FILE, 'utf8');
        const parsed = JSON.parse(content) as Partial<AnalyticsState>;
        // Validate minimal shape
        if (!parsed.distinctId) throw new Error('invalid state');
        return {
            distinctId: parsed.distinctId,
            createdAt: parsed.createdAt || new Date().toISOString(),
            firstRunTracked: parsed.firstRunTracked ?? false,
            firstPromptTracked: parsed.firstPromptTracked ?? false,
            commandRunCounts: parsed.commandRunCounts ?? {},
        };
    } catch {
        await fs.mkdir(STATE_DIR, { recursive: true });
        const state: AnalyticsState = {
            distinctId: randomUUID(),
            createdAt: new Date().toISOString(),
            firstRunTracked: false,
            firstPromptTracked: false,
            commandRunCounts: {},
        };
        await saveState(state);
        return state;
    }
}

export async function saveState(state: AnalyticsState): Promise<void> {
    await fs.mkdir(STATE_DIR, { recursive: true });
    await fs.writeFile(STATE_FILE, JSON.stringify(state, null, 2), 'utf8');
}

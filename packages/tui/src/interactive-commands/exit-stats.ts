/**
 * Exit Stats Storage
 *
 * Stores session statistics to be displayed after the CLI exits.
 * This allows the stats to be printed to stdout after Ink unmounts,
 * ensuring they appear at the bottom of the terminal.
 */

import type { SessionMetadata } from '@dexto/core';

export interface ExitSessionStats {
    sessionId?: string;
    duration?: string;
    messageCount: {
        total: number;
        user: number;
        assistant: number;
    };
    tokenUsage?: NonNullable<SessionMetadata['tokenUsage']>;
    estimatedCost?: SessionMetadata['estimatedCost'];
    modelStats?: NonNullable<SessionMetadata['modelStats']>;
}

let exitStats: ExitSessionStats | null = null;

export function setExitStats(stats: ExitSessionStats): void {
    exitStats = stats;
}

export function getExitStats(): ExitSessionStats | null {
    return exitStats;
}

export function clearExitStats(): void {
    exitStats = null;
}

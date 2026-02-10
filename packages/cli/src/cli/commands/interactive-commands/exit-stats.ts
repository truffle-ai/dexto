/**
 * Exit Stats Storage
 *
 * Stores session statistics to be displayed after the CLI exits.
 * This allows the stats to be printed to stdout after Ink unmounts,
 * ensuring they appear at the bottom of the terminal.
 */

export interface ExitSessionStats {
    sessionId?: string;
    modelName?: string;
    duration?: string;
    messageCount: {
        total: number;
        user: number;
        assistant: number;
    };
    tokenUsage?: {
        inputTokens: number;
        outputTokens: number;
        reasoningTokens: number;
        cacheReadTokens: number;
        cacheWriteTokens: number;
        totalTokens: number;
    };
    estimatedCost?: number;
    modelStats?: Array<{
        provider: string;
        model: string;
        messageCount: number;
        tokenUsage: {
            inputTokens: number;
            outputTokens: number;
            reasoningTokens: number;
            cacheReadTokens: number;
            cacheWriteTokens: number;
            totalTokens: number;
        };
        estimatedCost: number;
    }>;
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

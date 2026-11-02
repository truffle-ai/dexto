/**
 * What the Signal deck shows, worked out from the CLI's own state. Pure, so each rule is
 * tested on its own; `useDeckState` gathers the inputs.
 */
import type { DeckCredits, DeckMode } from '../signal/index.js';

export interface DeckActivity {
    isProcessing: boolean;
    isCancelling: boolean;
    isThinking: boolean;
    isCompacting: boolean;
    /** An approval or a question is waiting on the user. */
    awaitingUser: boolean;
    /** A tool call is executing. */
    toolRunning: boolean;
    /** Steer messages waiting for the current step to finish. */
    steerCount: number;
    /** The last run ended on an error. Cleared when the next run starts. */
    lastRunFailed: boolean;
}

/** Highest first: what needs the user, then what the agent is doing. */
export function deckMode(a: DeckActivity): DeckMode {
    if (a.awaitingUser) return 'wait';
    if (!a.isProcessing) return a.lastRunFailed ? 'fault' : 'idle';
    if (a.isCancelling) return 'stop';
    if (a.steerCount > 0) return 'steer';
    if (a.isThinking) return 'think';
    if (a.toolRunning || a.isCompacting) return 'tool';
    return 'stream';
}

export interface DeckReadoutInput {
    /** Formatted elapsed time of the run, or of the wait. */
    elapsed: string;
    /** Formatted token count; '' when too small to show. */
    tokens: string;
    compacting: boolean;
    steerCount: number;
    /** "plan mode", "accept edits", "auto-approve"; null in the default mode. */
    permission: string | null;
    /** ChatGPT plan usage, when it is worth showing. */
    rateLimitHint: string | null;
}

function join(parts: ReadonlyArray<string | null>): string | null {
    const kept = parts.filter((p): p is string => p !== null && p !== '');
    return kept.length > 0 ? kept.join(' · ') : null;
}

export function deckReadout(mode: DeckMode, r: DeckReadoutInput): string | null {
    switch (mode) {
        case 'wait':
            return `paused ${r.elapsed}`;
        case 'steer':
            return `${r.steerCount} steer${r.steerCount === 1 ? '' : 's'} queued`;
        case 'stop':
            return 'stopping';
        case 'think':
        case 'stream':
        case 'tool':
        case 'cloud':
            return join([r.compacting ? 'compacting' : r.tokens, r.elapsed]);
        default:
            return join([r.permission, r.rateLimitHint]);
    }
}

/** "dexto/…" for Dexto credits, "provider/model" for an own key. */
export function deckModelId(provider: string | null, model: string): string {
    if (provider === null) return model;
    return `${provider === 'dexto-nova' ? 'dexto' : provider}/${model}`;
}

export interface DeckCreditsInput {
    signedIn: boolean;
    /** Current balance in USD, null when not known. */
    balance: number | null;
    /** Balance when the current or last turn started, to show what it spent. */
    turnStartBalance: number | null;
}

export function deckCredits(c: DeckCreditsInput): DeckCredits {
    if (!c.signedIn) return { kind: 'signed-out' };
    if (c.balance === null) return { kind: 'signed-in' };
    if (c.balance <= 0) return { kind: 'out' };
    const spent =
        c.turnStartBalance === null ? 0 : Math.round((c.turnStartBalance - c.balance) * 100) / 100;
    return { kind: 'balance', balance: c.balance, spend: spent > 0 ? spent : null };
}

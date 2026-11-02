/**
 * How the deck steps down with width. Under 3 rows the wordmark stops being legible, so the
 * narrowest step drops it and keeps the trace.
 *
 *   ≥100 cols  wide  band with the status block on its right, then input      = 4 rows
 *   44–99      mid   band (wordmark, trace, mode), input, compact status row  = 5 rows
 *   <44        bare  trace only, input, compact status row                    = 4 rows
 */
export type DeckBand = 'wide' | 'mid' | 'bare';

export interface DeckLayout {
    band: DeckBand;
    /** Rows the band takes above the gate and input. */
    bandRows: 2 | 3;
    /** Whether the status sits in its own row under the input. */
    statusRow: boolean;
    /** Width of the status block beside the trace; 0 when there is none. */
    blockWidth: number;
}

export const WIDE_COLUMNS = 100;
export const BARE_BELOW_COLUMNS = 44;

export function deckLayout(columns: number): DeckLayout {
    if (columns >= WIDE_COLUMNS) {
        return {
            band: 'wide',
            bandRows: 3,
            statusRow: false,
            blockWidth: Math.min(36, Math.max(30, Math.floor(columns * 0.26))),
        };
    }
    if (columns >= BARE_BELOW_COLUMNS) {
        return { band: 'mid', bandRows: 3, statusRow: true, blockWidth: 0 };
    }
    return { band: 'bare', bandRows: 2, statusRow: true, blockWidth: 0 };
}

/** 46k, 1.2M, 850. */
export function formatTokens(tokens: number): string {
    if (tokens >= 1_000_000) return `${trimZero((tokens / 1_000_000).toFixed(1))}M`;
    if (tokens >= 1_000) return `${Math.round(tokens / 1_000)}k`;
    return String(tokens);
}

function trimZero(value: string): string {
    return value.endsWith('.0') ? value.slice(0, -2) : value;
}

/**
 * The Dexto wordmark as terminal cells, drawn from the real logo by scripts/build-wordmark.mjs.
 */
import type { Caps } from './caps.js';
import { WORDMARK_ART } from './wordmark-art.generated.js';

/** sextant: 2×3 cells (opt-in terminals) · quadrant: 2×2 (everywhere) · ascii: no UTF-8. */
export type WordmarkTier = 'sextant' | 'quadrant' | 'ascii';

export interface WordmarkArt {
    rows: number;
    cols: number;
    /** One string per row, one glyph per cell. Sextant glyphs are outside the BMP. */
    text: readonly string[];
    /** One letter per cell: ' ' empty, 'm' mark, 'f' faint mark (thin arcs), 'w' word. */
    ink: readonly string[];
}

export function wordmarkTier(caps: Caps): WordmarkTier {
    if (caps.glyphs === 'ascii') return 'ascii';
    return caps.logo;
}

/** The tallest drawing no taller than `rows`, or the shortest one when none fits. */
export function pickWordmark(tier: WordmarkTier, rows: number): WordmarkArt {
    const arts = WORDMARK_ART[tier];
    let best = arts[0];
    for (const art of arts) if (art.rows <= rows) best = art;
    if (best === undefined) throw new Error(`No wordmark art for tier ${tier}`);
    return best;
}

/**
 * The mark lit in rings that travel outward from the arcs' centre. `phase` is in cycles; each
 * whole cycle moves the rings about four cells. Mark cells on a crest draw 'm', the rest 'f'.
 */
export function pulseInk(art: WordmarkArt, phase: number): string[] {
    let markCols = 0;
    for (const line of art.ink) {
        for (let c = 0; c < line.length; c++) {
            if (line[c] === 'm' || line[c] === 'f') markCols = Math.max(markCols, c);
        }
    }
    const cx = markCols * 0.55;
    const cy = art.rows * 1.05;
    return art.ink.map((line, r) =>
        Array.from(line, (ink, c) => {
            if (ink !== 'm' && ink !== 'f') return ink;
            const d = Math.hypot((c - cx) * 0.5, r - cy);
            return Math.cos((d - phase * 6) * 1.6) > 0 ? 'm' : 'f';
        }).join('')
    );
}

// Turns the Dexto logo (scripts/assets/logo-full.svg) into terminal cells for <Wordmark>.
//
// Nothing is hand-drawn. The SVG is rasterised, split into its two layers (the teal mark and the
// word), and each terminal cell gets the block glyph whose sub-cell mask best matches the logo's
// coverage there. The background is always the terminal's own, so no boxes are painted.
//
// Output: src/signal/wordmark-art.generated.ts, keyed by glyph tier and height in rows.
//
// Run only when the logo changes. sharp is not a repo dependency, so add it for the run and
// revert afterwards:
//   pnpm -F @dexto/tui add -D sharp@0.34.5
//   node packages/tui/scripts/build-wordmark.mjs
//   git checkout packages/tui/package.json pnpm-lock.yaml && pnpm install
import { Buffer } from 'node:buffer';
import console from 'node:console';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import prettier from 'prettier';

const here = dirname(fileURLToPath(import.meta.url));
const SOURCE = join(here, 'assets/logo-full.svg');
const OUTPUT = join(here, '../src/signal/wordmark-art.generated.ts');
/** Terminal cell width over cell height. */
const CELL_ASPECT = 0.45;
const RASTER_W = 6000;
/** Mark cells fitted below this coverage draw in the dim teal, so thin arcs read as thin. */
const FAINT_BELOW = 0.4;
const HEIGHTS = {
    sextant: [2, 3, 4, 5, 6, 8, 10, 12],
    quadrant: [2, 3, 4, 6, 8, 10],
    ascii: [3, 4, 6, 8],
};

async function loadSharp() {
    try {
        return (await import('sharp')).default;
    } catch {
        console.error(
            'build-wordmark needs sharp. See the header of this script for how to run it.'
        );
        process.exit(1);
    }
}

/** The logo has two fill groups: the mark first, then the word. Returns an SVG with only one. */
function layerSvgs(svg) {
    const groups = svg.split('<g fill="');
    const markColor = groups[1].slice(0, 7);
    const wordColor = groups[2].slice(0, 7);
    return {
        onlyMark: svg.replace(`<g fill="${wordColor}"`, '<g fill="none"'),
        onlyWord: svg.replaceAll(`fill="${markColor}"`, 'fill="none"'),
    };
}

async function alphaOf(sharp, svgText) {
    const img = sharp(Buffer.from(svgText), { density: 600 }).resize({ width: RASTER_W });
    const { data, info } = await img
        .ensureAlpha()
        .extractChannel(3)
        .raw()
        .toBuffer({ resolveWithObject: true });
    return { data, w: info.width, h: info.height };
}

/** Summed-area table of coverage, so any box's mean is four lookups. */
function integral({ data, w, h }) {
    const s = new Float64Array((w + 1) * (h + 1));
    for (let y = 0; y < h; y++) {
        let row = 0;
        for (let x = 0; x < w; x++) {
            row += data[y * w + x] / 255;
            s[(y + 1) * (w + 1) + x + 1] = s[y * (w + 1) + x + 1] + row;
        }
    }
    return { s, w, h };
}

function boxMean(I, x0, y0, x1, y1) {
    x0 = Math.max(0, Math.min(I.w, Math.round(x0)));
    x1 = Math.max(0, Math.min(I.w, Math.round(x1)));
    y0 = Math.max(0, Math.min(I.h, Math.round(y0)));
    y1 = Math.max(0, Math.min(I.h, Math.round(y1)));
    const area = (x1 - x0) * (y1 - y0);
    if (area <= 0) return 0;
    const W = I.w + 1;
    return (I.s[y1 * W + x1] - I.s[y0 * W + x1] - I.s[y1 * W + x0] + I.s[y0 * W + x0]) / area;
}

function bbox(A) {
    let x0 = A.w;
    let y0 = A.h;
    let x1 = 0;
    let y1 = 0;
    for (let y = 0; y < A.h; y++) {
        for (let x = 0; x < A.w; x++) {
            if (A.data[y * A.w + x] > 24) {
                x0 = Math.min(x0, x);
                x1 = Math.max(x1, x);
                y0 = Math.min(y0, y);
                y1 = Math.max(y1, y);
            }
        }
    }
    return { x0, y0, x1: x1 + 1, y1: y1 + 1 };
}

// Glyph sets: [char, mask], mask bit i = sub-cell (row * cols + col).
function sextantSet() {
    // U+1FB00 onwards covers 60 patterns, skipping empty, full, left half and right half.
    const out = [
        [' ', 0],
        ['█', 63],
        ['▌', 0b010101],
        ['▐', 0b101010],
    ];
    let cp = 0x1fb00;
    for (let bits = 1; bits < 63; bits++) {
        if (bits === 0b010101 || bits === 0b101010) continue;
        out.push([String.fromCodePoint(cp++), bits]);
    }
    return out;
}

function quadrantSet() {
    const g = ' ▘▝▀▖▌▞▛▗▚▐▜▄▙▟█';
    return Array.from(g, (ch, bits) => [ch, bits]);
}

// The ASCII tier is fitted with quadrants, then each quadrant glyph becomes a lookalike.
const QUAD_TO_ASCII = {
    ' ': ' ',
    '▘': "'",
    '▝': "'",
    '▀': '"',
    '▖': '.',
    '▌': '[',
    '▞': '/',
    '▛': 'F',
    '▗': '.',
    '▚': '\\',
    '▐': ']',
    '▜': '7',
    '▄': '_',
    '▙': 'L',
    '▟': 'J',
    '█': '#',
};

const TIERS = {
    sextant: { cols: 2, rows: 3, set: sextantSet() },
    quadrant: { cols: 2, rows: 2, set: quadrantSet() },
};

/**
 * Fits one layer into `gridRows` sub-rows starting at sub-row `top`, so the logo's edges land on
 * the sub-cell grid. `solid` thresholds coverage, which keeps thin bars whole instead of greyed.
 */
function fitLayer(I, box, tier, tierName, rows, top, gridRows, layer, solid) {
    const subH = (box.y1 - box.y0) / gridRows;
    const cellH = subH * tier.rows;
    const cellW = cellH * CELL_ASPECT;
    const subW = cellW / tier.cols;
    const cols = Math.ceil((box.x1 - box.x0) / cellW - 1e-6);
    const n = tier.cols * tier.rows;
    const y0 = box.y0 - top * subH;
    const x0 = box.x0;
    const grid = [];
    for (let r = 0; r < rows; r++) {
        const line = [];
        for (let c = 0; c < cols; c++) {
            const a = new Float64Array(n);
            for (let sy = 0; sy < tier.rows; sy++) {
                for (let sx = 0; sx < tier.cols; sx++) {
                    const px = x0 + c * cellW + sx * subW;
                    const py = y0 + r * cellH + sy * subH;
                    const v = boxMean(I, px, py, px + subW, py + subH);
                    a[sy * tier.cols + sx] = solid
                        ? v >= 0.42
                            ? 1
                            : 0
                        : rows <= 6
                          ? Math.max(0, Math.min(1, (v - 0.3) / 0.45))
                          : v;
                }
            }
            if (a.reduce((t, v) => t + v, 0) / n < 0.04) {
                line.push([' ', layer, 0]);
                continue;
            }
            let best = null;
            for (const [ch, mask] of tier.set) {
                let on = 0;
                let onSum = 0;
                for (let i = 0; i < n; i++) {
                    if (mask & (1 << i)) {
                        on++;
                        onSum += a[i];
                    }
                }
                const t = on ? onSum / on : 0;
                let err = 0;
                for (let i = 0; i < n; i++) {
                    err += mask & (1 << i) ? (a[i] - t) ** 2 + (1 - t) * 0.15 : a[i] ** 2;
                }
                if (!best || err < best.err) best = { ch, err, t };
            }
            const ch = tierName === 'ascii' ? QUAD_TO_ASCII[best.ch] : best.ch;
            line.push([ch, layer, solid ? 1 : Math.round(best.t * 100) / 100]);
        }
        grid.push(line);
    }
    return { cols, grid };
}

/**
 * The mark's thin arcs survive or vanish depending on where the grid falls, so try small shifts
 * of the grid and keep the one whose glyphs reproduce the logo best.
 */
function bestMarkFit(I, box, tier, tierName, rows, total) {
    const subH = (box.y1 - box.y0) / total;
    const subW = (subH * tier.rows * CELL_ASPECT) / tier.cols;
    let best = null;
    for (let dy = -0.5; dy <= 0.5; dy += 0.25) {
        for (let dx = -0.75; dx <= 0.75; dx += 0.25) {
            const b = {
                x0: box.x0 + dx * subW,
                x1: box.x1 + dx * subW,
                y0: box.y0 + dy * subH,
                y1: box.y1 + dy * subH,
            };
            const f = fitLayer(I, b, tier, tierName, rows, 0, total, 0, false);
            const err = markError(I, b, f, tier, subW, subH);
            if (!best || err < best.err) best = { err, f };
        }
    }
    return best.f;
}

function markError(I, b, f, tier, subW, subH) {
    const masks = new Map(tier.set);
    const toQuad = new Map(Object.entries(QUAD_TO_ASCII).map(([q, a]) => [a, q]));
    let err = 0;
    f.grid.forEach((line, r) =>
        line.forEach(([ch, , t], c) => {
            const m = masks.get(ch) ?? masks.get(toQuad.get(ch)) ?? 0;
            for (let sy = 0; sy < tier.rows; sy++) {
                for (let sx = 0; sx < tier.cols; sx++) {
                    const px = b.x0 + (c * tier.cols + sx) * subW;
                    const py = b.y0 + (r * tier.rows + sy) * subH;
                    const v = boxMean(I, px, py, px + subW, py + subH);
                    err += (v - (m & (1 << (sy * tier.cols + sx)) ? t : 0)) ** 2;
                }
            }
        })
    );
    return err;
}

/** How cleanly the E's three bars land on sub-rows: 1 means every sub-row is all bar or all gap. */
function barCrispness(word, ebox, n) {
    let total = 0;
    for (let i = 0; i < n; i++) {
        const h = (ebox.y1 - ebox.y0) / n;
        const v = boxMean(word, ebox.x0, ebox.y0 + i * h, ebox.x1, ebox.y0 + (i + 1) * h);
        total += Math.abs(v - 0.5) * 2;
    }
    return total / n;
}

/**
 * The word snaps to the crispest height that fits, so the E keeps a gap between its bars. The
 * mark takes the full height, and the gap between them keeps the logo's proportion.
 */
function fit(layers, boxes, rows, tierName) {
    const tier = TIERS[tierName === 'ascii' ? 'quadrant' : tierName];
    const total = rows * tier.rows;
    let wordRows = total;
    let bestScore = -1;
    for (let n = total; n >= Math.max(5, total - 3); n--) {
        const score = barCrispness(layers[1], boxes.e, n);
        if (score > bestScore + 0.02) {
            bestScore = score;
            wordRows = n;
        }
    }
    const top = Math.floor((total - wordRows) / 2);
    const mark = bestMarkFit(layers[0], boxes.mark, tier, tierName, rows, total);
    const word = fitLayer(layers[1], boxes.word, tier, tierName, rows, top, wordRows, 1, true);
    const logoGap = (boxes.word.x0 - boxes.mark.x1) / (boxes.mark.y1 - boxes.mark.y0);
    const gap = Math.max(2, Math.round((logoGap * rows) / CELL_ASPECT));
    const cells = [];
    for (let r = 0; r < rows; r++) {
        cells.push([
            ...mark.grid[r],
            ...Array.from({ length: gap }, () => [' ', 1, 0]),
            ...word.grid[r],
        ]);
    }
    return { rows, cols: mark.cols + gap + word.cols, cells };
}

/** The E's bars, in logo units: x 4000 to 4470 of a word spanning 3230 to 6860. */
function findE(wordBox) {
    const u = (wordBox.x1 - wordBox.x0) / (6860 - 3230);
    return {
        x0: wordBox.x0 + (4000 - 3230) * u,
        x1: wordBox.x0 + (4470 - 3230) * u,
        y0: wordBox.y0,
        y1: wordBox.y1,
    };
}

/** One letter per cell: ' ' empty, 'm' mark, 'f' faint mark, 'w' word. */
function inkOf([ch, layer, t]) {
    if (ch === ' ') return ' ';
    if (layer === 1) return 'w';
    return t >= FAINT_BELOW ? 'm' : 'f';
}

function render(sizes) {
    const lines = [
        '// Generated by packages/tui/scripts/build-wordmark.mjs from the Dexto logo. Do not edit.',
        "import type { WordmarkArt, WordmarkTier } from './wordmark.js';",
        '',
        'export const WORDMARK_ART: Readonly<Record<WordmarkTier, readonly WordmarkArt[]>> = {',
    ];
    for (const [tier, arts] of Object.entries(sizes)) {
        lines.push(`    ${tier}: [`);
        for (const art of arts) {
            lines.push('        {');
            lines.push(`            rows: ${art.rows},`);
            lines.push(`            cols: ${art.cols},`);
            lines.push('            text: [');
            for (const row of art.cells) {
                lines.push(`                ${JSON.stringify(row.map((c) => c[0]).join(''))},`);
            }
            lines.push('            ],');
            lines.push('            ink: [');
            for (const row of art.cells) {
                lines.push(`                ${JSON.stringify(row.map(inkOf).join(''))},`);
            }
            lines.push('            ],');
            lines.push('        },');
        }
        lines.push('    ],');
    }
    lines.push('};', '');
    return lines.join('\n');
}

async function main() {
    const sharp = await loadSharp();
    const { onlyMark, onlyWord } = layerSvgs(readFileSync(SOURCE, 'utf8'));
    const mark = await alphaOf(sharp, onlyMark);
    const word = await alphaOf(sharp, onlyWord);
    const boxes = { mark: bbox(mark), word: bbox(word) };
    boxes.e = findE(boxes.word);
    const layers = [integral(mark), integral(word)];
    const sizes = {};
    for (const [tier, heights] of Object.entries(HEIGHTS)) {
        sizes[tier] = heights.map((h) => fit(layers, boxes, h, tier));
        console.log(tier, sizes[tier].map((a) => `${a.rows}x${a.cols}`).join(' '));
    }
    const options = await prettier.resolveConfig(OUTPUT);
    writeFileSync(OUTPUT, await prettier.format(render(sizes), { ...options, filepath: OUTPUT }));
}

await main();

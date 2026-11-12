/**
 * Unicode → ASCII glyph fallback for terminals without a UTF-8 locale. One table for every
 * Signal part, so a glyph never falls back two different ways.
 */
import type { GlyphTier } from './caps.js';

const ASCII: Readonly<Record<string, string>> = {
    '─': '-',
    '━': '=',
    '│': '|',
    '┃': '|',
    '┆': ':',
    '┊': ':',
    '╎': ':',
    '┄': '-',
    '┈': '-',
    '╌': '-',
    '╭': '.',
    '╮': '.',
    '╰': "'",
    '╯': "'",
    '┌': '+',
    '┐': '+',
    '└': '+',
    '┘': '+',
    '├': '+',
    '┤': '+',
    '┬': '+',
    '┴': '+',
    '┼': '+',
    '╴': '-',
    '╶': '-',
    '╵': "'",
    '╷': '.',
    '╹': "'",
    '╻': '.',
    '╸': '-',
    '╺': '-',
    '═': '=',
    '║': '|',
    '╱': '/',
    '╲': '\\',
    '▏': '|',
    '▕': '|',
    '▎': '|',
    '▍': '|',
    '▌': '|',
    '▐': '|',
    '▔': '-',
    '▁': '_',
    '█': '#',
    '▉': '#',
    '▊': '#',
    '▋': '#',
    '▓': '#',
    '▒': ':',
    '░': '.',
    '▀': '"',
    '▄': '_',
    '▂': '_',
    '▃': '_',
    '▅': '=',
    '▆': '=',
    '▇': '#',
    '▰': '#',
    '▱': '-',
    '▮': '#',
    '▯': '-',
    '■': '#',
    '□': '-',
    '▪': '*',
    '▫': '.',
    '›': '>',
    '‹': '<',
    '»': '>>',
    '▸': '>',
    '▹': '>',
    '▶': '>',
    '◂': '<',
    '◀': '<',
    '▾': 'v',
    '▴': '^',
    '▲': '^',
    '▼': 'v',
    '△': '^',
    '▽': 'v',
    '◆': '*',
    '◇': 'o',
    '◈': '*',
    '●': '*',
    '○': 'o',
    '◌': 'o',
    '◍': 'o',
    '◉': '@',
    '◎': 'o',
    '•': '*',
    '·': '.',
    '∙': '.',
    '⋅': '.',
    '✓': '+',
    '✔': '+',
    '✕': 'x',
    '✗': 'x',
    '×': 'x',
    '…': '.',
    '→': '>',
    '←': '<',
    '↑': '^',
    '↓': 'v',
    '↳': '>',
    '↵': '<',
    '⏎': '<',
    '⇧': '^',
    '⌃': '^',
    '⌘': '#',
    '⎇': '@',
    '±': '+',
    '−': '-',
    '–': '-',
    '—': '-',
    '≡': '=',
    '⌁': '~',
    '∿': '~',
    '⟡': '*',
    '⊕': '+',
    '“': '"',
    '”': '"',
    '‘': "'",
    '’': "'",
    '⟩': '>',
    '⟨': '<',
    '❯': '>',
    '⌕': '?',
    '⊘': '0',
    '⏸': '"',
    '⏹': '#',
    '⏵': '>',
    '◢': '/',
    '◣': '\\',
    '◤': '\\',
    '◥': '/',
    '◖': '(',
    '◗': ')',
    '⧗': 'X',
    '⌛': 'X',
    '⚑': 'P',
    '✦': '*',
    '✧': '*',
    '∞': '8',
};

/** Braille cells (spinners, traces) reduce to the dots' rough position. */
function brailleToAscii(cp: number): string {
    const b = cp - 0x2800;
    if (!b) return ' ';
    const top = b & 0x09;
    const up = b & 0x12;
    const low = b & 0x24;
    const bot = b & 0xc0;
    if (top && bot) return '|';
    if (top) return "'";
    if (bot) return '_';
    if (up && low) return ':';
    if (up) return '-';
    return '.';
}

/** `text` as this terminal can draw it: unchanged for unicode, mapped char by char for ascii. */
export function glyphText(text: string, tier: GlyphTier): string {
    if (tier === 'unicode') return text;
    let out = '';
    for (const ch of text) {
        const cp = ch.codePointAt(0) ?? 0;
        if (cp >= 0x2800 && cp <= 0x28ff) out += brailleToAscii(cp);
        else out += ASCII[ch] ?? ch;
    }
    return out;
}

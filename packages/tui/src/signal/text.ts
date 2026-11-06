/**
 * Signal for commands that print and exit (sign-in, whoami, help, errors, notices): the same
 * roles, glyphs, cut type and wordmark as the TUI, as plain strings. No Ink, so a command can
 * draw a screen without starting a React tree.
 *
 * A line is a list of spans. Widths come from the spans' text, so a row can be padded or
 * right-aligned before its escapes are added.
 *
 * Plain output (not a TTY, or NO_COLOR) gets no colour, no links, no wordmark and no cut type:
 * the same words on plain lines.
 */
import stringWidth from 'string-width';
import stripAnsi from 'strip-ansi';
import { getCaps } from './caps.js';
import { cutLines } from './cut.js';
import { glyphText } from './glyphs.js';
import { paint } from './paint.js';
import type { Role } from './tone.js';
import { pickWordmark, wordmarkTier } from './wordmark.js';

export { detectCaps, getCaps, setCaps, type Caps } from './caps.js';
export type { Role } from './tone.js';

/** On until the Signal look ships: DEXTO_PALETTE=signal. Legacy screens are unchanged. */
export function signalOn(): boolean {
    return getCaps().palette === 'signal';
}

/** Whether this terminal gets colour, links, the wordmark and cut type. */
export function richOutput(): boolean {
    const caps = getCaps();
    return caps.tty && caps.color !== 'none';
}

export interface Span {
    readonly text: string;
    readonly role: Role;
    readonly bold: boolean;
    /** A link target: the text is drawn underlined and wrapped in OSC 8. */
    readonly href: string | null;
}

export function span(role: Role, text: string): Span {
    return { text, role, bold: false, href: null };
}

export function strong(role: Role, text: string): Span {
    return { text, role, bold: true, href: null };
}

/** A link on Dexto cloud: `cloud`, underlined, OSC 8 to `href`, its text printed too. */
export function link(href: string, text: string = href): Span {
    return { text, role: 'cloud', bold: false, href };
}

/** Text in this terminal's glyphs: `◆` stays `◆` on UTF-8 and becomes `*` on ASCII. */
export function glyph(text: string): string {
    return glyphText(text, getCaps().glyphs);
}

/** Cells the spans take on screen. */
export function spansWidth(spans: readonly Span[]): number {
    return spans.reduce((width, each) => width + stringWidth(glyph(safeText(each.text))), 0);
}

// C0 (with DEL) and C1 controls. Tab, newline and carriage return become a space, so words
// stay apart; the rest are dropped.
const SPACING_CONTROLS = /[\t\n\r]/gu;
// eslint-disable-next-line no-control-regex
const CONTROLS = /[\u0000-\u001F\u007F-\u009F]/gu;

/**
 * Text with its control characters taken out. Span text can come from a server (a name, an
 * error message), and an ESC or C1 in it could move the cursor, rewrite the title or start a
 * link of its own.
 */
export function safeText(text: string): string {
    return text.replace(SPACING_CONTROLS, ' ').replace(CONTROLS, '');
}

/**
 * The link target for OSC 8: an http(s) URL with no control characters, which could end the
 * escape early. Anything else (`file:`, `javascript:`, a URL that doesn't parse, an ESC or BEL
 * in it) is null, and the text is drawn without a link.
 */
export function safeHref(href: string): string | null {
    let parsed: URL;
    try {
        parsed = new URL(href);
    } catch {
        return null;
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    return href === safeText(href) ? href : null;
}

function drawSpan(each: Span): string {
    const text = glyph(safeText(each.text));
    if (!richOutput() || text === '') return text;
    let chalk = paint(each.role);
    if (each.bold) chalk = chalk.bold;
    if (each.href === null) return chalk(text);
    const href = safeHref(each.href);
    if (href === null) return chalk.underline(text);
    return `\u001B]8;;${href}\u0007${chalk.underline(text)}\u001B]8;;\u0007`;
}

/** Cells a drawn line takes on screen, escapes left out. */
export function drawnWidth(text: string): number {
    return stringWidth(stripAnsi(text));
}

/**
 * Lines for a stream other than stdout, where the caps were read: the escapes are dropped when
 * that stream isn't a terminal (`dexto login 2> log`).
 */
export function forStream(isTTY: boolean, lines: readonly string[]): string[] {
    return isTTY ? [...lines] : lines.map((each) => stripAnsi(each));
}

/** One line of spans, drawn for this terminal. */
export function line(spans: readonly Span[]): string {
    return spans.map(drawSpan).join('');
}

/** `left` and `right` on one row `columns` wide; `right` drops to the next row when both don't fit. */
export function spread(left: readonly Span[], right: readonly Span[], columns: number): string[] {
    const gap = columns - spansWidth(left) - spansWidth(right);
    if (gap < 2) return [line(left), line(right)];
    return [line([...left, span('fg', ' '.repeat(gap)), ...right])];
}

/** `P R E F L I G H T`: a section label. */
export function letterspaced(label: string): string {
    return [...label.toUpperCase()].join(' ');
}

/** A title in cut type, 3 rows; one bold word on plain output and ASCII terminals. */
export function cutRows(text: string, role: Role = 'hi'): string[] {
    if (!richOutput() || getCaps().glyphs === 'ascii')
        return [line([strong(role, text.toUpperCase())])];
    return cutLines(text).map((row) => line([span(role, row)]));
}

const WORDMARK_INK: Readonly<Record<string, Role>> = { m: 'teal', f: 'tealDim', w: 'hi' };

/**
 * The wordmark's height on a start screen: 3 rows under 100 columns, 10 on a big terminal, 6
 * otherwise; null under 44 columns, where `dexto` is printed instead.
 */
export function wordmarkRowsFor(columns: number, rows: number): number | null {
    if (columns < 44) return null;
    if (columns < 100) return 3;
    if (columns >= 140 && rows >= 40) return 10;
    return 6;
}

/** The Dexto wordmark no taller than `rows`; `dexto` in bold on plain output. */
export function wordmarkRows(rows: number): string[] {
    if (!richOutput()) return [line([strong('hi', 'dexto')])];
    const art = pickWordmark(wordmarkTier(getCaps()), rows);
    return art.text.map((row, r) => {
        const ink = art.ink[r] ?? '';
        const spans: Span[] = [];
        Array.from(row).forEach((cell, c) => {
            const role = WORDMARK_INK[ink[c] ?? ' '] ?? 'fg';
            const last = spans[spans.length - 1];
            if (last !== undefined && last.role === role)
                spans[spans.length - 1] = span(role, last.text + cell);
            else spans.push(span(role, cell));
        });
        return line(spans).trimEnd();
    });
}

const SPINNER = '⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏';

/** The spinner cell for this tick; still with reduced motion. */
export function spinnerFrame(tick: number): string {
    if (getCaps().motion === 'reduced') return glyph('⠿');
    const frames = [...SPINNER];
    return glyph(frames[tick % frames.length] ?? '⠿');
}

/** `m:ss`. */
export function clock(ms: number): string {
    const seconds = Math.max(0, Math.round(ms / 1000));
    return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

/**
 * A notice or fault block: a bar, a label padded to 8, then the text. Fault rows after the first
 * use the dim bar.
 */
export interface BarRow {
    readonly bar: Role;
    readonly label: Span;
    readonly text: readonly Span[];
}

const BAR_LABEL_CELLS = 8;

export function barLines(rows: readonly BarRow[], indent = 2): string[] {
    return rows.map((row) =>
        line([
            span('fg', ' '.repeat(indent)),
            span(row.bar, '▌'),
            span('fg', ' '),
            { ...row.label, text: row.label.text.padEnd(BAR_LABEL_CELLS) },
            ...row.text,
        ]).trimEnd()
    );
}

/** `▌ UPDATE  text`: a notice (out of credits, a new version). */
export function noticeLines(label: string, text: readonly Span[], indent = 2): string[] {
    return barLines([{ bar: 'amberDim', label: strong('amber', label), text }], indent);
}

export interface Fault {
    readonly message: string;
    /** The API's own error code, shown after the message. */
    readonly apiCode: string | null;
    /** Details as one JSON line. */
    readonly details: string | null;
    /** The command that fixes it. */
    readonly fix: string | null;
}

/** `▌ FAULT  message · code`, then details and the fix, on rows with a dim bar. */
export function faultLines(fault: Fault, indent = 2): string[] {
    const title = fault.apiCode === null ? fault.message : `${fault.message} · ${fault.apiCode}`;
    const rows: BarRow[] = [
        { bar: 'red', label: strong('red', 'FAULT'), text: [strong('hi', title)] },
    ];
    if (fault.details !== null)
        rows.push({
            bar: 'redDim',
            label: span('dim', 'details'),
            text: [span('dim', fault.details)],
        });
    if (fault.fix !== null)
        rows.push({ bar: 'redDim', label: span('dim', 'next'), text: [span('amber', fault.fix)] });
    return barLines(rows, indent);
}

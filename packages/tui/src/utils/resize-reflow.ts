/**
 * Resize without wiping scrollback (inline mode).
 *
 * Ink redraws its live region by erasing as many rows as it last wrote. When the terminal gets
 * narrower, the terminal rewraps those rows first, so the region now takes more rows than Ink
 * erases and the top of the old frame is left behind. The usual fix clears the whole terminal,
 * scrollback included, and reprints the transcript.
 *
 * Instead, this keeps the last frame Ink wrote and, on a shrink, runs before Ink's own resize
 * handler: it erases the rewrapped frame, then moves the cursor down so Ink's erase of its old
 * row count lands on the same top row. Transcript lines above the frame are never touched.
 *
 * Assumes the terminal rewraps on resize, as current terminals do (iTerm2, Terminal.app, kitty,
 * WezTerm, Ghostty, Windows Terminal, VTE, tmux).
 */
import stringWidth from 'string-width';
import stripAnsi from 'strip-ansi';

const CSI = '\u001B[';
const ERASE_LINE = `${CSI}2K`;
const CURSOR_UP = `${CSI}1A`;
const CURSOR_LEFT = `${CSI}G`;
// Ink's log-update prefixes each frame with these to erase the previous one.
const ERASE_PARTS = [ERASE_LINE, CURSOR_UP, CURSOR_LEFT];

function stripLeadingErase(chunk: string): string {
    let rest = chunk;
    for (;;) {
        const part = ERASE_PARTS.find((p) => rest.startsWith(p));
        if (part === undefined) return rest;
        rest = rest.slice(part.length);
    }
}

/** Same as ansi-escapes' eraseLines: erase `count` rows upward, cursor at the top row's start. */
function eraseLines(count: number): string {
    let out = '';
    for (let i = 0; i < count; i++) out += ERASE_LINE + (i < count - 1 ? CURSOR_UP : '');
    return count > 0 ? out + CURSOR_LEFT : '';
}

/** Rows `frame` (ending in a newline, as Ink writes it) takes at `columns` once rewrapped. */
export function reflowedRows(frame: string, columns: number): number {
    const cols = Math.max(1, columns);
    return frame
        .split('\n')
        .reduce(
            (rows, line) => rows + Math.max(1, Math.ceil(stringWidth(stripAnsi(line)) / cols)),
            0
        );
}

/**
 * Escape sequence that clears `frame` after a shrink to `columns`, leaving the cursor where
 * Ink's next erase of the frame's own row count ends on the frame's top row. '' if nothing wraps.
 */
export function shrinkRepair(frame: string, columns: number): string {
    const inkRows = frame.split('\n').length;
    const rows = reflowedRows(frame, columns);
    if (rows <= inkRows) return '';
    return eraseLines(rows) + (inkRows > 1 ? `${CSI}${inkRows - 1}B` : '');
}

export interface KeptScrollback {
    /** Hand this to Ink's render() as `stdout`. */
    stdout: NodeJS.WriteStream;
    dispose: () => void;
}

/**
 * Wrap `real` so the last frame written through it is remembered, and repair shrinks before
 * any other resize listener (Ink's) runs.
 */
export function keepScrollbackOnResize(real: NodeJS.WriteStream): KeptScrollback {
    let lastFrame = '';
    let columns = real.columns || 80;

    const write = (chunk: unknown, ...rest: unknown[]): boolean => {
        if (typeof chunk === 'string' && chunk !== '') lastFrame = stripLeadingErase(chunk);
        return (real.write as (...args: unknown[]) => boolean)(chunk, ...rest);
    };

    const onResize = () => {
        const next = real.columns || 80;
        if (next < columns && lastFrame !== '') {
            const repair = shrinkRepair(lastFrame, next);
            if (repair !== '') real.write(repair);
        }
        columns = next;
    };
    real.prependListener('resize', onResize);

    const stdout = new Proxy(real, {
        get(target, prop, receiver) {
            if (prop === 'write') return write;
            const value: unknown = Reflect.get(target, prop, receiver);
            return typeof value === 'function' ? value.bind(target) : value;
        },
    });

    return {
        stdout,
        dispose: () => {
            real.off('resize', onResize);
        },
    };
}

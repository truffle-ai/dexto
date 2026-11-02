/**
 * Asks the terminal for its background colour (OSC 11) so the Signal palette picks its dark or
 * light set from what is actually on screen, not from COLORFGBG alone.
 *
 * The query is followed by DA1 (primary device attributes), which every terminal answers. That
 * reply marks the end: a terminal that ignores OSC 11 costs one round trip, not the timeout.
 * Runs once at start-up, before Ink takes stdin.
 */
import { getCaps, setCaps, type Caps, type ThemeName } from './caps.js';

export const BACKGROUND_QUERY = '\x1b]11;?\x07\x1b[c';

/** How long to wait for a terminal that answers neither query (a pipe dressed as a TTY). */
export const BACKGROUND_TIMEOUT_MS = 250;

// eslint-disable-next-line no-control-regex -- matching terminal escape sequences
const OSC11_REPLY = /\x1b\]11;rgba?:([0-9a-f]{1,4})\/([0-9a-f]{1,4})\/([0-9a-f]{1,4})/i;
// eslint-disable-next-line no-control-regex -- matching terminal escape sequences
const DA1_REPLY = /\x1b\[\?[\d;]*c/;

/** A channel of 1 to 4 hex digits, scaled to 0–1 (X11 colour spec). */
function channel(hex: string): number {
    return parseInt(hex, 16) / (16 ** hex.length - 1);
}

/** The theme for an OSC 11 reply found anywhere in `data`, or null when there is none. */
export function parseBackgroundReply(data: string): ThemeName | null {
    const match = OSC11_REPLY.exec(data);
    if (match === null) return null;
    const [r, g, b] = [match[1], match[2], match[3]].map((hex) => channel(hex ?? ''));
    if (r === undefined || g === undefined || b === undefined) return null;
    return 0.2126 * r + 0.7152 * g + 0.0722 * b >= 0.5 ? 'light' : 'dark';
}

/** Only the Signal palette reads the theme, and only a colour TTY can answer. */
export function shouldQueryBackground(caps: Caps, stdinIsTTY: boolean): boolean {
    return caps.palette === 'signal' && caps.color !== 'none' && caps.tty && stdinIsTTY;
}

export interface TerminalIO {
    stdin: NodeJS.ReadableStream & {
        isTTY?: boolean;
        isRaw?: boolean;
        setRawMode?: (mode: boolean) => unknown;
    };
    stdout: { write: (chunk: string) => boolean };
}

/**
 * Sends the query and resolves with the background's theme, or null when the terminal does not
 * say. Leaves stdin paused and in the raw mode it found it in.
 */
export function queryBackgroundTheme(io: TerminalIO, timeoutMs: number): Promise<ThemeName | null> {
    const { stdin, stdout } = io;
    const wasRaw = stdin.isRaw === true;
    return new Promise((resolve) => {
        let received = '';
        const finish = () => {
            clearTimeout(timer);
            stdin.removeListener('data', onData);
            stdin.setRawMode?.(wasRaw);
            stdin.pause();
            resolve(parseBackgroundReply(received));
        };
        const onData = (chunk: Buffer | string) => {
            received += String(chunk);
            if (DA1_REPLY.test(received)) finish();
        };
        const timer = setTimeout(finish, timeoutMs);
        stdin.setRawMode?.(true);
        stdin.on('data', onData);
        stdin.resume();
        stdout.write(BACKGROUND_QUERY);
    });
}

/** Refines the process-wide caps' theme from the terminal's background, when it can tell. */
export async function detectBackgroundTheme(io: TerminalIO): Promise<void> {
    const caps = getCaps();
    if (!shouldQueryBackground(caps, io.stdin.isTTY === true)) return;
    const theme = await queryBackgroundTheme(io, BACKGROUND_TIMEOUT_MS);
    if (theme !== null && theme !== caps.theme) setCaps({ ...getCaps(), theme });
}

/**
 * Asks the terminal for its background colour (OSC 11) so the Signal palette picks its dark or
 * light set from what is actually on screen, not from COLORFGBG alone.
 *
 * The query is followed by DA1 (primary device attributes), which every terminal answers. That
 * reply marks the end: a terminal that ignores OSC 11 costs one round trip, not the timeout.
 * Runs once at start-up, before Ink takes stdin.
 */
import { StringDecoder } from 'node:string_decoder';
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
 * say. Bytes that are not part of a reply (keys typed during start-up) go back onto stdin for
 * Ink to read. Leaves stdin paused and in the raw mode it found it in.
 */
export function queryBackgroundTheme(io: TerminalIO, timeoutMs: number): Promise<ThemeName | null> {
    const { stdin, stdout } = io;
    const wasRaw = stdin.isRaw === true;
    return new Promise((resolve) => {
        const decoder = new StringDecoder('utf8');
        let received = '';
        const finish = () => {
            clearTimeout(timer);
            stdin.removeListener('data', onData);
            stdin.setRawMode?.(wasRaw);
            stdin.pause();
            received += decoder.end();
            const typed = createTerminalReplyFilter()(received);
            if (typed !== '') stdin.unshift(Buffer.from(typed, 'utf8'));
            resolve(parseBackgroundReply(received));
        };
        const onData = (chunk: Buffer | string) => {
            received += typeof chunk === 'string' ? chunk : decoder.write(chunk);
            if (DA1_REPLY.test(received)) finish();
        };
        const timer = setTimeout(finish, timeoutMs);
        stdin.setRawMode?.(true);
        stdin.on('data', onData);
        stdin.resume();
        stdout.write(BACKGROUND_QUERY);
    });
}

/** Where a terminal reply starting at `at` (an ESC) ends, whether it may still be arriving, or not a reply. */
type ReplyScan = number | 'partial' | 'none';

/** Longest reply the filter will wait for; real ones are about 30 characters. */
const MAX_REPLY_LENGTH = 64;

/** OSC 10 or 11 reply: ESC ] 1 0|1 ; <colour spec> BEL|ST. A bare ESC ] is Alt+], not a reply. */
function scanOscReply(s: string, at: number): ReplyScan {
    if (s.length < at + 3) return 'none';
    for (let k = 2; k < 5; k++) {
        const ch = s[at + k];
        if (ch === undefined) return 'partial';
        const ok = k === 2 ? ch === '1' : k === 3 ? ch === '0' || ch === '1' : ch === ';';
        if (!ok) return 'none';
    }
    for (let i = at + 5; i < s.length && i - at <= MAX_REPLY_LENGTH; i++) {
        const ch = s[i] ?? '';
        if (ch === '\x07') return i + 1;
        if (ch === '\x1b') {
            const next = s[i + 1];
            if (next === undefined) return 'partial';
            return next === '\\' ? i + 2 : 'none';
        }
        if (!/[0-9a-z:/]/i.test(ch)) return 'none';
    }
    return s.length - at > MAX_REPLY_LENGTH ? 'none' : 'partial';
}

/** DA1 reply: ESC [ ? <digits and ;> c. No key sends ESC [ ?. */
function scanDa1Reply(s: string, at: number): ReplyScan {
    if (s[at + 2] !== '?') return 'none';
    for (let i = at + 3; i < s.length && i - at <= MAX_REPLY_LENGTH; i++) {
        const ch = s[i] ?? '';
        if (ch === 'c') return i + 1;
        if (!/[\d;]/.test(ch)) return 'none';
    }
    return s.length - at > MAX_REPLY_LENGTH ? 'none' : 'partial';
}

function scanReply(s: string, at: number): ReplyScan {
    const kind = s[at + 1];
    if (kind === ']') return scanOscReply(s, at);
    if (kind === '[') return scanDa1Reply(s, at);
    return 'none';
}

/**
 * Removes OSC 10/11 and DA1 replies from keyboard input, holding back the start of one that is
 * split across chunks. Sits in front of the keypress parser so a reply that arrives after
 * `queryBackgroundTheme` gave up never becomes prompt text. One filter per input stream.
 */
export function createTerminalReplyFilter(): (data: string) => string {
    let held = '';
    return (data) => {
        const input = held + data;
        held = '';
        let out = '';
        let i = 0;
        while (i < input.length) {
            const esc = input.indexOf('\x1b', i);
            if (esc === -1) {
                out += input.slice(i);
                break;
            }
            out += input.slice(i, esc);
            const end = scanReply(input, esc);
            if (end === 'partial') {
                held = input.slice(esc);
                break;
            }
            if (end === 'none') {
                out += '\x1b';
                i = esc + 1;
            } else {
                i = end;
            }
        }
        return out;
    };
}

/** Refines the process-wide caps' theme from the terminal's background, when it can tell. */
export async function detectBackgroundTheme(io: TerminalIO): Promise<void> {
    const caps = getCaps();
    if (!shouldQueryBackground(caps, io.stdin.isTTY === true)) return;
    const theme = await queryBackgroundTheme(io, BACKGROUND_TIMEOUT_MS);
    if (theme !== null && theme !== caps.theme) setCaps({ ...getCaps(), theme });
}

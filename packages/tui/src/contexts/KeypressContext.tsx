/**
 * KeypressContext
 *
 * Provides keyboard input handling by reading stdin directly.
 * Filters out mouse events before broadcasting to subscribers.
 *
 * This replaces Ink's useInput hook with a custom implementation that:
 * 1. Reads stdin directly for full control over escape sequence parsing
 * 2. Filters out mouse events so they don't interfere with keyboard handlers
 * 3. Handles paste buffering and backslash+enter detection
 */

import { useStdin } from 'ink';
import type React from 'react';
import { createContext, useCallback, useContext, useEffect, useRef } from 'react';
import { ESC, FOCUS_IN, FOCUS_OUT } from '../utils/input.js';
import { parseMouseEvent } from '../utils/mouse.js';

export const BACKSLASH_ENTER_TIMEOUT = 5;
export const ESC_TIMEOUT = 50;
export const PASTE_TIMEOUT = 30_000;

// Key name mapping for escape sequences
const KEY_INFO_MAP: Record<string, { name: string; shift?: boolean; ctrl?: boolean }> = {
    '[200~': { name: 'paste-start' },
    '[201~': { name: 'paste-end' },
    '[[A': { name: 'f1' },
    '[[B': { name: 'f2' },
    '[[C': { name: 'f3' },
    '[[D': { name: 'f4' },
    '[[E': { name: 'f5' },
    '[1~': { name: 'home' },
    '[2~': { name: 'insert' },
    '[3~': { name: 'delete' },
    '[4~': { name: 'end' },
    '[5~': { name: 'pageup' },
    '[6~': { name: 'pagedown' },
    '[7~': { name: 'home' },
    '[8~': { name: 'end' },
    '[11~': { name: 'f1' },
    '[12~': { name: 'f2' },
    '[13~': { name: 'f3' },
    '[14~': { name: 'f4' },
    '[15~': { name: 'f5' },
    '[17~': { name: 'f6' },
    '[18~': { name: 'f7' },
    '[19~': { name: 'f8' },
    '[20~': { name: 'f9' },
    '[21~': { name: 'f10' },
    '[23~': { name: 'f11' },
    '[24~': { name: 'f12' },
    '[A': { name: 'up' },
    '[B': { name: 'down' },
    '[C': { name: 'right' },
    '[D': { name: 'left' },
    '[E': { name: 'clear' },
    '[F': { name: 'end' },
    '[H': { name: 'home' },
    '[P': { name: 'f1' },
    '[Q': { name: 'f2' },
    '[R': { name: 'f3' },
    '[S': { name: 'f4' },
    OA: { name: 'up' },
    OB: { name: 'down' },
    OC: { name: 'right' },
    OD: { name: 'left' },
    OE: { name: 'clear' },
    OF: { name: 'end' },
    OH: { name: 'home' },
    OP: { name: 'f1' },
    OQ: { name: 'f2' },
    OR: { name: 'f3' },
    OS: { name: 'f4' },
    '[[5~': { name: 'pageup' },
    '[[6~': { name: 'pagedown' },
    '[9u': { name: 'tab' },
    '[13u': { name: 'return' },
    '[27u': { name: 'escape' },
    '[127u': { name: 'backspace' },
    '[57414u': { name: 'return' }, // Numpad Enter
    '[a': { name: 'up', shift: true },
    '[b': { name: 'down', shift: true },
    '[c': { name: 'right', shift: true },
    '[d': { name: 'left', shift: true },
    '[e': { name: 'clear', shift: true },
    '[2$': { name: 'insert', shift: true },
    '[3$': { name: 'delete', shift: true },
    '[5$': { name: 'pageup', shift: true },
    '[6$': { name: 'pagedown', shift: true },
    '[7$': { name: 'home', shift: true },
    '[8$': { name: 'end', shift: true },
    '[Z': { name: 'tab', shift: true },
    Oa: { name: 'up', ctrl: true },
    Ob: { name: 'down', ctrl: true },
    Oc: { name: 'right', ctrl: true },
    Od: { name: 'left', ctrl: true },
    Oe: { name: 'clear', ctrl: true },
    '[2^': { name: 'insert', ctrl: true },
    '[3^': { name: 'delete', ctrl: true },
    '[5^': { name: 'pageup', ctrl: true },
    '[6^': { name: 'pagedown', ctrl: true },
    '[7^': { name: 'home', ctrl: true },
    '[8^': { name: 'end', ctrl: true },
};

// Mac Alt key character mapping
const MAC_ALT_KEY_CHARACTER_MAP: Record<string, string> = {
    '\u222B': 'b', // "∫" back one word
    '\u0192': 'f', // "ƒ" forward one word
    '\u00B5': 'm', // "µ" toggle markup view
};

const kUTF16SurrogateThreshold = 0x10000;
function charLengthAt(str: string, i: number): number {
    if (str.length <= i) return 1;
    const code = str.codePointAt(i);
    return code !== undefined && code >= kUTF16SurrogateThreshold ? 2 : 1;
}

export interface Key {
    name: string;
    ctrl: boolean;
    meta: boolean;
    shift: boolean;
    paste: boolean;
    insertable: boolean;
    sequence: string;
}

export type KeypressHandler = (key: Key) => void;

interface KeypressContextValue {
    subscribe: (handler: KeypressHandler) => void;
    unsubscribe: (handler: KeypressHandler) => void;
}

const KeypressContext = createContext<KeypressContextValue | undefined>(undefined);

export function useKeypressContext() {
    const context = useContext(KeypressContext);
    if (!context) {
        throw new Error('useKeypressContext must be used within a KeypressProvider');
    }
    return context;
}

/**
 * Filter out non-keyboard events (mouse, focus) before passing to handler
 */
function nonKeyboardEventFilter(keypressHandler: KeypressHandler): KeypressHandler {
    return (key: Key) => {
        if (
            !parseMouseEvent(key.sequence) &&
            key.sequence !== FOCUS_IN &&
            key.sequence !== FOCUS_OUT
        ) {
            keypressHandler(key);
        }
    };
}

/**
 * Buffer backslash followed by enter as shift+enter (newline)
 */
function bufferBackslashEnter(keypressHandler: KeypressHandler): (key: Key | null) => void {
    const bufferer = (function* (): Generator<void, void, Key | null> {
        while (true) {
            const key = yield;

            if (key == null) {
                continue;
            } else if (key.sequence !== '\\') {
                keypressHandler(key);
                continue;
            }

            const timeoutId = setTimeout(() => bufferer.next(null), BACKSLASH_ENTER_TIMEOUT);
            const nextKey = yield;
            clearTimeout(timeoutId);

            if (nextKey === null) {
                keypressHandler(key);
            } else if (nextKey.name === 'return') {
                keypressHandler({
                    ...nextKey,
                    shift: true,
                    sequence: '\r',
                });
            } else {
                keypressHandler(key);
                keypressHandler(nextKey);
            }
        }
    })();

    bufferer.next(); // Prime the generator
    return (key: Key | null) => bufferer.next(key);
}

/**
 * Buffer paste events between paste-start and paste-end sequences
 */
function bufferPaste(keypressHandler: KeypressHandler): (key: Key | null) => void {
    const bufferer = (function* (): Generator<void, void, Key | null> {
        while (true) {
            let key = yield;

            if (key === null) {
                continue;
            } else if (key.name !== 'paste-start') {
                keypressHandler(key);
                continue;
            }

            let buffer = '';
            while (true) {
                const timeoutId = setTimeout(() => bufferer.next(null), PASTE_TIMEOUT);
                key = yield;
                clearTimeout(timeoutId);

                if (key === null) {
                    // Paste timeout - emit what we have
                    break;
                }

                if (key.name === 'paste-end') {
                    break;
                }
                buffer += key.sequence;
            }

            if (buffer.length > 0) {
                keypressHandler({
                    name: '',
                    ctrl: false,
                    meta: false,
                    shift: false,
                    paste: true,
                    insertable: true,
                    sequence: buffer,
                });
            }
        }
    })();
    bufferer.next(); // Prime the generator
    return (key: Key | null) => bufferer.next(key);
}

/**
 * Create a data listener that parses raw stdin into keypress events
 */
function createDataListener(keypressHandler: KeypressHandler) {
    const parser = emitKeys(keypressHandler);
    parser.next(); // Prime the generator

    let timeoutId: NodeJS.Timeout;
    return (data: string) => {
        clearTimeout(timeoutId);
        for (const char of data) {
            parser.next(char);
        }
        if (data.length !== 0) {
            timeoutId = setTimeout(() => parser.next(''), ESC_TIMEOUT);
        }
    };
}

/**
 * Generator that translates raw keypress characters into key events.
 * Buffers escape sequences until complete or timeout.
 */
function* emitKeys(keypressHandler: KeypressHandler): Generator<void, void, string> {
    while (true) {
        let ch = yield;
        let sequence = ch;
        let escaped = false;

        let name = undefined;
        let ctrl = false;
        let meta = false;
        let shift = false;
        let code = undefined;
        let insertable = false;

        if (ch === ESC) {
            escaped = true;
            ch = yield;
            sequence += ch;

            if (ch === ESC) {
                ch = yield;
                sequence += ch;
            }
        }

        if (escaped && (ch === 'O' || ch === '[')) {
            // ANSI escape sequence
            code = ch;
            let modifier = 0;

            if (ch === 'O') {
                // ESC O letter or ESC O modifier letter
                ch = yield;
                sequence += ch;

                if (ch >= '0' && ch <= '9') {
                    modifier = parseInt(ch, 10) - 1;
                    ch = yield;
                    sequence += ch;
                }

                code += ch;
            } else if (ch === '[') {
                // ESC [ sequences
                ch = yield;
                sequence += ch;

                if (ch === '[') {
                    code += ch;
                    ch = yield;
                    sequence += ch;
                }

                const cmdStart = sequence.length - 1;

                // Collect digits
                while (ch >= '0' && ch <= '9') {
                    ch = yield;
                    sequence += ch;
                }

                // Handle modifiers
                if (ch === ';') {
                    while (ch === ';') {
                        ch = yield;
                        sequence += ch;

                        while (ch >= '0' && ch <= '9') {
                            ch = yield;
                            sequence += ch;
                        }
                    }
                } else if (ch === '<') {
                    // SGR mouse mode - consume until m/M
                    ch = yield;
                    sequence += ch;
                    while (ch === '' || ch === ';' || (ch >= '0' && ch <= '9')) {
                        ch = yield;
                        sequence += ch;
                    }
                } else if (ch === 'M') {
                    // X11 mouse mode - 3 bytes after M
                    ch = yield;
                    sequence += ch;
                    ch = yield;
                    sequence += ch;
                    ch = yield;
                    sequence += ch;
                }

                const cmd = sequence.slice(cmdStart);
                let match;

                if ((match = /^(\d+)(?:;(\d+))?(?:;(\d+))?([~^$u])$/.exec(cmd))) {
                    if (match[1] === '27' && match[3] && match[4] === '~') {
                        // modifyOtherKeys format
                        code += match[3] + 'u';
                        modifier = parseInt(match[2] ?? '1', 10) - 1;
                    } else {
                        code += (match[1] ?? '') + (match[4] ?? '');
                        modifier = parseInt(match[2] ?? '1', 10) - 1;
                    }
                } else if ((match = /^(\d+)?(?:;(\d+))?([A-Za-z])$/.exec(cmd))) {
                    code += match[3] ?? '';
                    modifier = parseInt(match[2] ?? match[1] ?? '1', 10) - 1;
                } else {
                    code += cmd;
                }
            }

            // Parse modifiers (xterm encoding: shift=1, meta/alt=2, ctrl=4)
            ctrl = !!(modifier & 4);
            meta = !!(modifier & 2);
            shift = !!(modifier & 1);

            const keyInfo = KEY_INFO_MAP[code];
            if (keyInfo) {
                name = keyInfo.name;
                if (keyInfo.shift) shift = true;
                if (keyInfo.ctrl) ctrl = true;
            } else {
                name = 'undefined';
                if ((ctrl || meta) && (code.endsWith('u') || code.endsWith('~'))) {
                    const codeNumber = parseInt(code.slice(1, -1), 10);
                    if (codeNumber >= 'a'.charCodeAt(0) && codeNumber <= 'z'.charCodeAt(0)) {
                        name = String.fromCharCode(codeNumber);
                    }
                }
            }
        } else if (ch === '\r') {
            name = 'return';
            meta = escaped;
        } else if (ch === '\n') {
            name = 'enter';
            meta = escaped;
        } else if (ch === '\t') {
            name = 'tab';
            meta = escaped;
        } else if (ch === '\b' || ch === '\x7f') {
            name = 'backspace';
            meta = escaped;
        } else if (ch === ESC) {
            name = 'escape';
            meta = escaped;
        } else if (ch === ' ') {
            name = 'space';
            meta = escaped;
            insertable = true;
        } else if (!escaped && ch <= '\x1a') {
            // ctrl+letter
            name = String.fromCharCode(ch.charCodeAt(0) + 'a'.charCodeAt(0) - 1);
            ctrl = true;
        } else if (/^[0-9A-Za-z]$/.exec(ch) !== null) {
            name = ch.toLowerCase();
            shift = /^[A-Z]$/.exec(ch) !== null;
            meta = escaped;
            insertable = true;
        } else if (MAC_ALT_KEY_CHARACTER_MAP[ch] && process.platform === 'darwin') {
            name = MAC_ALT_KEY_CHARACTER_MAP[ch];
            meta = true;
        } else if (sequence === `${ESC}${ESC}`) {
            name = 'escape';
            meta = true;

            // Emit first escape key
            keypressHandler({
                name: 'escape',
                ctrl,
                meta,
                shift,
                paste: false,
                insertable: false,
                sequence: ESC,
            });
        } else if (escaped) {
            name = ch.length ? undefined : 'escape';
            meta = true;
        } else {
            // Any other character is printable
            insertable = true;
        }

        if (
            (sequence.length !== 0 && (name !== undefined || escaped)) ||
            charLengthAt(sequence, 0) === sequence.length
        ) {
            keypressHandler({
                name: name || '',
                ctrl,
                meta,
                shift,
                paste: false,
                insertable,
                sequence,
            });
        }
    }
}

export interface KeypressProviderProps {
    children: React.ReactNode;
}

export function KeypressProvider({ children }: KeypressProviderProps) {
    const { stdin, setRawMode } = useStdin();

    const subscribers = useRef<Set<KeypressHandler>>(new Set()).current;
    const subscribe = useCallback(
        (handler: KeypressHandler) => subscribers.add(handler),
        [subscribers]
    );
    const unsubscribe = useCallback(
        (handler: KeypressHandler) => subscribers.delete(handler),
        [subscribers]
    );
    const broadcast = useCallback(
        (key: Key) => subscribers.forEach((handler) => handler(key)),
        [subscribers]
    );

    useEffect(() => {
        const wasRaw = stdin.isRaw;
        if (wasRaw === false) {
            setRawMode(true);
        }

        process.stdin.setEncoding('utf8');

        // Build the processing pipeline:
        // dataListener -> pasteBufferer -> backslashBufferer -> mouseFilterer -> broadcast
        const mouseFilterer = nonKeyboardEventFilter(broadcast);
        const backslashBufferer = bufferBackslashEnter(mouseFilterer);
        const pasteBufferer = bufferPaste(backslashBufferer);
        const dataListener = createDataListener(pasteBufferer);

        stdin.on('data', dataListener);

        return () => {
            stdin.removeListener('data', dataListener);
            if (wasRaw === false) {
                setRawMode(false);
            }
        };
    }, [stdin, setRawMode, broadcast]);

    return (
        <KeypressContext.Provider value={{ subscribe, unsubscribe }}>
            {children}
        </KeypressContext.Provider>
    );
}

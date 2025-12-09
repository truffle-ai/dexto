/**
 * Mouse Event Utilities
 * Ported from Gemini CLI for trackpad/mouse scroll support
 */

// Mouse event type names
export type MouseEventName =
    | 'scroll-up'
    | 'scroll-down'
    | 'left-press'
    | 'left-release'
    | 'right-press'
    | 'right-release'
    | 'middle-press'
    | 'middle-release'
    | 'move';

export interface MouseEvent {
    name: MouseEventName;
    col: number;
    row: number;
    shift: boolean;
    meta: boolean;
    ctrl: boolean;
}

// Regex patterns for mouse event parsing
// SGR format: ESC [ < Cb ; Cx ; Cy M/m
const SGR_MOUSE_REGEX = /^\x1b\[<(\d+);(\d+);(\d+)([Mm])/;
// X11 format: ESC [ M Cb Cx Cy (3 bytes after M)
const X11_MOUSE_REGEX = /^\x1b\[M([\s\S]{3})/;

/**
 * Enable mouse events in the terminal
 * Uses SGR extended mouse mode for better coordinate handling
 */
export function enableMouseEvents(): void {
    // ?1002h = button event tracking (clicks + drags + scroll wheel)
    // ?1006h = SGR extended mouse mode (better coordinate handling)
    process.stdout.write('\u001b[?1002h\u001b[?1006h');
}

/**
 * Disable mouse events in the terminal
 */
export function disableMouseEvents(): void {
    process.stdout.write('\u001b[?1006l\u001b[?1002l');
}

/**
 * Get mouse event name from button code
 */
function getMouseEventName(buttonCode: number, isRelease: boolean): MouseEventName | null {
    const isMove = (buttonCode & 32) !== 0;

    // Check for scroll wheel events
    if ((buttonCode & 64) === 64) {
        if ((buttonCode & 1) === 0) {
            return 'scroll-up';
        } else {
            return 'scroll-down';
        }
    }

    if (isMove) {
        return 'move';
    }

    const button = buttonCode & 3;
    const type = isRelease ? 'release' : 'press';
    switch (button) {
        case 0:
            return `left-${type}` as MouseEventName;
        case 1:
            return `middle-${type}` as MouseEventName;
        case 2:
            return `right-${type}` as MouseEventName;
        default:
            return null;
    }
}

/**
 * Parse SGR format mouse event
 */
function parseSGRMouseEvent(buffer: string): { event: MouseEvent; length: number } | null {
    const match = buffer.match(SGR_MOUSE_REGEX);

    if (match) {
        const buttonCode = parseInt(match[1]!, 10);
        const col = parseInt(match[2]!, 10);
        const row = parseInt(match[3]!, 10);
        const action = match[4];
        const isRelease = action === 'm';

        const shift = (buttonCode & 4) !== 0;
        const meta = (buttonCode & 8) !== 0;
        const ctrl = (buttonCode & 16) !== 0;

        const name = getMouseEventName(buttonCode, isRelease);

        if (name) {
            return {
                event: { name, ctrl, meta, shift, col, row },
                length: match[0].length,
            };
        }
    }

    return null;
}

/**
 * Parse X11 format mouse event
 */
function parseX11MouseEvent(buffer: string): { event: MouseEvent; length: number } | null {
    const match = buffer.match(X11_MOUSE_REGEX);
    if (!match) return null;

    const b = match[1]!.charCodeAt(0) - 32;
    const col = match[1]!.charCodeAt(1) - 32;
    const row = match[1]!.charCodeAt(2) - 32;

    const shift = (b & 4) !== 0;
    const meta = (b & 8) !== 0;
    const ctrl = (b & 16) !== 0;
    const isMove = (b & 32) !== 0;
    const isWheel = (b & 64) !== 0;

    let name: MouseEventName | null = null;

    if (isWheel) {
        const button = b & 3;
        switch (button) {
            case 0:
                name = 'scroll-up';
                break;
            case 1:
                name = 'scroll-down';
                break;
        }
    } else if (isMove) {
        name = 'move';
    } else {
        const button = b & 3;
        if (button === 3) {
            name = 'left-release';
        } else {
            switch (button) {
                case 0:
                    name = 'left-press';
                    break;
                case 1:
                    name = 'middle-press';
                    break;
                case 2:
                    name = 'right-press';
                    break;
            }
        }
    }

    if (name) {
        return {
            event: { name, ctrl, meta, shift, col, row },
            length: match[0].length,
        };
    }
    return null;
}

/**
 * Parse mouse event from buffer (tries both SGR and X11 formats)
 */
export function parseMouseEvent(buffer: string): { event: MouseEvent; length: number } | null {
    return parseSGRMouseEvent(buffer) || parseX11MouseEvent(buffer);
}

/**
 * Check if buffer could be an incomplete mouse sequence
 */
export function isIncompleteMouseSequence(buffer: string): boolean {
    // Must start with ESC
    if (!buffer.startsWith('\x1b')) return false;

    // If it matches a complete sequence, it's not incomplete
    if (parseMouseEvent(buffer)) return false;

    // Check for SGR format prefix: ESC [ <
    if (buffer.startsWith('\x1b[<')) {
        // SGR sequences end with 'm' or 'M'
        return !/[mM]/.test(buffer) && buffer.length < 50;
    }

    // Check for X11 format prefix: ESC [ M
    if (buffer.startsWith('\x1b[M')) {
        // X11 needs exactly 3 bytes after prefix
        return buffer.length < 6;
    }

    // Could be partial prefix
    if ('\x1b[<'.startsWith(buffer) || '\x1b[M'.startsWith(buffer)) {
        return true;
    }

    return false;
}

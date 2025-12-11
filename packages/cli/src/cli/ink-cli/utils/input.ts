/**
 * Input Utilities
 * Constants and helpers for parsing terminal input sequences.
 */

export const ESC = '\u001B';
export const SGR_EVENT_PREFIX = `${ESC}[<`;
export const X11_EVENT_PREFIX = `${ESC}[M`;

// Focus tracking sequences
export const FOCUS_IN = `${ESC}[I`;
export const FOCUS_OUT = `${ESC}[O`;

// Mouse event regex patterns
// Using ESC constant to avoid control-character lint warnings
const ESC_CHAR = String.fromCharCode(0x1b);
export const SGR_MOUSE_REGEX = new RegExp(`^${ESC_CHAR}\\[<(\\d+);(\\d+);(\\d+)([mM])`);
export const X11_MOUSE_REGEX = new RegExp(`^${ESC_CHAR}\\[M([\\s\\S]{3})`);

/**
 * Check if buffer could be a SGR mouse sequence (or prefix thereof)
 */
export function couldBeSGRMouseSequence(buffer: string): boolean {
    if (buffer.length === 0) return true;
    // Check if buffer is a prefix of a mouse sequence starter
    if (SGR_EVENT_PREFIX.startsWith(buffer)) return true;
    // Check if buffer is a mouse sequence prefix
    if (buffer.startsWith(SGR_EVENT_PREFIX)) return true;
    return false;
}

/**
 * Check if buffer could be any mouse sequence (or prefix thereof)
 */
export function couldBeMouseSequence(buffer: string): boolean {
    if (buffer.length === 0) return true;

    // Check SGR prefix
    if (SGR_EVENT_PREFIX.startsWith(buffer) || buffer.startsWith(SGR_EVENT_PREFIX)) return true;
    // Check X11 prefix
    if (X11_EVENT_PREFIX.startsWith(buffer) || buffer.startsWith(X11_EVENT_PREFIX)) return true;

    return false;
}

/**
 * Get the length of a complete mouse sequence at the start of buffer.
 * Returns 0 if no complete sequence found.
 */
export function getMouseSequenceLength(buffer: string): number {
    const sgrMatch = buffer.match(SGR_MOUSE_REGEX);
    if (sgrMatch) return sgrMatch[0].length;

    const x11Match = buffer.match(X11_MOUSE_REGEX);
    if (x11Match) return x11Match[0].length;

    return 0;
}

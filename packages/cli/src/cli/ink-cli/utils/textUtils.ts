/**
 * Unicode-aware text utilities for terminal rendering
 *
 * Ported from Gemini CLI's textUtils.ts
 * These utilities work at the code-point level rather than UTF-16 code units,
 * so that surrogate-pair emoji count as one "column".
 */

import stripAnsi from 'strip-ansi';
import stringWidth from 'string-width';

// Cache for code points to reduce GC pressure
const codePointsCache = new Map<string, string[]>();
const MAX_STRING_LENGTH_TO_CACHE = 1000;

/**
 * Convert a string to an array of code points (handles surrogate pairs correctly)
 */
export function toCodePoints(str: string): string[] {
    // ASCII fast path - check if all chars are ASCII (0-127)
    let isAscii = true;
    for (let i = 0; i < str.length; i++) {
        if (str.charCodeAt(i) > 127) {
            isAscii = false;
            break;
        }
    }
    if (isAscii) {
        return str.split('');
    }

    // Cache short strings
    if (str.length <= MAX_STRING_LENGTH_TO_CACHE) {
        const cached = codePointsCache.get(str);
        if (cached) {
            return cached;
        }
    }

    const result = Array.from(str);

    // Cache result
    if (str.length <= MAX_STRING_LENGTH_TO_CACHE) {
        codePointsCache.set(str, result);
    }

    return result;
}

/**
 * Get the code-point length of a string
 */
export function cpLen(str: string): number {
    return toCodePoints(str).length;
}

/**
 * Slice a string by code-point indices
 */
export function cpSlice(str: string, start: number, end?: number): string {
    const arr = toCodePoints(str).slice(start, end);
    return arr.join('');
}

/**
 * Strip characters that can break terminal rendering.
 *
 * Characters stripped:
 * - ANSI escape sequences
 * - C0 control chars (0x00-0x1F) except CR/LF/TAB
 * - C1 control chars (0x80-0x9F)
 *
 * Characters preserved:
 * - All printable Unicode including emojis
 * - CR/LF (0x0D/0x0A) - needed for line breaks
 * - TAB (0x09)
 */
export function stripUnsafeCharacters(str: string): string {
    const strippedAnsi = stripAnsi(str);

    return toCodePoints(strippedAnsi)
        .filter((char) => {
            const code = char.codePointAt(0);
            if (code === undefined) return false;

            // Preserve CR/LF/TAB for line handling
            if (code === 0x0a || code === 0x0d || code === 0x09) return true;

            // Remove C0 control chars (except CR/LF/TAB)
            if (code >= 0x00 && code <= 0x1f) return false;

            // Remove DEL control char
            if (code === 0x7f) return false;

            // Remove C1 control chars (0x80-0x9f)
            if (code >= 0x80 && code <= 0x9f) return false;

            // Preserve all other characters including Unicode/emojis
            return true;
        })
        .join('');
}

// String width caching for performance optimization
const stringWidthCache = new Map<string, number>();

/**
 * Cached version of stringWidth function for better performance
 */
export function getCachedStringWidth(str: string): number {
    // ASCII printable chars have width 1
    if (/^[\x20-\x7E]*$/.test(str)) {
        return str.length;
    }

    if (stringWidthCache.has(str)) {
        return stringWidthCache.get(str)!;
    }

    const width = stringWidth(str);
    stringWidthCache.set(str, width);

    return width;
}

/**
 * Clear the string width cache
 */
export function clearStringWidthCache(): void {
    stringWidthCache.clear();
}

// Word character detection helpers
export const isWordCharStrict = (char: string): boolean => /[\w\p{L}\p{N}]/u.test(char);

export const isWhitespace = (char: string): boolean => /\s/.test(char);

export const isCombiningMark = (char: string): boolean => /\p{M}/u.test(char);

export const isWordCharWithCombining = (char: string): boolean =>
    isWordCharStrict(char) || isCombiningMark(char);

// Get the script of a character
export const getCharScript = (char: string): string => {
    if (/[\p{Script=Latin}]/u.test(char)) return 'latin';
    if (/[\p{Script=Han}]/u.test(char)) return 'han';
    if (/[\p{Script=Arabic}]/u.test(char)) return 'arabic';
    if (/[\p{Script=Hiragana}]/u.test(char)) return 'hiragana';
    if (/[\p{Script=Katakana}]/u.test(char)) return 'katakana';
    if (/[\p{Script=Cyrillic}]/u.test(char)) return 'cyrillic';
    return 'other';
};

export const isDifferentScript = (char1: string, char2: string): boolean => {
    if (!isWordCharStrict(char1) || !isWordCharStrict(char2)) return false;
    return getCharScript(char1) !== getCharScript(char2);
};

// Initialize segmenter for word boundary detection
const segmenter = new Intl.Segmenter(undefined, { granularity: 'word' });

/**
 * Find previous word boundary in a line
 */
export function findPrevWordBoundary(line: string, cursorCol: number): number {
    const codePoints = toCodePoints(line);
    // Convert cursorCol (CP index) to string index
    const prefix = codePoints.slice(0, cursorCol).join('');
    const cursorIdx = prefix.length;

    let targetIdx = 0;

    for (const seg of segmenter.segment(line)) {
        if (seg.index >= cursorIdx) break;
        if (seg.isWordLike) {
            targetIdx = seg.index;
        }
    }

    return toCodePoints(line.slice(0, targetIdx)).length;
}

/**
 * Find next word boundary in a line
 */
export function findNextWordBoundary(line: string, cursorCol: number): number {
    const codePoints = toCodePoints(line);
    const prefix = codePoints.slice(0, cursorCol).join('');
    const cursorIdx = prefix.length;

    let targetIdx = line.length;

    for (const seg of segmenter.segment(line)) {
        const segEnd = seg.index + seg.segment.length;
        if (segEnd > cursorIdx) {
            if (seg.isWordLike) {
                targetIdx = segEnd;
                break;
            }
        }
    }

    return toCodePoints(line.slice(0, targetIdx)).length;
}

/**
 * Find next word start within a line, starting from col
 */
export function findNextWordStartInLine(line: string, col: number): number | null {
    const chars = toCodePoints(line);
    let i = col;

    if (i >= chars.length) return null;

    const currentChar = chars[i]!;

    // Skip current word/sequence based on character type
    if (isWordCharStrict(currentChar)) {
        while (i < chars.length && isWordCharWithCombining(chars[i]!)) {
            if (
                i + 1 < chars.length &&
                isWordCharStrict(chars[i + 1]!) &&
                isDifferentScript(chars[i]!, chars[i + 1]!)
            ) {
                i++;
                break;
            }
            i++;
        }
    } else if (!isWhitespace(currentChar)) {
        while (i < chars.length && !isWordCharStrict(chars[i]!) && !isWhitespace(chars[i]!)) {
            i++;
        }
    }

    // Skip whitespace
    while (i < chars.length && isWhitespace(chars[i]!)) {
        i++;
    }

    return i < chars.length ? i : null;
}

/**
 * Find previous word start within a line
 */
export function findPrevWordStartInLine(line: string, col: number): number | null {
    const chars = toCodePoints(line);
    let i = col;

    if (i <= 0) return null;

    i--;

    // Skip whitespace moving backwards
    while (i >= 0 && isWhitespace(chars[i]!)) {
        i--;
    }

    if (i < 0) return null;

    if (isWordCharStrict(chars[i]!)) {
        while (i >= 0 && isWordCharStrict(chars[i]!)) {
            if (
                i - 1 >= 0 &&
                isWordCharStrict(chars[i - 1]!) &&
                isDifferentScript(chars[i]!, chars[i - 1]!)
            ) {
                return i;
            }
            i--;
        }
        return i + 1;
    } else {
        while (i >= 0 && !isWordCharStrict(chars[i]!) && !isWhitespace(chars[i]!)) {
            i--;
        }
        return i + 1;
    }
}

/** Move a UTF-16 boundary back when it falls between a surrogate pair. */
export function safeTextBoundary(text: string, offset: number): number {
    const before = text.charCodeAt(offset - 1);
    const after = text.charCodeAt(offset);
    return before >= 0xd800 && before <= 0xdbff && after >= 0xdc00 && after <= 0xdfff
        ? offset - 1
        : offset;
}

import { redactForStringify } from './redactor.js';

/**
 * Safe stringify that handles circular references and BigInt.
 * Also redacts sensitive data to prevent PII leaks. An object reached more than once is written
 * once and then as "[Shared]", and with a maxLen only about that much of the value is read, so a
 * large or densely linked value never builds its full text before being cut.
 *
 * An Error is written as its name, message, cause and own fields, never its stack: this text
 * reaches models and people (tool results, turn error text). Traces use
 * `safeStringifyWithStacks`.
 *
 * @param value - Value to stringify
 * @param maxLen - Optional maximum length. If provided, truncates with '…(truncated)' suffix.
 */
export function safeStringify(value: unknown, maxLen?: number): string {
    return stringify(value, maxLen, false);
}

/** `safeStringify` that also writes each Error's masked stack, for traces only. */
export function safeStringifyWithStacks(value: unknown, maxLen?: number): string {
    return stringify(value, maxLen, true);
}

function stringify(value: unknown, maxLen: number | undefined, errorStacks: boolean): string {
    try {
        // Handle top-level BigInt without triggering JSON.stringify errors
        if (typeof value === 'bigint') {
            return value.toString();
        }
        const limit = maxLen !== undefined && maxLen > 0 ? maxLen : Infinity;
        // First redact sensitive data to prevent PII leaks
        const redacted = redactForStringify(value, limit, errorStacks);
        const str = JSON.stringify(redacted, (_, v) => {
            if (typeof v === 'bigint') return v.toString();
            return v;
        });
        if (typeof str === 'string') {
            // Only truncate if maxLen is explicitly provided
            if (str.length > limit) {
                const indicator = '…(truncated)';
                if (limit <= indicator.length) {
                    return str.slice(0, limit);
                }
                const sliceLen = limit - indicator.length;
                return `${str.slice(0, sliceLen)}${indicator}`;
            }
            return str;
        }
        return String(redacted);
    } catch {
        return '[Unserializable value]';
    }
}

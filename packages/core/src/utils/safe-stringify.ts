import { redactSensitiveData } from './redactor.js';

/**
 * Safe stringify that handles circular references and BigInt.
 * Also redacts sensitive data to prevent PII leaks.
 *
 * @param value - Value to stringify
 * @param maxLen - Optional maximum length. If provided, truncates with '…(truncated)' suffix.
 */
export function safeStringify(value: unknown, maxLen?: number): string {
    try {
        // Handle top-level BigInt without triggering JSON.stringify errors
        if (typeof value === 'bigint') {
            return value.toString();
        }
        // First redact sensitive data to prevent PII leaks
        const redacted = redactSensitiveData(value);
        const str = JSON.stringify(redacted, (_, v) => {
            if (v instanceof Error) {
                return { name: v.name, message: v.message, stack: v.stack };
            }
            if (typeof v === 'bigint') return v.toString();
            return v;
        });
        if (typeof str === 'string') {
            // Only truncate if maxLen is explicitly provided
            if (maxLen !== undefined && maxLen > 0 && str.length > maxLen) {
                const indicator = '…(truncated)';
                if (maxLen <= indicator.length) {
                    return str.slice(0, maxLen);
                }
                const sliceLen = maxLen - indicator.length;
                return `${str.slice(0, sliceLen)}${indicator}`;
            }
            return str;
        }
        return String(value);
    } catch {
        try {
            return String(value);
        } catch {
            return '[Unserializable value]';
        }
    }
}

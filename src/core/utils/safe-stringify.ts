import { redactSensitiveData } from './redactor.js';

/**
 * Safe stringify that handles circular references, BigInt, and limits output size
 * Also redacts sensitive data to prevent PII leaks in error messages
 */
export function safeStringify(value: unknown, maxLen = 1000): string {
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
        const indicator = '…(truncated)';
        const limit = Number.isFinite(maxLen) && maxLen > 0 ? Math.floor(maxLen) : 1000;
        if (typeof str === 'string') {
            if (str.length <= limit) return str;
            const sliceLen = Math.max(0, limit - indicator.length);
            return `${str.slice(0, sliceLen)}${indicator}`;
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

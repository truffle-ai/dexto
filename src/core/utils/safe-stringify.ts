import { redactSensitiveData } from '../../app/api/middleware/redactor.js';

/**
 * Safe stringify that handles circular references, BigInt, and limits output size
 * Also redacts sensitive data to prevent PII leaks in error messages
 */
export function safeStringify(value: unknown, maxLen = 1000): string {
    try {
        // First redact sensitive data to prevent PII leaks
        const redacted = redactSensitiveData(value);
        const str = JSON.stringify(redacted, (_, v) => {
            if (typeof v === 'bigint') return v.toString();
            return v;
        });
        if (typeof str === 'string') {
            return str.length > maxLen ? `${str.slice(0, maxLen)}…(truncated)` : str;
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

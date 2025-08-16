/**
 * Utility to redact sensitive information from objects, arrays, and strings.
 * - Redacts by field name (e.g., apiKey, token, password, etc.)
 * - Redacts by value pattern (e.g., OpenAI keys, Bearer tokens, emails)
 * - Handles deeply nested structures and circular references
 * - Recursive and preserves structure
 * - Easy to extend
 */

// List of sensitive field names to redact (case-insensitive)
const SENSITIVE_FIELDS = [
    'apikey',
    'api_key',
    'token',
    'access_token',
    'refresh_token',
    'password',
    'secret',
];

// List of regex patterns to redact sensitive values
const SENSITIVE_PATTERNS: RegExp[] = [
    /\bsk-[A-Za-z0-9]{20,}\b/g, // OpenAI API keys (at least 20 chars after sk-)
    /\bBearer\s+[A-Za-z0-9\-_.=]+\b/gi, // Bearer tokens
    /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, // Emails
    /\beyJ[A-Za-z0-9_-]*\.[A-Za-z0-9_-]*\.[A-Za-z0-9_-]*/g, // JWT tokens
];

const REDACTED = '[REDACTED]';
const REDACTED_CIRCULAR = '[REDACTED_CIRCULAR]';

/**
 * Redacts sensitive data from an object, array, or string.
 * Handles circular references gracefully.
 * @param input - The data to redact
 * @param seen - Internal set to track circular references
 * @returns The redacted data
 */
export function redactSensitiveData(input: unknown, seen = new WeakSet()): unknown {
    if (typeof input === 'string') {
        let result = input;
        for (const pattern of SENSITIVE_PATTERNS) {
            result = result.replace(pattern, REDACTED);
        }
        return result;
    }
    if (Array.isArray(input)) {
        if (seen.has(input)) return REDACTED_CIRCULAR;
        seen.add(input);
        return input.map((item) => redactSensitiveData(item, seen));
    }
    if (input && typeof input === 'object') {
        if (seen.has(input)) return REDACTED_CIRCULAR;
        seen.add(input);
        const result: any = {};
        for (const [key, value] of Object.entries(input)) {
            if (SENSITIVE_FIELDS.includes(key.toLowerCase())) {
                result[key] = REDACTED;
            } else {
                result[key] = redactSensitiveData(value, seen);
            }
        }
        return result;
    }
    return input;
}

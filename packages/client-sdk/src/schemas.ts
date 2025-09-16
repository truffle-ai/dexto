// Lightweight client SDK - no validation, just pass-through to server
// The server handles all validation and returns appropriate errors

// Simple utility for basic URL validation (no external dependencies)
export function isValidUrl(url: string): boolean {
    try {
        new URL(url);
        return /^https?:\/\//i.test(url);
    } catch {
        return false;
    }
}

// Simple utility for basic string validation
export function isNonEmptyString(value: unknown): value is string {
    return typeof value === 'string' && value.length > 0;
}

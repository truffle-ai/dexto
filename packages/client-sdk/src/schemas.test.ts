import { describe, it, expect } from 'vitest';
import { isValidUrl, isNonEmptyString } from './schemas.js';

describe('Lightweight Schema Utilities', () => {
    describe('isValidUrl', () => {
        it('should validate HTTP URLs', () => {
            expect(isValidUrl('http://localhost:3000')).toBe(true);
            expect(isValidUrl('http://example.com')).toBe(true);
        });

        it('should validate HTTPS URLs', () => {
            expect(isValidUrl('https://api.dexto.com')).toBe(true);
            expect(isValidUrl('https://example.com')).toBe(true);
        });

        it('should reject invalid URLs', () => {
            expect(isValidUrl('not-a-url')).toBe(false);
            expect(isValidUrl('ftp://example.com')).toBe(false);
            expect(isValidUrl('')).toBe(false);
        });
    });

    describe('isNonEmptyString', () => {
        it('should validate non-empty strings', () => {
            expect(isNonEmptyString('hello')).toBe(true);
            expect(isNonEmptyString('a')).toBe(true);
        });

        it('should reject empty strings and non-strings', () => {
            expect(isNonEmptyString('')).toBe(false);
            expect(isNonEmptyString(null)).toBe(false);
            expect(isNonEmptyString(undefined)).toBe(false);
            expect(isNonEmptyString(123)).toBe(false);
            expect(isNonEmptyString({})).toBe(false);
        });
    });
});

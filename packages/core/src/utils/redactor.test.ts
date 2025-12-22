import { describe, test, expect } from 'vitest';
import { redactSensitiveData as redact } from './redactor.js';

describe('redact', () => {
    // Basic field redaction
    test('should redact a single sensitive field', () => {
        expect(redact({ apiKey: 'secret' })).toEqual({ apiKey: '[REDACTED]' });
    });

    test('should redact multiple sensitive fields', () => {
        expect(redact({ apiKey: 'secret', password: 'pass' })).toEqual({
            apiKey: '[REDACTED]',
            password: '[REDACTED]',
        });
    });

    test('should perform case-insensitive field matching', () => {
        expect(redact({ ApiKey: 'secret', PASSWORD: 'pass' })).toEqual({
            ApiKey: '[REDACTED]',
            PASSWORD: '[REDACTED]',
        });
    });

    test('should handle mixed sensitive and non-sensitive fields', () => {
        expect(redact({ apiKey: 'secret', name: 'john' })).toEqual({
            apiKey: '[REDACTED]',
            name: 'john',
        });
    });

    test('should handle field names with underscores', () => {
        expect(redact({ api_key: 'secret', access_token: 'token' })).toEqual({
            api_key: '[REDACTED]',
            access_token: '[REDACTED]',
        });
    });

    // Array Processing
    test('should handle array of objects with sensitive fields', () => {
        expect(redact([{ apiKey: 'secret' }, { password: 'pass' }])).toEqual([
            { apiKey: '[REDACTED]' },
            { password: '[REDACTED]' },
        ]);
    });

    test('should handle array of strings with patterns', () => {
        expect(redact(['sk-thisisafakekeyofsufficientlength', 'normal string'])).toEqual([
            '[REDACTED]',
            'normal string',
        ]);
    });

    test('should handle mixed array types', () => {
        expect(redact([{ apiKey: 'secret' }, 'sk-thisisafakekeyofsufficientlength', 42])).toEqual([
            { apiKey: '[REDACTED]' },
            '[REDACTED]',
            42,
        ]);
    });

    test('should handle an empty array', () => {
        expect(redact([])).toEqual([]);
    });

    test('should handle nested arrays', () => {
        expect(redact([[{ apiKey: 'secret' }]])).toEqual([[{ apiKey: '[REDACTED]' }]]);
    });

    // Object Nesting
    test('should handle deeply nested sensitive fields', () => {
        expect(redact({ user: { config: { apiKey: 'secret' } } })).toEqual({
            user: { config: { apiKey: '[REDACTED]' } },
        });
    });

    test('should handle mixed nesting levels', () => {
        expect(redact({ apiKey: 'secret', user: { password: 'pass' } })).toEqual({
            apiKey: '[REDACTED]',
            user: { password: '[REDACTED]' },
        });
    });

    test('should handle array within object', () => {
        expect(redact({ users: [{ apiKey: 'secret' }] })).toEqual({
            users: [{ apiKey: '[REDACTED]' }],
        });
    });

    test('should handle object within array', () => {
        expect(redact([{ nested: { apiKey: 'secret' } }])).toEqual([
            { nested: { apiKey: '[REDACTED]' } },
        ]);
    });

    // Primitive Types
    test('should return primitives unchanged', () => {
        expect(redact(null)).toBeNull();
        expect(redact(undefined)).toBeUndefined();
        expect(redact(42)).toBe(42);
        expect(redact(true)).toBe(true);
        const s = Symbol('foo');
        expect(redact(s)).toBe(s);
    });

    // Sensitive Patterns
    describe('Sensitive Patterns in Strings', () => {
        test('should redact OpenAI API keys', () => {
            const text = 'My API key is sk-thisisafakekeyofsufficientlength';
            expect(redact(text)).toBe('My API key is [REDACTED]');
        });

        test('should redact Bearer tokens', () => {
            const text = 'Authorization: Bearer my-secret-token-123';
            expect(redact(text)).toBe('Authorization: [REDACTED]');
        });

        test('should redact emails', () => {
            const text = 'Contact me at test@example.com';
            expect(redact(text)).toBe('Contact me at [REDACTED]');
        });

        test('should not redact normal strings', () => {
            const text = 'This is a normal sentence.';
            expect(redact(text)).toBe(text);
        });

        test('should redact standalone JWT tokens', () => {
            const jwt =
                'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U';
            expect(redact(jwt)).toBe('[REDACTED]');
        });
    });

    // Signed URLs (should NOT be redacted)
    describe('Signed URLs', () => {
        test('should NOT redact Supabase signed URLs', () => {
            const url =
                'https://xxx.supabase.co/storage/v1/object/sign/bucket/file.dat?token=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U';
            expect(redact(url)).toBe(url);
        });

        test('should NOT redact AWS S3 presigned URLs', () => {
            const url =
                'https://bucket.s3.us-east-1.amazonaws.com/file.dat?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=xxx';
            expect(redact(url)).toBe(url);
        });

        test('should NOT redact Google Cloud Storage signed URLs', () => {
            const url =
                'https://storage.googleapis.com/bucket/file.dat?Expires=123&GoogleAccessId=xxx&Signature=xxx';
            expect(redact(url)).toBe(url);
        });

        test('should still redact JWT tokens in non-URL contexts', () => {
            const text =
                'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U';
            expect(redact(text)).toBe('[REDACTED]');
        });
    });

    // Circular References
    describe('Circular References', () => {
        test('should handle circular references in objects', () => {
            const obj: any = { a: 1 };
            obj.b = obj; // Circular reference
            const redacted = redact(obj);
            expect(redacted).toEqual({ a: 1, b: '[REDACTED_CIRCULAR]' });
        });

        test('should handle circular references in arrays', () => {
            const arr: any[] = [1];
            arr.push(arr); // Circular reference
            const redacted = redact(arr);
            expect(redacted).toEqual([1, '[REDACTED_CIRCULAR]']);
        });

        test('should handle complex circular references', () => {
            const obj1: any = { name: 'obj1' };
            const obj2: any = { name: 'obj2' };
            obj1.child = obj2;
            obj2.parent = obj1; // Circular reference
            const redacted = redact(obj1);
            expect(redacted).toEqual({
                name: 'obj1',
                child: { name: 'obj2', parent: '[REDACTED_CIRCULAR]' },
            });
        });

        test('should handle circular references in nested arrays', () => {
            const arr: any[] = [1, [2]];
            (arr[1] as any[]).push(arr);
            const redacted = redact(arr);
            expect(redacted).toEqual([1, [2, '[REDACTED_CIRCULAR]']]);
        });
    });
});

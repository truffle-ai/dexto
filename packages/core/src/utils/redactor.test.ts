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

        // Built at runtime so no literal here has the shape of a real credential.
        const letters = (length: number): string =>
            'aB3dE6gH9jK2mN5pQ8sT1vW4yZ7'.repeat(8).slice(0, length);

        test.each([
            ['OpenAI project key', `sk-proj-${letters(40)}-${letters(40)}`],
            ['Anthropic API key', `sk-ant-api03-${letters(40)}_${letters(40)}-AA`],
            ['Anthropic OAuth access token', `sk-ant-oat01-${letters(95)}`],
            ['Anthropic OAuth refresh token', `sk-ant-ort01-${letters(95)}`],
            ['GitHub personal token', `ghp_${letters(36)}`],
            ['GitHub OAuth token', `gho_${letters(36)}`],
            ['GitHub fine-grained token', `github_pat_${letters(22)}_${letters(59)}`],
            ['Slack bot token', `xoxb-${'1234567890'}-${'1234567890123'}-${letters(24)}`],
            ['Slack user token', `xoxp-${'1234567890'}-${'1234567890123'}-${letters(32)}`],
            ['Slack app-level token', `xapp-${'1'}-${'A0123456789'}-${letters(64)}`],
            ['Slack rotating app-level token', `xoxe.xapp-${'1'}-${letters(40)}`],
            ['Google OAuth access token', `ya29.${letters(60)}-${letters(40)}`],
            ['AWS access key id', `AKIA${'IOSFODNN7EXAMPLE'}`],
            ['AWS temporary access key id', `ASIA${'IOSFODNN7EXAMPLE'}`],
            ['Stripe live secret key', `sk_${'live'}_${letters(24)}`],
            ['Stripe live restricted key', `rk_${'live'}_${letters(24)}`],
        ])('should redact a %s and keep the words around it', (_shape, token) => {
            expect(redact(`request failed for ${token} after 3 tries`)).toBe(
                'request failed for [REDACTED] after 3 tries'
            );
            expect(redact(`{"value":"${token}"}`)).toBe('{"value":"[REDACTED]"}');
        });

        test('should redact a PEM private key block, whole or cut off', () => {
            const block = [
                `-----BEGIN ${'RSA '}PRIVATE KEY-----`,
                letters(64),
                letters(64),
                `-----END ${'RSA '}PRIVATE KEY-----`,
            ].join('\n');
            expect(redact(`key:\n${block}\ndone`)).toBe('key:\n[REDACTED]\ndone');
            expect(redact(block.split('\n').slice(0, 2).join('\n'))).toBe('[REDACTED]');
        });

        test('should not redact a PEM public key or certificate', () => {
            const publicKey = `-----BEGIN PUBLIC KEY-----\n${letters(64)}\n-----END PUBLIC KEY-----`;
            expect(redact(publicKey)).toBe(publicKey);
        });

        test.each([
            'The task-specific risk-based check ran on desk-3 and disk-usage stayed flat.',
            'class="sk-loading-spinner-container-wrapper" is a style name, not a key.',
            'sk-extraordinarilylongcomponent-name is an identifier, not a key.',
            'ghp_ and gho_ and github_pat_ are GitHub token prefixes; xoxb- is Slack.',
            'sha256:9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08',
            'AKIA is the prefix of an AWS access key id; ASIAN markets opened higher.',
            'ya29 is a prefix, and sk_live_ needs a key after it.',
            'Run 7f3c2a9e-5b1d-4e8a-9c6f-2d4b8a1e3f5c finished in 1,204 ms.',
        ])('should not redact ordinary text: %s', (text) => {
            expect(redact(text)).toBe(text);
        });

        test('should keep the access key id inside an S3 presigned URL', () => {
            const keyId = `AKIA${'IOSFODNN7EXAMPLE'}`;
            const sigV4 = `https://bucket.s3.us-east-1.amazonaws.com/report.pdf?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=${keyId}%2F20261008%2Fus-east-1%2Fs3%2Faws4_request&X-Amz-Signature=abc123`;
            const sigV2 = `https://bucket.s3.amazonaws.com/report.pdf?AWSAccessKeyId=${keyId}&Expires=1791500000&Signature=abc123`;
            expect(redact(sigV4)).toBe(sigV4);
            expect(redact(sigV2)).toBe(sigV2);
            expect(redact(`aws_access_key_id = ${keyId}`)).toBe('aws_access_key_id = [REDACTED]');
            expect(redact(`AWSAccessKeyId=${keyId}`)).toBe('AWSAccessKeyId=[REDACTED]');
            expect(redact(`export X-Amz-Credential=${keyId}`)).toBe(
                'export X-Amz-Credential=[REDACTED]'
            );
        });

        test('should stay fast on many digit-free sk- segments', () => {
            const text = 'sk-'.repeat(40000);
            const started = Date.now();
            expect(redact(text)).toBe(text);
            expect(Date.now() - started).toBeLessThan(500);
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

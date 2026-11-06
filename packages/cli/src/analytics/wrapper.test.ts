import { describe, expect, it } from 'vitest';
import { buildArgsPayload } from './wrapper.js';

describe('command analytics metadata', () => {
    it('does not include positional values or option values', () => {
        const secret = 'synthetic-secret-value';
        const metadata = buildArgsPayload([
            [`https://example.invalid/${secret}`],
            { endpoint: secret },
        ]);
        expect(metadata).toEqual({ argTypes: ['array', 'object'], positionalCount: 1 });
        expect(JSON.stringify(metadata)).not.toContain(secret);
    });
});

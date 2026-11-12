import { performance } from 'node:perf_hooks';
import { describe, expect, it } from 'vitest';
import { ResourceError } from './errors.js';

describe('ResourceError URI redaction', () => {
    it('hides credentials in a URI that is not a valid URL', () => {
        const error = ResourceError.invalidUriFormat('not a url //user:pass@host/x?token=abc');
        expect(error.message).toContain('//***@host');
        expect(error.message).toContain('token=***');
        expect(error.message).not.toContain('user:pass');
    });

    it('stays fast on a long run of slashes', () => {
        const started = performance.now();
        ResourceError.invalidUriFormat(`x ${'//'.repeat(50_000)}`);
        expect(performance.now() - started).toBeLessThan(1_000);
    });
});

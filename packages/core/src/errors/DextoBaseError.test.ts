import { afterEach, describe, expect, it, vi } from 'vitest';
import { DextoRuntimeError } from './DextoRuntimeError.js';
import { ErrorScope, ErrorType } from './types.js';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function createError(): DextoRuntimeError {
    return new DextoRuntimeError('test_code', ErrorScope.AGENT, ErrorType.SYSTEM, 'boom');
}

describe('DextoBaseError trace IDs', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('uses crypto.randomUUID when it is available', () => {
        expect(createError().traceId).toMatch(UUID_V4);
    });

    it('falls back to crypto.getRandomValues without randomUUID (insecure browser context)', () => {
        const getRandomValues = globalThis.crypto.getRandomValues.bind(globalThis.crypto);
        vi.stubGlobal('crypto', { getRandomValues });

        const first = createError();
        const second = createError();

        expect(first.traceId).toMatch(UUID_V4);
        expect(second.traceId).not.toBe(first.traceId);
    });

    it('still constructs the error when Web Crypto is missing entirely', () => {
        vi.stubGlobal('crypto', undefined);

        const error = createError();

        expect(error.message).toBe('boom');
        expect(error.traceId).toMatch(/^trace-/);
    });
});

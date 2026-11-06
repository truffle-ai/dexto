import { describe, expect, it } from 'vitest';
import { buildArgsPayload, withAnalytics } from './wrapper.js';
import { vi } from 'vitest';

vi.mock('./index.js', () => ({
    initAnalytics: vi.fn(),
    onCommandStart: vi.fn(),
    onCommandEnd: vi.fn(),
    capture: vi.fn(),
}));
import { onCommandEnd } from './index.js';

describe('command analytics metadata', () => {
    it('omits thrown error messages from command events', async () => {
        const secret = 'synthetic-secret-value';
        const run = withAnalytics(
            'test',
            () => {
                throw new Error(secret);
            },
            { timeoutMs: 0 }
        );
        await expect(run()).rejects.toThrow(secret);
        expect(onCommandEnd).toHaveBeenCalledWith('test', false, { args: { argTypes: [] } });
        expect(JSON.stringify(vi.mocked(onCommandEnd).mock.calls)).not.toContain(secret);
    });
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

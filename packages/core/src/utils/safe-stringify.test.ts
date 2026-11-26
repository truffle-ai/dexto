import { afterEach, describe, expect, it, vi } from 'vitest';
import { safeStringify } from './safe-stringify.js';

const CAP = 8192;

/** The longest text JSON.stringify produced while `run` ran. */
function longestJson(run: () => void): number {
    const stringify = JSON.stringify;
    let longest = 0;
    const spy = vi.spyOn(JSON, 'stringify').mockImplementation((...args) => {
        const text = stringify(...args);
        longest = Math.max(longest, text?.length ?? 0);
        return text;
    });
    try {
        run();
    } finally {
        spy.mockRestore();
    }
    return longest;
}

describe('safeStringify', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('encodes no more than about the cap of a 10 MB object', () => {
        const items = Array.from({ length: 100_000 }, (_, index) => ({
            id: index,
            text: 'x'.repeat(100),
        }));
        let text = '';

        const produced = longestJson(() => {
            text = safeStringify({ items }, CAP);
        });

        expect(text).toHaveLength(CAP);
        expect(text.endsWith('…(truncated)')).toBe(true);
        expect(produced).toBeLessThanOrEqual(CAP + 2048);
    });

    it('reads a 10 MB string only up to about the cap', () => {
        let text = '';

        const produced = longestJson(() => {
            text = safeStringify({ body: 'a'.repeat(10_000_000) }, CAP);
        });

        expect(text).toHaveLength(CAP);
        expect(produced).toBeLessThanOrEqual(CAP + 2048);
    });

    it('writes an object reached more than once only once', () => {
        // Each level points at the one below twice: written out in full, 2^40 leaves.
        let node: Record<string, unknown> = { leaf: true };
        for (let level = 0; level < 40; level += 1) {
            node = { left: node, right: node };
        }

        const capped = safeStringify(node, CAP);
        const uncapped = safeStringify(node);

        expect(capped).toContain('[Shared]');
        expect(capped.length).toBeLessThanOrEqual(CAP);
        expect(uncapped).toContain('[Shared]');
        expect(uncapped.length).toBeLessThan(2000);
    });

    it('marks a cycle', () => {
        const session: Record<string, unknown> = { id: 's1' };
        session.self = session;

        expect(safeStringify(session, CAP)).toBe('{"id":"s1","self":"[REDACTED_CIRCULAR]"}');
    });

    it('still redacts secrets, including one that runs past the cap', () => {
        const key = `sk-${'a1'.repeat(30)}`;
        const text = safeStringify(
            { apiKey: 'plain', note: `${'x'.repeat(CAP - 40)} ${key}` },
            CAP
        );

        expect(text).not.toContain('plain');
        expect(text).not.toContain('a1a1');
        expect(text).toContain('[REDACTED]');
    });

    it('never keeps part of a secret cut at the limit, even after earlier text shrank', () => {
        // The PEM block shrinks to [REDACTED], which would pull the cut-off token inside the cap.
        const pem = `-----BEGIN PRIVATE KEY-----\n${'A'.repeat(1700)}\n-----END PRIVATE KEY-----`;
        const token = `ghp_${'Z'.repeat(36)}`;
        // Where the walk cuts this string: its budget plus the context read past it.
        const cut = CAP - '{"note":"'.length + 1024;
        const prefix = `${pem} ${'x'.repeat(cut - 20 - pem.length - 2)} `;
        const note = `${prefix}${token}${'y'.repeat(2000)}`;
        expect(cut).toBeGreaterThan(prefix.length);
        expect(cut).toBeLessThan(prefix.length + token.length);

        const text = safeStringify({ note }, CAP);

        expect(text).not.toContain('ZZZZ');
        expect(text).not.toContain('AAAA');
    });

    it('keeps small values whole', () => {
        expect(safeStringify({ a: 1, b: [true, null, 'x'], c: 10n }, CAP)).toBe(
            '{"a":1,"b":[true,null,"x"],"c":"10"}'
        );
        expect(safeStringify(5n)).toBe('5');
        expect(safeStringify(undefined)).toBe('undefined');
    });
});

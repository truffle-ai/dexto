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
        let words = '';
        let run = '';

        const produced = longestJson(() => {
            words = safeStringify({ body: 'abc '.repeat(2_500_000) }, CAP);
            run = safeStringify({ body: 'a'.repeat(10_000_000) }, CAP);
        });

        expect(words).toHaveLength(CAP);
        // One run of token characters too long to read whole is left out from its start.
        expect(run).toBe('{"body":"…"}');
        expect(produced).toBeLessThanOrEqual(CAP + 2048);
    });

    it('reads a wide object only up to about the cap', () => {
        const wide: Record<string, string> = {};
        for (let index = 0; index < 200_000; index += 1) {
            wide[`key${index}`] = 'value';
        }
        let reads = 0;
        const counted = new Proxy(wide, {
            get(target, key, receiver) {
                reads += 1;
                return Reflect.get(target, key, receiver);
            },
        });

        const started = Date.now();
        const text = safeStringify(counted, CAP);
        const elapsed = Date.now() - started;

        expect(text).toHaveLength(CAP);
        expect(reads).toBeLessThan(2000);
        expect(elapsed).toBeLessThan(1000);
    });

    it('writes an object reached more than once only once', () => {
        // Each level points at the one below twice: written out in full, 2^40 leaves.
        let node: Record<string, unknown> = { leaf: true };
        for (let level = 0; level < 40; level += 1) {
            node = { left: node, right: node };
        }

        const capped = safeStringify(node, CAP);

        expect(capped).toContain('[Shared]');
        expect(capped.length).toBeLessThanOrEqual(CAP);
    });

    it('writes a shared object out in full at every reference without a cap', () => {
        const leaf = { leaf: true };

        expect(safeStringify({ left: leaf, right: leaf })).toBe(
            '{"left":{"leaf":true},"right":{"leaf":true}}'
        );
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

    it('never keeps part of a JWT longer than the read-ahead that runs across the cut', () => {
        const encode = (value: string) => Buffer.from(value).toString('base64url');
        const header = encode('{"alg":"HS256","typ":"JWT"}');
        const payload = encode(
            JSON.stringify({ email: 'person@example.com', padding: 'p'.repeat(2200) })
        );
        const jwt = `${header}.${payload}.${'s'.repeat(43)}`;
        expect(jwt.length).toBeGreaterThan(3000);

        const text = safeStringify(`${'x'.repeat(8000)} ${jwt} tail`, CAP);

        expect(text).not.toContain(header.slice(0, 12));
        expect(text).not.toContain(payload.slice(0, 12));
        expect(text).not.toContain(payload.slice(-12));
    });

    it('never keeps part of a long key that runs across the cut', () => {
        const key = `sk-proj-${'a1'.repeat(1500)}`;

        const text = safeStringify({ note: `${'x'.repeat(8000)} ${key} tail` }, CAP);

        expect(text).not.toContain('a1a1');
        expect(text).toContain('[REDACTED]');
    });

    it('leaves out a token-character run too long to read whole when it crosses the cut', () => {
        const encode = (value: string) => Buffer.from(value).toString('base64url');
        const header = encode('{"alg":"HS256","typ":"JWT"}');
        const jwt = `${header}.${encode('p'.repeat(80_000))}.${'s'.repeat(43)}`;

        const text = safeStringify(`${'x'.repeat(8000)} ${jwt}`, CAP);

        expect(text).not.toContain(header.slice(0, 12));
        expect(text.startsWith(`"${'x'.repeat(8000)}`)).toBe(true);
    });

    it('keeps small values whole', () => {
        expect(safeStringify({ a: 1, b: [true, null, 'x'], c: 10n }, CAP)).toBe(
            '{"a":1,"b":[true,null,"x"],"c":"10"}'
        );
        expect(safeStringify(5n)).toBe('5');
        expect(safeStringify(undefined)).toBe('undefined');
    });
});

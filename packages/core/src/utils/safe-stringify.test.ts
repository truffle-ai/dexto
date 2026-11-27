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

    it('does not allow toJSON to bypass redaction', () => {
        const secret = `sk-proj-${'a1'.repeat(20)}`;
        const value = { visible: 'kept', toJSON: () => secret };

        expect(safeStringify(value)).toBe('{"visible":"kept"}');
        expect(safeStringify({ nested: value }, CAP)).toBe('{"nested":{"visible":"kept"}}');
    });

    it('redacts a top-level symbol description and keeps an ordinary one', () => {
        const secret = `sk-proj-${'a1'.repeat(20)}`;

        expect(safeStringify(Symbol(`key ${secret}`))).toBe('Symbol(key [REDACTED])');
        expect(safeStringify(Symbol('plain'))).toBe('Symbol(plain)');
        expect(safeStringify(undefined)).toBe('undefined');
    });

    it('redacts the text of a Date or RegExp whose own conversion was replaced', () => {
        const secret = `sk-proj-${'a1'.repeat(20)}`;
        const date = Object.assign(new Date('2026-01-02T03:04:05.000Z'), {
            toISOString: () => secret,
        });
        const pattern = Object.assign(/ab/g, { toString: () => secret });

        expect(safeStringify({ date, pattern })).toBe(
            '{"date":"[REDACTED]","pattern":"[REDACTED]"}'
        );
        expect(safeStringify(date)).toBe('"[REDACTED]"');
        expect(safeStringify(pattern)).toBe('"[REDACTED]"');

        const selfReturning = new Date('2026-01-02T03:04:05.000Z');
        Object.assign(selfReturning, { toISOString: () => selfReturning });
        expect(safeStringify(selfReturning)).toBe(JSON.stringify(String(selfReturning)));
    });

    it('does not invoke toJSON on function values or install them as a prototype', () => {
        const secret = `sk-proj-${'a1'.repeat(20)}`;
        const inherited = Object.assign(() => {}, { toJSON: () => secret });
        const value = Object.defineProperty({ visible: 'kept' }, '__proto__', {
            value: inherited,
            enumerable: true,
        });

        expect(safeStringify(value).includes(secret)).toBe(false);
        expect(safeStringify({ fn: inherited }).includes(secret)).toBe(false);
        expect(safeStringify([inherited]).includes(secret)).toBe(false);
        expect(safeStringify(inherited).includes(secret)).toBe(false);
    });

    it('does not stringify the original value when redaction throws', () => {
        const secret = `sk-proj-${'a1'.repeat(20)}`;
        const value = {
            get broken(): unknown {
                throw new Error('unreadable');
            },
            toString: () => secret,
        };

        expect(safeStringify(value)).toBe('[Unserializable value]');
    });

    it('keeps a nested error message while redacting its contents', () => {
        const secret = `sk-proj-${'a1'.repeat(20)}`;
        const result = safeStringify({ error: new Error(`failed with ${secret}`) });

        expect(result).toContain('failed with [REDACTED]');
        expect(result).not.toContain(secret);
    });

    it('masks log-style secrets in nested error details', () => {
        const error = new Error('password=hunter2', { cause: { clientSecret: 'hunter2' } });

        const result = safeStringify({ error });

        expect(result.includes('hunter2')).toBe(false);
        expect(result).toContain('[REDACTED]');
    });

    it('does not read a wide error past the length budget', () => {
        const error = new Error('failure');
        let reads = 0;
        for (let index = 0; index < 5000; index += 1) {
            Object.defineProperty(error, `field${index}`, {
                enumerable: true,
                get() {
                    reads += 1;
                    if (index === 4999) throw new Error('should not be read');
                    return 'value';
                },
            });
        }

        expect(safeStringify({ error }, 500)).toContain('failure');
        expect(reads).toBeLessThan(100);
    });

    it('does not read a sensitive error array past the length budget', () => {
        let reads = 0;
        const values = new Proxy(
            Array.from({ length: 100_000 }, () => 'secret'),
            {
                get(target, key, receiver) {
                    if (typeof key === 'string' && /^\d+$/.test(key)) reads += 1;
                    return Reflect.get(target, key, receiver);
                },
            }
        );
        const error = Object.assign(new Error('failure'), { accessToken: values, stack: 'stack' });

        safeStringify(error, 500);
        expect(reads).toBeLessThan(100);
    });

    it('does not preserve an error array subclass with a toJSON method', () => {
        const secret = `sk-proj-${'a1'.repeat(20)}`;
        class SensitiveArray extends Array<string> {
            toJSON() {
                return secret;
            }
        }
        const error = Object.assign(new Error('failure'), {
            clientSecret: new SensitiveArray('value'),
        });

        expect(safeStringify(error).includes(secret)).toBe(false);
    });

    it('counts empty array entries against the budget, including in error causes', () => {
        let reads = 0;
        const values = new Proxy(new Array<unknown>(100_000), {
            get(target, key, receiver) {
                if (typeof key === 'string' && /^\d+$/.test(key)) reads += 1;
                return Reflect.get(target, key, receiver);
            },
        });
        const error = new Error('failure', { cause: { accessToken: values } });
        error.stack = 'stack';

        safeStringify(values, 500);
        expect(reads).toBeLessThan(500);
        reads = 0;
        safeStringify(error, 500);
        expect(reads).toBeLessThan(500);
    });

    it('bounds deeply nested objects even without a length limit', () => {
        let value: Record<string, unknown> = { leaf: true };
        for (let level = 0; level < 5000; level += 1) value = { nested: value };

        const uncapped = safeStringify(value);
        expect(uncapped).toBe('"[Too deep]"');
        expect(safeStringify(value, CAP)).toBe('"[Too deep]"');
    });

    it('preserves a valid 150-level tool result', () => {
        let value: Record<string, unknown> = { leaf: true };
        for (let level = 0; level < 150; level += 1) value = { nested: value };

        expect(safeStringify(value)).toBe(JSON.stringify(value));
    });

    it('bounds depth when earlier shared objects are reused at deeper levels', () => {
        const nodes: Record<string, unknown>[] = [];
        let node: Record<string, unknown> = { leaf: true };
        for (let level = 0; level < 600; level += 1) {
            node = { previous: node };
            nodes.push(node);
        }

        expect(safeStringify(nodes)).toContain('[Too deep]');
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

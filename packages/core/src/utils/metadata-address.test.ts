import { describe, expect, it } from 'vitest';
import {
    createMetadataCheckedLookup,
    isMetadataHost,
    isMetadataTarget,
} from './metadata-address.js';

const hostOf = (url: string) => new URL(url).hostname;

describe('isMetadataHost', () => {
    it.each([
        'http://169.254.169.254/',
        'http://169.254.170.2/',
        'http://169.254.169.254./',
        'http://0xa9fea9fe/',
        'http://2852039166/',
        'http://0251.0376.0251.0376/',
        'http://[::ffff:169.254.169.254]/',
        'http://[::ffff:a9fe:a9fe]/',
        'http://[::a9fe:a9fe]/',
        'http://[64:ff9b::a9fe:a9fe]/',
        'http://[2002:a9fe:a9fe::1]/',
        'http://[fe80::1]/',
        'http://[febf::1]/',
        'http://[fd00:ec2::254]/',
        'http://[FD00:EC2:0:0:0:0:0:254]/',
        'http://100.100.100.200/',
        'http://[::ffff:100.100.100.200]/',
        'http://metadata.google.internal/',
        'http://metadata.google.internal./',
        'http://METADATA.GOOGLE.INTERNAL/',
        'http://metadata.goog/',
        'http://instance-data.ec2.internal/',
    ])('blocks %s', (url) => {
        expect(isMetadataHost(hostOf(url))).toBe(true);
    });

    it.each([
        'http://localhost:3001/',
        'http://127.0.0.1/',
        'http://10.0.0.5/',
        'http://192.168.1.20/',
        'http://100.64.0.1/',
        'http://[::1]/',
        'http://[::ffff:127.0.0.1]/',
        'http://[fd00::1]/',
        'http://[fec0::1]/',
        'http://169.255.0.1/',
        'https://example.com/',
    ])('allows %s', (url) => {
        expect(isMetadataHost(hostOf(url))).toBe(false);
    });
});

describe('isMetadataTarget', () => {
    it('blocks a name that resolves to a metadata address, including in a mixed answer', async () => {
        expect(await isMetadataTarget('rebind.example', async () => ['169.254.169.254'])).toBe(
            true
        );
        expect(
            await isMetadataTarget('rebind.example', async () => [
                '93.184.216.34',
                '::ffff:a9fe:a9fe',
            ])
        ).toBe(true);
        expect(await isMetadataTarget('rebind.example', async () => ['fe80::1'])).toBe(true);
    });

    it('allows names that resolve to public, loopback or private addresses', async () => {
        expect(await isMetadataTarget('example.com', async () => ['93.184.216.34'])).toBe(false);
        expect(await isMetadataTarget('local.example', async () => ['127.0.0.1', '10.0.0.5'])).toBe(
            false
        );
    });

    it('does not block a name that fails to resolve', async () => {
        expect(
            await isMetadataTarget('missing.example', async () => {
                throw new Error('ENOTFOUND');
            })
        ).toBe(false);
    });

    it('does not look up IP literals or metadata names', async () => {
        const resolve = async () => {
            throw new Error('should not resolve');
        };
        expect(await isMetadataTarget('10.0.0.5', resolve)).toBe(false);
        expect(await isMetadataTarget('metadata.google.internal.', resolve)).toBe(true);
    });
});

describe('createMetadataCheckedLookup', () => {
    const lookupWith = (answers: string[][]) => {
        let call = 0;
        const resolve = async () => answers[Math.min(call++, answers.length - 1)] ?? [];
        return { lookup: createMetadataCheckedLookup(resolve), calls: () => call };
    };

    const run = (
        lookup: ReturnType<typeof createMetadataCheckedLookup>,
        host: string,
        all: boolean
    ) =>
        new Promise<{ error: NodeJS.ErrnoException | null; address: unknown; family?: number }>(
            (resolve) => {
                lookup(host, { all }, (error, address, family) =>
                    resolve({ error, address, ...(family !== undefined && { family }) })
                );
            }
        );

    it('hands the connection the addresses it checked, resolving only once', async () => {
        const { lookup, calls } = lookupWith([['93.184.216.34'], ['169.254.169.254']]);
        const result = await run(lookup, 'rebind.example', true);
        expect(result.error).toBeNull();
        expect(result.address).toEqual([{ address: '93.184.216.34', family: 4 }]);
        expect(calls()).toBe(1);
    });

    it('returns a single address when asked for one', async () => {
        const { lookup } = lookupWith([['::1', '10.0.0.5']]);
        const result = await run(lookup, 'local.example', false);
        expect(result).toMatchObject({ error: null, address: '::1', family: 6 });
    });

    it('refuses a name when any answer is a metadata address', async () => {
        const { lookup } = lookupWith([['93.184.216.34', '::ffff:a9fe:a9fe']]);
        for (const all of [true, false]) {
            const result = await run(lookup, 'rebind.example', all);
            expect(result.error?.code).toBe('EMETADATA');
        }
    });

    it('refuses metadata host names without resolving them', async () => {
        const { lookup, calls } = lookupWith([['93.184.216.34']]);
        const result = await run(lookup, 'metadata.google.internal.', true);
        expect(result.error?.code).toBe('EMETADATA');
        expect(calls()).toBe(0);
    });

    it('passes a resolution failure on', async () => {
        const lookup = createMetadataCheckedLookup(async () => {
            throw new Error('ENOTFOUND');
        });
        const result = await run(lookup, 'missing.example', true);
        expect(result.error?.message).toBe('ENOTFOUND');
    });
});

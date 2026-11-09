import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSafeDownload } from './safe-download.js';

let server: Server;
let port: number;
let hits: string[];
let lastHeaders: Record<string, string | string[] | undefined>;

beforeEach(async () => {
    hits = [];
    server = createServer((request, response) => {
        hits.push(request.url ?? '');
        lastHeaders = request.headers;
        if (request.url === '/image.png') {
            response.writeHead(200, { 'content-type': 'image/png; charset=binary' });
            response.end(Buffer.from([1, 2, 3]));
        } else if (request.url === '/to-internal') {
            response.writeHead(302, { location: `http://internal.example:${port}/secret` });
            response.end();
        } else if (request.url === '/to-metadata') {
            response.writeHead(302, { location: `http://metadata.google.internal:${port}/token` });
            response.end();
        } else if (request.url === '/loop') {
            response.writeHead(302, { location: '/loop' });
            response.end();
        } else {
            response.writeHead(404);
            response.end();
        }
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    port = (server.address() as AddressInfo).port;
});

afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
});

const request = (url: string) => [{ url: new URL(url), isUrlSupportedByModel: false }];

describe('createSafeDownload', () => {
    it('refuses a host name that resolves to a private address, without connecting', async () => {
        const dnsLookup = vi.fn().mockResolvedValue([{ address: '127.0.0.1', family: 4 }]);
        const download = createSafeDownload({ dnsLookup });

        await expect(download(request(`http://rebind.example:${port}/image.png`))).rejects.toThrow(
            /private address 127\.0\.0\.1/
        );
        expect(hits).toEqual([]);
    });

    it('refuses a name when any one of its answers is private', async () => {
        const dnsLookup = vi.fn().mockResolvedValue([
            { address: '93.184.216.34', family: 4 },
            { address: '10.0.0.5', family: 4 },
        ]);
        const download = createSafeDownload({ dnsLookup });

        await expect(download(request(`http://mixed.example:${port}/image.png`))).rejects.toThrow(
            /private address 10\.0\.0\.5/
        );
    });

    it('refuses localhost and IP literals with the real resolver', async () => {
        const download = createSafeDownload();

        await expect(download(request(`http://localhost:${port}/image.png`))).rejects.toThrow();
        await expect(download(request(`http://127.0.0.1:${port}/image.png`))).rejects.toThrow(
            /private address/
        );
        await expect(download(request(`http://[::1]:${port}/image.png`))).rejects.toThrow(
            /private address/
        );
        await expect(download(request('http://[64:ff9b::7f00:1]/image.png'))).rejects.toThrow(
            /private address/
        );
        expect(hits).toEqual([]);
    });

    it('downloads from the checked address and reports the media type', async () => {
        const dnsLookup = vi.fn().mockResolvedValue([{ address: '127.0.0.1', family: 4 }]);
        const download = createSafeDownload({ dnsLookup, isBlockedAddress: () => false });

        const [result] = await download(request(`http://files.example:${port}/image.png`));

        expect(result).toEqual({ data: new Uint8Array([1, 2, 3]), mediaType: 'image/png' });
        expect(dnsLookup).toHaveBeenCalledWith('files.example', { all: true, verbatim: true });
    });

    it('names itself and accepts any type, as hosts such as Wikimedia require', async () => {
        const dnsLookup = vi.fn().mockResolvedValue([{ address: '127.0.0.1', family: 4 }]);
        const download = createSafeDownload({ dnsLookup, isBlockedAddress: () => false });

        await download(request(`http://files.example:${port}/image.png`));

        expect(lastHeaders['user-agent']).toBe('@dexto/core');
        expect(lastHeaders.accept).toBe('*/*');
    });

    it('checks the address of every redirect', async () => {
        const dnsLookup = vi.fn(async (hostname: string) => [
            { address: hostname === 'internal.example' ? '10.0.0.5' : '127.0.0.1', family: 4 },
        ]);
        const download = createSafeDownload({
            dnsLookup,
            isBlockedAddress: (address) => address === '10.0.0.5',
        });

        await expect(download(request(`http://files.example:${port}/to-internal`))).rejects.toThrow(
            /private address 10\.0\.0\.5/
        );
        expect(hits).toEqual(['/to-internal']);
    });

    it.each([
        'metadata.google.internal',
        'METADATA.GOOG',
        'instance-data.',
        'instance-data.ec2.internal',
        '169.254.169.254',
    ])('refuses the cloud metadata host %s without resolving it', async (host) => {
        const dnsLookup = vi.fn().mockResolvedValue([{ address: '127.0.0.1', family: 4 }]);
        const download = createSafeDownload({ dnsLookup, isBlockedAddress: () => false });

        await expect(download(request(`http://${host}:${port}/token`))).rejects.toThrow(
            /cloud metadata host/
        );
        expect(dnsLookup).not.toHaveBeenCalled();
        expect(hits).toEqual([]);
    });

    it.each(['168.63.129.16', '192.0.0.192', '100.100.100.200'])(
        'refuses a public name that answers the metadata address %s, even with the address check off',
        async (address) => {
            const dnsLookup = vi.fn().mockResolvedValue([
                { address: '93.184.216.34', family: 4 },
                { address, family: 4 },
            ]);
            const download = createSafeDownload({ dnsLookup, isBlockedAddress: () => false });

            await expect(
                download(request(`http://files.example:${port}/image.png`))
            ).rejects.toThrow(
                new RegExp(`cloud metadata address ${address.replaceAll('.', '\\.')}`)
            );
            expect(dnsLookup).toHaveBeenCalledOnce();
            expect(hits).toEqual([]);
        }
    );

    it('refuses the WireServer answer with the default address check', async () => {
        const dnsLookup = vi.fn().mockResolvedValue([{ address: '168.63.129.16', family: 4 }]);
        const download = createSafeDownload({ dnsLookup });

        await expect(download(request(`http://files.example:${port}/image.png`))).rejects.toThrow(
            /cloud metadata address 168\.63\.129\.16/
        );
        expect(hits).toEqual([]);
    });

    it('refuses a redirect to a metadata host name', async () => {
        const dnsLookup = vi.fn().mockResolvedValue([{ address: '127.0.0.1', family: 4 }]);
        const download = createSafeDownload({ dnsLookup, isBlockedAddress: () => false });

        await expect(download(request(`http://files.example:${port}/to-metadata`))).rejects.toThrow(
            /cloud metadata host/
        );
        expect(hits).toEqual(['/to-metadata']);
    });

    it('stops redirect loops', async () => {
        const dnsLookup = vi.fn().mockResolvedValue([{ address: '127.0.0.1', family: 4 }]);
        const download = createSafeDownload({ dnsLookup, isBlockedAddress: () => false });

        await expect(download(request(`http://files.example:${port}/loop`))).rejects.toThrow(
            /Too many redirects/
        );
    });

    it('fails on an error status', async () => {
        const dnsLookup = vi.fn().mockResolvedValue([{ address: '127.0.0.1', family: 4 }]);
        const download = createSafeDownload({ dnsLookup, isBlockedAddress: () => false });

        await expect(download(request(`http://files.example:${port}/missing`))).rejects.toThrow(
            /404/
        );
    });

    it('refuses schemes other than http and https', async () => {
        const download = createSafeDownload();

        await expect(download(request('file:///etc/passwd'))).rejects.toThrow(/http or https/);
    });

    it('leaves URLs the model fetches itself alone', async () => {
        const dnsLookup = vi.fn();
        const download = createSafeDownload({ dnsLookup });

        const results = await download([
            { url: new URL('https://example.com/image.png'), isUrlSupportedByModel: true },
        ]);

        expect(results).toEqual([null]);
        expect(dnsLookup).not.toHaveBeenCalled();
    });
});

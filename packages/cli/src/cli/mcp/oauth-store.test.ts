import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { chmod, mkdir, mkdtemp, readdir, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { getDextoPath } from '@dexto/core';
import { loadMcpAuthStore, saveMcpAuthStore, type McpAuthStore } from './oauth-store.js';

const infoMock = vi.hoisted(() => vi.fn());
const warnMock = vi.hoisted(() => vi.fn());
vi.mock('@dexto/core', () => ({
    getDextoPath: vi.fn(),
    logger: { info: infoMock, warn: warnMock },
}));

const serverUrl = 'https://good.example/mcp';
const oldStore: McpAuthStore = {
    tokens: { access_token: 'legacy-token', token_type: 'Bearer' },
};

let directory: string;
beforeEach(async () => {
    directory = await mkdtemp(path.join(tmpdir(), 'dexto-mcp-oauth-'));
    vi.mocked(getDextoPath).mockImplementation((subdir, filename) => {
        if (!subdir || !filename) throw new Error('Expected OAuth store directory and filename');
        return path.join(directory, subdir, filename);
    });
});
afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
    vi.clearAllMocks();
});

describe('MCP OAuth SDK v1 persistence compatibility', () => {
    it('retains issuer metadata with token and client records', async () => {
        const store: McpAuthStore = {
            tokens: {
                access_token: 'synthetic-token',
                token_type: 'Bearer',
                refresh_token: 'synthetic-refresh',
                issuer: 'https://issuer.example',
            },
            clientInformation: {
                client_id: 'synthetic-client',
                issuer: 'https://issuer.example',
            },
            codeVerifier: 'synthetic-verifier',
        };
        await saveMcpAuthStore(serverUrl, store);
        await expect(loadMcpAuthStore(serverUrl)).resolves.toEqual(store);
    });
});

describe('MCP OAuth entries saved by server name', () => {
    const storeDirectory = () => path.join(directory, 'mcp-auth');

    async function writeNameKeyedEntry(name: string): Promise<void> {
        await mkdir(storeDirectory(), { recursive: true });
        await writeFile(path.join(storeDirectory(), `${name}.json`), JSON.stringify(oldStore), {
            mode: 0o644,
        });
    }

    it('does not send an old entry to the server that reuses its name', async () => {
        await writeNameKeyedEntry('fixture');

        await expect(loadMcpAuthStore(serverUrl)).resolves.toEqual({});
        await expect(loadMcpAuthStore('https://other.example/mcp')).resolves.toEqual({});
    });

    it('deletes old entries and logs one info line', async () => {
        await writeNameKeyedEntry('fixture');
        await writeNameKeyedEntry('another-server');

        await loadMcpAuthStore(serverUrl);

        expect(await readdir(storeDirectory())).toEqual([]);
        expect(infoMock).toHaveBeenCalledTimes(1);
        expect(infoMock).toHaveBeenCalledWith(expect.stringContaining('sign in'));
    });

    it('keeps credentials saved by URL when it removes old entries', async () => {
        await saveMcpAuthStore(serverUrl, oldStore);
        await writeNameKeyedEntry('fixture');

        await expect(loadMcpAuthStore(serverUrl)).resolves.toEqual(oldStore);
        expect(await readdir(storeDirectory())).toHaveLength(1);
    });

    it('keeps working when an old entry cannot be removed', async () => {
        await saveMcpAuthStore(serverUrl, oldStore);
        await mkdir(path.join(storeDirectory(), 'subdir.json'));
        await writeNameKeyedEntry('fixture');

        await expect(loadMcpAuthStore(serverUrl)).resolves.toEqual(oldStore);
        await saveMcpAuthStore(serverUrl, {});
        await expect(loadMcpAuthStore(serverUrl)).resolves.toEqual({});

        expect(await readdir(storeDirectory())).not.toContain('fixture.json');
        expect(warnMock).toHaveBeenCalledWith(expect.stringContaining("'subdir.json'"));
        expect(infoMock).toHaveBeenCalledTimes(1);
    });

    it('logs nothing when there are no old entries', async () => {
        await saveMcpAuthStore(serverUrl, oldStore);

        await loadMcpAuthStore(serverUrl);

        expect(infoMock).not.toHaveBeenCalled();
    });

    it('returns an empty store when nothing was saved', async () => {
        await expect(loadMcpAuthStore(serverUrl)).resolves.toEqual({});
    });

    it('tightens the mode of a URL-keyed file saved world-readable', async () => {
        await saveMcpAuthStore(serverUrl, oldStore);
        const [file] = await readdir(storeDirectory());
        await chmod(path.join(storeDirectory(), file ?? ''), 0o644);

        await loadMcpAuthStore(serverUrl);

        expect((await stat(path.join(storeDirectory(), file ?? ''))).mode & 0o777).toBe(0o600);
    });
});

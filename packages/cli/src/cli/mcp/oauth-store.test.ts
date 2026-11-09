import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { chmod, mkdir, mkdtemp, readdir, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { getDextoPath } from '@dexto/core';
import { loadMcpAuthStore, saveMcpAuthStore, type McpAuthStore } from './oauth-store.js';

vi.mock('@dexto/core', () => ({ getDextoPath: vi.fn() }));

const server = { name: 'fixture', url: 'https://good.example/mcp' };
const legacyStore: McpAuthStore = {
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
        await saveMcpAuthStore(server, store);
        await expect(loadMcpAuthStore(server)).resolves.toEqual(store);
    });
});

describe('MCP OAuth entries saved by server name', () => {
    async function writeLegacyEntry(name: string): Promise<string> {
        const folder = path.join(directory, 'mcp-auth');
        await mkdir(folder, { recursive: true });
        const legacyPath = path.join(folder, `${name}.json`);
        await writeFile(legacyPath, JSON.stringify(legacyStore), { mode: 0o644 });
        return legacyPath;
    }

    it('moves the entry to the first server URL that reads it', async () => {
        await writeLegacyEntry(server.name);

        await expect(loadMcpAuthStore(server)).resolves.toEqual(legacyStore);
        await expect(loadMcpAuthStore(server)).resolves.toEqual(legacyStore);
        expect(await readdir(path.join(directory, 'mcp-auth'))).toHaveLength(1);
    });

    it('does not give the entry to a second URL that reuses the name', async () => {
        await writeLegacyEntry(server.name);
        await loadMcpAuthStore(server);

        await expect(
            loadMcpAuthStore({ name: server.name, url: 'https://other.example/mcp' })
        ).resolves.toEqual({});
    });

    it('makes a migrated entry private to its owner', async () => {
        await writeLegacyEntry(server.name);
        await loadMcpAuthStore(server);

        const folder = path.join(directory, 'mcp-auth');
        const [file] = await readdir(folder);
        expect((await stat(path.join(folder, file ?? ''))).mode & 0o777).toBe(0o600);
    });

    it('returns an empty store when nothing was saved', async () => {
        await expect(loadMcpAuthStore(server)).resolves.toEqual({});
    });

    it('tightens the mode of a URL-keyed file saved world-readable', async () => {
        await saveMcpAuthStore(server, legacyStore);
        const folder = path.join(directory, 'mcp-auth');
        const [file] = await readdir(folder);
        await chmod(path.join(folder, file ?? ''), 0o644);

        await loadMcpAuthStore(server);

        expect((await stat(path.join(folder, file ?? ''))).mode & 0o777).toBe(0o600);
    });
});

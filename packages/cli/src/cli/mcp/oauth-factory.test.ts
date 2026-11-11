import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, readdir, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { getDextoPath, type ValidatedMcpServerConfig } from '@dexto/core';
import { createMcpAuthProviderFactory } from './oauth-factory.js';

vi.mock('@dexto/core', () => ({ getDextoPath: vi.fn(), logger: { info: vi.fn(), warn: vi.fn() } }));

const openMock = vi.hoisted(() => vi.fn());
vi.mock('open', () => ({ default: openMock }));

function httpServer(url: string): ValidatedMcpServerConfig {
    return {
        type: 'http',
        enabled: true,
        url,
        headers: {},
        timeout: 30000,
        connectionMode: 'strict',
    } as unknown as ValidatedMcpServerConfig;
}

function createProvider(name: string, url: string) {
    const provider = createMcpAuthProviderFactory({})(name, httpServer(url));
    if (!provider) throw new Error('Expected an OAuth provider for an http server');
    return provider;
}

const tokens = { access_token: 'synthetic-token', token_type: 'Bearer' };

let directory: string;
beforeEach(async () => {
    directory = await mkdtemp(path.join(tmpdir(), 'dexto-mcp-oauth-factory-'));
    vi.mocked(getDextoPath).mockImplementation((subdir, filename) => {
        if (!subdir || !filename) throw new Error('Expected OAuth store directory and filename');
        return path.join(directory, subdir, filename);
    });
    vi.spyOn(console, 'log').mockImplementation(() => {});
});
afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
    vi.restoreAllMocks();
    vi.clearAllMocks();
});

describe('MCP OAuth credential binding', () => {
    it('does not hand a saved token to a different server URL that reuses the name', async () => {
        await createProvider('shared-name', 'https://good.example/mcp').saveTokens(tokens);

        await expect(
            createProvider('shared-name', 'https://other.example/mcp').tokens()
        ).resolves.toBeUndefined();
    });

    it('does not hand a saved token to a different path on the same origin', async () => {
        await createProvider('shared-name', 'https://good.example/team-a/mcp').saveTokens(tokens);

        await expect(
            createProvider('shared-name', 'https://good.example/team-b/mcp').tokens()
        ).resolves.toBeUndefined();
    });

    it('does not send a token an older version saved under the server name', async () => {
        const storeDirectory = path.join(directory, 'mcp-auth');
        await mkdir(storeDirectory, { recursive: true });
        const oldFile = path.join(storeDirectory, 'shared-name.json');
        await writeFile(oldFile, JSON.stringify({ tokens }));

        await expect(
            createProvider('shared-name', 'https://good.example/mcp').tokens()
        ).resolves.toBeUndefined();
        await expect(readdir(storeDirectory)).resolves.toEqual([]);
    });

    it('returns the saved token for the same URL whatever the server is named', async () => {
        await createProvider('first-name', 'https://good.example/mcp').saveTokens(tokens);

        await expect(
            createProvider('second-name', 'https://good.example/mcp').tokens()
        ).resolves.toEqual(tokens);
    });

    it('ignores the query string and a trailing slash when matching the URL', async () => {
        await createProvider('server', 'https://good.example/mcp/?session=1').saveTokens(tokens);

        await expect(
            createProvider('server', 'https://GOOD.example/mcp').tokens()
        ).resolves.toEqual(tokens);
    });

    it('writes the token file readable only by its owner', async () => {
        await createProvider('server', 'https://good.example/mcp').saveTokens(tokens);

        const storeDirectory = path.join(directory, 'mcp-auth');
        const files = await readdir(storeDirectory);
        expect(files).toHaveLength(1);
        const file = await stat(path.join(storeDirectory, files[0] ?? ''));
        expect(file.mode & 0o777).toBe(0o600);
        const folder = await stat(storeDirectory);
        expect(folder.mode & 0o777).toBe(0o700);
    });
});

describe('MCP OAuth authorization URL', () => {
    it.each(['https://auth.example/authorize?client_id=x', 'http://localhost:9000/authorize'])(
        'opens %s in the browser',
        async (authorizationUrl) => {
            await createProvider('server', 'https://good.example/mcp').redirectToAuthorization(
                new URL(authorizationUrl)
            );

            expect(openMock).toHaveBeenCalledWith(authorizationUrl, { wait: false });
        }
    );

    it.each(['file:///etc/passwd', 'javascript:alert(1)', 'ftp://host/file', 'ms-msdt:/id'])(
        'refuses to open %s',
        async (authorizationUrl) => {
            await expect(
                createProvider('server', 'https://good.example/mcp').redirectToAuthorization(
                    new URL(authorizationUrl)
                )
            ).rejects.toThrow(/http/i);

            expect(openMock).not.toHaveBeenCalled();
        }
    );
});

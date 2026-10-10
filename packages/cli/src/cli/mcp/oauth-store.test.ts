import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { getDextoPath } from '@dexto/core';
import { loadMcpAuthStore, saveMcpAuthStore, type McpAuthStore } from './oauth-store.js';

vi.mock('@dexto/core', () => ({ getDextoPath: vi.fn() }));

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
        await saveMcpAuthStore('fixture', store);
        await expect(loadMcpAuthStore('fixture')).resolves.toEqual(store);
    });
});

import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { getDextoPath } from '@dexto/core';
import type {
    OAuthTokens,
    OAuthClientInformationMixed,
} from '@modelcontextprotocol/sdk/shared/auth.js';

export type McpAuthStore = {
    tokens?: OAuthTokens | undefined;
    clientInformation?: OAuthClientInformationMixed | undefined;
    codeVerifier?: string | undefined;
};

/**
 * Credentials belong to a server URL, not to the name a config gives it. The name is only used
 * to find entries saved before credentials were keyed by URL.
 */
export type McpAuthServer = {
    name: string;
    url: string;
};

export async function loadMcpAuthStore(server: McpAuthServer): Promise<McpAuthStore> {
    const filePath = getMcpAuthStorePath(server.url);
    const store = await readStoreFile(filePath);
    if (store) {
        await fs.chmod(filePath, 0o600);
        return store;
    }
    return await migrateNameKeyedStore(server, filePath);
}

export async function saveMcpAuthStore(server: McpAuthServer, store: McpAuthStore): Promise<void> {
    const filePath = getMcpAuthStorePath(server.url);
    await fs.mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
    await fs.writeFile(filePath, JSON.stringify(store, null, 2), { mode: 0o600 });
    await fs.chmod(filePath, 0o600);
}

export function getMcpAuthStorePath(serverUrl: string): string {
    return getDextoPath('mcp-auth', `${hashServerUrl(serverUrl)}.json`);
}

function hashServerUrl(serverUrl: string): string {
    const { origin, pathname } = new URL(serverUrl);
    const normalizedPath = pathname.replace(/\/+$/, '');
    return createHash('sha256').update(`${origin}${normalizedPath}`).digest('hex').slice(0, 32);
}

async function readStoreFile(filePath: string): Promise<McpAuthStore | undefined> {
    try {
        return JSON.parse(await fs.readFile(filePath, 'utf8')) as McpAuthStore;
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
            return undefined;
        }
        throw error;
    }
}

/**
 * Entries saved before credentials were keyed by URL are named files. The first server URL to
 * read one takes it; moving the file keeps any later server with the same name from reading it.
 */
async function migrateNameKeyedStore(
    server: McpAuthServer,
    filePath: string
): Promise<McpAuthStore> {
    const legacyPath = getDextoPath('mcp-auth', `${sanitizeServerName(server.name)}.json`);
    await fs.mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
    try {
        await fs.rename(legacyPath, filePath);
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
            return (await readStoreFile(filePath)) ?? {};
        }
        throw error;
    }
    await fs.chmod(filePath, 0o600);
    return (await readStoreFile(filePath)) ?? {};
}

function sanitizeServerName(serverName: string): string {
    return serverName.replace(/[^a-zA-Z0-9._-]/g, '_');
}

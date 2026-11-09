import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { getDextoPath, logger } from '@dexto/core';
import type {
    OAuthTokens,
    OAuthClientInformationMixed,
} from '@modelcontextprotocol/sdk/shared/auth.js';

export type McpAuthStore = {
    tokens?: OAuthTokens | undefined;
    clientInformation?: OAuthClientInformationMixed | undefined;
    codeVerifier?: string | undefined;
};

const STORE_FILE_EXTENSION = '.json';
const URL_KEYED_FILE = /^[0-9a-f]{32}\.json$/;

/** Credentials belong to a server URL, not to the name a config gives it. */
export async function loadMcpAuthStore(serverUrl: string): Promise<McpAuthStore> {
    await removeNameKeyedStores();
    const filePath = getMcpAuthStorePath(serverUrl);
    try {
        const store = JSON.parse(await fs.readFile(filePath, 'utf8')) as McpAuthStore;
        await fs.chmod(filePath, 0o600);
        return store;
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
            return {};
        }
        throw error;
    }
}

export async function saveMcpAuthStore(serverUrl: string, store: McpAuthStore): Promise<void> {
    const filePath = getMcpAuthStorePath(serverUrl);
    await fs.mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
    await fs.writeFile(filePath, JSON.stringify(store, null, 2), { mode: 0o600 });
    await fs.chmod(filePath, 0o600);
}

export function getMcpAuthStorePath(serverUrl: string): string {
    return getDextoPath('mcp-auth', `${hashServerUrl(serverUrl)}${STORE_FILE_EXTENSION}`);
}

function hashServerUrl(serverUrl: string): string {
    const { origin, pathname } = new URL(serverUrl);
    const normalizedPath = pathname.replace(/\/+$/, '');
    return createHash('sha256').update(`${origin}${normalizedPath}`).digest('hex').slice(0, 32);
}

/**
 * Credentials used to be saved under the server's name. Nothing records which URL such an entry
 * was issued for, so it could be sent to the wrong server; delete it and let the user sign in
 * again.
 */
async function removeNameKeyedStores(): Promise<void> {
    const directory = path.dirname(getMcpAuthStorePath('https://localhost/'));
    let files: string[];
    try {
        files = await fs.readdir(directory);
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
            return;
        }
        throw error;
    }

    const nameKeyed = files.filter(
        (file) => file.endsWith(STORE_FILE_EXTENSION) && !URL_KEYED_FILE.test(file)
    );
    await Promise.all(nameKeyed.map((file) => fs.rm(path.join(directory, file), { force: true })));
    if (nameKeyed.length > 0) {
        logger.info(
            `Removed ${nameKeyed.length} saved MCP OAuth credential file(s) stored by server name; sign in to those servers again.`
        );
    }
}

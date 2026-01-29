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

export async function loadMcpAuthStore(serverId: string): Promise<McpAuthStore> {
    const filePath = getMcpAuthStorePath(serverId);
    try {
        const data = await fs.readFile(filePath, 'utf8');
        return JSON.parse(data) as McpAuthStore;
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
            return {};
        }
        throw error;
    }
}

export async function saveMcpAuthStore(serverId: string, store: McpAuthStore): Promise<void> {
    const filePath = getMcpAuthStorePath(serverId);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, JSON.stringify(store, null, 2));
}

export function getMcpAuthStorePath(serverId: string): string {
    return getDextoPath('mcp-auth', `${sanitizeServerId(serverId)}.json`);
}

function sanitizeServerId(serverId: string): string {
    return serverId.replace(/[^a-zA-Z0-9._-]/g, '_');
}

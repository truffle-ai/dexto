// The Dexto MCP in local sessions: when signed in, every session gets Dexto's workspace tools
// (connectors, Drive, Sites and Apps, Loops, memory and the rest of the catalog) as an MCP server.

import type { McpAuthProvider, McpAuthProviderFactory } from '@dexto/core';
import { type DextoGatewayOptions, currentCredential } from './dexto-gateway.js';

export const DEXTO_MCP_SERVER_NAME = 'dexto';

export interface DextoMcpServerConfig {
    readonly type: 'http';
    readonly url: string;
    /** A cloud outage leaves the server unavailable; the local turn still runs. */
    readonly connectionMode: 'lenient';
}

/** The Dexto MCP as a server config when signed in as a person; null for a key or signed out. */
export async function dextoMcpServer(
    options: DextoGatewayOptions
): Promise<DextoMcpServerConfig | null> {
    const credential = await currentCredential(options);
    if (credential?.kind !== 'oauth') return null;
    return { type: 'http', url: credential.login.resource, connectionMode: 'lenient' };
}

/**
 * Authorizes the Dexto MCP with the sign-in's token. It never registers a client or opens a
 * browser: `dexto login` owns that, and the token is refreshed there. Without a refresh token in
 * what it hands over, the MCP client asks to authorize again only when the server refuses the
 * token, and that says how.
 */
export function dextoMcpAuthProvider(options: DextoGatewayOptions): McpAuthProvider {
    return {
        get redirectUrl() {
            return undefined;
        },
        get clientMetadata() {
            return { client_name: 'Dexto CLI', redirect_uris: [] };
        },
        async clientInformation() {
            const credential = await currentCredential(options);
            return credential?.kind === 'oauth'
                ? { client_id: credential.login.clientId }
                : undefined;
        },
        async tokens() {
            const credential = await currentCredential(options);
            return credential?.kind === 'oauth'
                ? { access_token: credential.token, token_type: 'Bearer' }
                : undefined;
        },
        saveTokens: () => undefined,
        redirectToAuthorization: async () => {
            throw new Error(
                'The Dexto sign-in expired or lacks a permission this tool needs. Run dexto login, or dexto login --scope <permission>.'
            );
        },
        saveCodeVerifier: () => undefined,
        codeVerifier: () => {
            throw new Error('The Dexto MCP signs in with dexto login, not here.');
        },
    };
}

/** The session's MCP servers with the Dexto MCP added, unless the person named a server dexto. */
export function withDextoMcpServer<Server>(
    servers: Readonly<Record<string, Server>> | undefined,
    dexto: DextoMcpServerConfig | null
): Record<string, Server | DextoMcpServerConfig> {
    if (dexto === null || servers?.[DEXTO_MCP_SERVER_NAME] !== undefined) return { ...servers };
    return { ...servers, [DEXTO_MCP_SERVER_NAME]: dexto };
}

/** Authorizes the dexto server with the sign-in and every other server as `inner` does. */
export function withDextoMcpAuth(
    inner: McpAuthProviderFactory | null,
    options: DextoGatewayOptions
): McpAuthProviderFactory {
    return (serverName, config) =>
        serverName === DEXTO_MCP_SERVER_NAME
            ? dextoMcpAuthProvider(options)
            : (inner?.(serverName, config) ?? undefined);
}

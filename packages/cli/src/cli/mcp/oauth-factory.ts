import type { McpAuthProviderFactory, ValidatedMcpServerConfig } from '@dexto/core';
import { createMcpOAuthProvider } from './oauth-provider.js';
import { getMcpRedirectUrl } from './oauth-redirect.js';
import { logger as coreLogger } from '@dexto/core';

const DEFAULT_CLIENT_METADATA = {
    client_name: 'Dexto MCP Client',
    redirect_uris: [getMcpRedirectUrl()],
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
    token_endpoint_auth_method: 'none',
};

export function createMcpAuthProviderFactory(options: {
    logger?: typeof coreLogger;
}): McpAuthProviderFactory {
    return (serverName: string, config: ValidatedMcpServerConfig) => {
        if (config.type !== 'http' && config.type !== 'sse') {
            return undefined;
        }

        const redirectUrl = getMcpRedirectUrl();
        return createMcpOAuthProvider({
            serverId: serverName,
            redirectUrl,
            clientMetadata: {
                ...DEFAULT_CLIENT_METADATA,
                redirect_uris: [redirectUrl],
            },
        });
    };
}

import type {
    OAuthClientMetadata,
    OAuthClientInformationMixed,
    OAuthTokens,
} from '@modelcontextprotocol/sdk/shared/auth.js';
import type { McpAuthProvider } from '@dexto/core';
import { loadMcpAuthStore, saveMcpAuthStore } from './oauth-store.js';
import { createMcpCallbackServer } from './oauth-server.js';
import { openAuthUrl } from './oauth-ui.js';

export type McpOAuthClientConfig = {
    serverId: string;
    redirectUrl: string;
    clientMetadata: OAuthClientMetadata;
    clientMetadataUrl?: string | undefined;
};

export function createMcpOAuthProvider(config: McpOAuthClientConfig): McpAuthProvider {
    let authorizationCode: string | undefined;

    return {
        get redirectUrl() {
            return config.redirectUrl;
        },
        ...(config.clientMetadataUrl ? { clientMetadataUrl: config.clientMetadataUrl } : {}),
        get clientMetadata() {
            return config.clientMetadata;
        },
        async clientInformation(): Promise<OAuthClientInformationMixed | undefined> {
            const store = await loadMcpAuthStore(config.serverId);
            return store.clientInformation;
        },
        async saveClientInformation(clientInformation: OAuthClientInformationMixed) {
            const store = await loadMcpAuthStore(config.serverId);
            await saveMcpAuthStore(config.serverId, {
                ...store,
                clientInformation,
            });
        },
        async tokens(): Promise<OAuthTokens | undefined> {
            const store = await loadMcpAuthStore(config.serverId);
            return store.tokens;
        },
        async saveTokens(tokens: OAuthTokens) {
            const store = await loadMcpAuthStore(config.serverId);
            await saveMcpAuthStore(config.serverId, {
                ...store,
                tokens,
            });
        },
        async redirectToAuthorization(authorizationUrl: URL) {
            await openAuthUrl(authorizationUrl.toString());
        },
        async saveCodeVerifier(codeVerifier: string) {
            const store = await loadMcpAuthStore(config.serverId);
            await saveMcpAuthStore(config.serverId, {
                ...store,
                codeVerifier,
            });
        },
        async codeVerifier(): Promise<string> {
            const store = await loadMcpAuthStore(config.serverId);
            if (!store.codeVerifier) {
                throw new Error('No code verifier saved');
            }
            return store.codeVerifier;
        },
        async waitForAuthorizationCode(): Promise<string> {
            if (authorizationCode) {
                return authorizationCode;
            }
            const result = await createMcpCallbackServer(config.redirectUrl);
            authorizationCode = result;
            return result;
        },
        async invalidateCredentials(scope) {
            const store = await loadMcpAuthStore(config.serverId);
            const updated = { ...store };

            if (scope === 'all' || scope === 'tokens') {
                updated.tokens = undefined;
            }
            if (scope === 'all' || scope === 'client') {
                updated.clientInformation = undefined;
            }
            if (scope === 'all' || scope === 'verifier') {
                updated.codeVerifier = undefined;
            }

            await saveMcpAuthStore(config.serverId, updated);
        },
    } satisfies McpAuthProvider;
}

import { formatOauthHttpError } from './oauth-error.js';

const OPENAI_AUTH_ISSUER = 'https://auth.openai.com';
const DEVICE_CODE_URL = `${OPENAI_AUTH_ISSUER}/codex/device`;

export type OpenAiCodexTokens = {
    accessToken: string;
    refreshToken: string;
    expiresInSec: number;
    idToken?: string | undefined;
};

function decodeJwtClaims(token: string): Record<string, unknown> | null {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    try {
        const json = Buffer.from(parts[1]!, 'base64url').toString('utf-8');
        return JSON.parse(json) as Record<string, unknown>;
    } catch {
        return null;
    }
}

function extractAccountIdFromClaims(claims: Record<string, unknown>): string | null {
    const direct = claims['chatgpt_account_id'];
    if (typeof direct === 'string' && direct.trim()) return direct;

    const auth = claims['https://api.openai.com/auth'];
    if (typeof auth === 'object' && auth !== null) {
        const maybe = (auth as Record<string, unknown>)['chatgpt_account_id'];
        if (typeof maybe === 'string' && maybe.trim()) return maybe;
    }

    const orgs = claims['organizations'];
    if (Array.isArray(orgs) && orgs.length > 0) {
        const first = orgs[0];
        if (typeof first === 'object' && first !== null) {
            const id = (first as Record<string, unknown>)['id'];
            if (typeof id === 'string' && id.trim()) return id;
        }
    }

    return null;
}

export function extractChatGptAccountId(tokens: OpenAiCodexTokens): string | null {
    if (tokens.idToken) {
        const claims = decodeJwtClaims(tokens.idToken);
        if (claims) {
            const id = extractAccountIdFromClaims(claims);
            if (id) return id;
        }
    }

    const accessClaims = decodeJwtClaims(tokens.accessToken);
    if (accessClaims) {
        return extractAccountIdFromClaims(accessClaims);
    }

    return null;
}

export async function loginOpenAiCodexDeviceCode(options: {
    clientId: string;
    userAgent: string;
}): Promise<{
    deviceUrl: string;
    userCode: string;
    pollIntervalMs: number;
    callback: () => Promise<OpenAiCodexTokens>;
}> {
    const deviceResponse = await fetch(`${OPENAI_AUTH_ISSUER}/api/accounts/deviceauth/usercode`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'User-Agent': options.userAgent,
        },
        body: JSON.stringify({ client_id: options.clientId }),
        signal: AbortSignal.timeout(15_000),
    });

    if (!deviceResponse.ok) {
        const text = await formatOauthHttpError(deviceResponse);
        throw new Error(`OpenAI device auth init failed: ${text}`);
    }

    const deviceData = (await deviceResponse.json()) as {
        device_auth_id: string;
        user_code: string;
        interval?: string;
    };

    const intervalSec = Math.max(Number.parseInt(deviceData.interval ?? '5', 10) || 5, 1);
    const pollIntervalMs = intervalSec * 1000;

    async function pollForAuthorizationCode(): Promise<{
        authorizationCode: string;
        codeVerifier: string;
    }> {
        const startedAt = Date.now();
        const maxWaitMs = 10 * 60 * 1000;

        while (Date.now() < startedAt + maxWaitMs) {
            const response = await fetch(`${OPENAI_AUTH_ISSUER}/api/accounts/deviceauth/token`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'User-Agent': options.userAgent,
                },
                body: JSON.stringify({
                    device_auth_id: deviceData.device_auth_id,
                    user_code: deviceData.user_code,
                }),
                signal: AbortSignal.timeout(15_000),
            });

            if (response.ok) {
                const data = (await response.json()) as {
                    authorization_code: string;
                    code_verifier: string;
                };
                return {
                    authorizationCode: data.authorization_code,
                    codeVerifier: data.code_verifier,
                };
            }

            // Pending (user not approved yet) shows up as 403/404 in prior art.
            if (response.status === 403 || response.status === 404) {
                await new Promise((resolve) => setTimeout(resolve, pollIntervalMs + 3000));
                continue;
            }

            const text = await formatOauthHttpError(response);
            throw new Error(`OpenAI device auth poll failed: ${text}`);
        }

        throw new Error('OpenAI device auth timed out waiting for authorization');
    }

    async function exchangeAuthorizationCode(params: {
        authorizationCode: string;
        codeVerifier: string;
    }): Promise<OpenAiCodexTokens> {
        const tokenResponse = await fetch(`${OPENAI_AUTH_ISSUER}/oauth/token`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
                grant_type: 'authorization_code',
                code: params.authorizationCode,
                redirect_uri: `${OPENAI_AUTH_ISSUER}/deviceauth/callback`,
                client_id: options.clientId,
                code_verifier: params.codeVerifier,
            }).toString(),
            signal: AbortSignal.timeout(15_000),
        });

        if (!tokenResponse.ok) {
            const text = await formatOauthHttpError(tokenResponse);
            throw new Error(`OpenAI token exchange failed: ${text}`);
        }

        const tokens = (await tokenResponse.json()) as {
            access_token: string;
            refresh_token: string;
            expires_in?: number;
            id_token?: string;
        };

        return {
            accessToken: tokens.access_token,
            refreshToken: tokens.refresh_token,
            expiresInSec: tokens.expires_in ?? 3600,
            ...(tokens.id_token ? { idToken: tokens.id_token } : {}),
        };
    }

    return {
        deviceUrl: DEVICE_CODE_URL,
        userCode: deviceData.user_code,
        pollIntervalMs,
        callback: async () => {
            const { authorizationCode, codeVerifier } = await pollForAuthorizationCode();
            return await exchangeAuthorizationCode({ authorizationCode, codeVerifier });
        },
    };
}

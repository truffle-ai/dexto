import { createHash, randomBytes } from 'node:crypto';
import { createServer, type Server } from 'node:http';

const CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann';
const ISSUER = 'https://auth.openai.com';
const CALLBACK_HOST = '127.0.0.1';
const REDIRECT_HOST = 'localhost';
const CALLBACK_PORT = 1455;
const CALLBACK_PATH = '/auth/callback';
const CODEX_API_BASE_URL = 'https://chatgpt.com/backend-api/codex';
const DUMMY_API_KEY = 'dexto-chatgpt-oauth';
const DEFAULT_CODEX_INSTRUCTIONS = 'You are a helpful assistant.';
export const CHATGPT_OAUTH_REDIRECT_URI = `http://${REDIRECT_HOST}:${CALLBACK_PORT}${CALLBACK_PATH}`;

type TokenResponse = {
    id_token?: string;
    access_token: string;
    refresh_token?: string;
    expires_in?: number;
};

type ChatGPTIdTokenClaims = {
    chatgpt_account_id?: string;
    organizations?: Array<{ id?: string }>;
    'https://api.openai.com/auth'?: {
        chatgpt_account_id?: string;
    };
};

export type ChatGPTOAuthCredential = {
    type: 'oauth';
    issuer: typeof ISSUER;
    refreshToken: string;
    accessToken: string;
    expiresAt: number;
    accountId?: string | undefined;
};

export type PendingChatGPTLogin = {
    authUrl: string;
    waitForCredential(): Promise<ChatGPTOAuthCredential>;
    cancel(): Promise<void>;
};

export type ChatGPTRuntimeAuth = {
    apiKey: string;
    baseURL: string;
    fetch: typeof fetch;
};

function base64Url(input: Buffer): string {
    return input.toString('base64url');
}

function generatePkce(): { verifier: string; challenge: string } {
    const verifier = base64Url(randomBytes(48));
    const challenge = base64Url(createHash('sha256').update(verifier).digest());
    return { verifier, challenge };
}

function buildAuthorizeUrl(redirectUri: string, challenge: string, state: string): string {
    const params = new URLSearchParams({
        response_type: 'code',
        client_id: CLIENT_ID,
        redirect_uri: redirectUri,
        scope: 'openid profile email offline_access',
        code_challenge: challenge,
        code_challenge_method: 'S256',
        id_token_add_organizations: 'true',
        codex_cli_simplified_flow: 'true',
        state,
        originator: 'dexto',
    });
    return `${ISSUER}/oauth/authorize?${params.toString()}`;
}

function parseJwtClaims(token: string | undefined): ChatGPTIdTokenClaims | null {
    if (!token) {
        return null;
    }

    const parts = token.split('.');
    if (parts.length !== 3 || !parts[1]) {
        return null;
    }

    try {
        return JSON.parse(
            Buffer.from(parts[1], 'base64url').toString('utf-8')
        ) as ChatGPTIdTokenClaims;
    } catch {
        return null;
    }
}

function extractAccountId(tokens: TokenResponse): string | undefined {
    const claims = parseJwtClaims(tokens.id_token) ?? parseJwtClaims(tokens.access_token);
    return (
        claims?.chatgpt_account_id ??
        claims?.['https://api.openai.com/auth']?.chatgpt_account_id ??
        claims?.organizations?.find((org) => typeof org.id === 'string')?.id
    );
}

function credentialFromTokens(
    tokens: TokenResponse,
    previous?: Pick<ChatGPTOAuthCredential, 'refreshToken' | 'accountId'>
): ChatGPTOAuthCredential {
    const refreshToken = tokens.refresh_token ?? previous?.refreshToken;
    if (!refreshToken) {
        throw new Error('ChatGPT Login did not return a refresh token');
    }

    return {
        type: 'oauth',
        issuer: ISSUER,
        refreshToken,
        accessToken: tokens.access_token,
        expiresAt: Date.now() + (tokens.expires_in ?? 3600) * 1000,
        accountId: extractAccountId(tokens) ?? previous?.accountId,
    };
}

async function exchangeCodeForTokens(
    code: string,
    redirectUri: string,
    verifier: string
): Promise<TokenResponse> {
    const response = await fetch(`${ISSUER}/oauth/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
            grant_type: 'authorization_code',
            code,
            redirect_uri: redirectUri,
            client_id: CLIENT_ID,
            code_verifier: verifier,
        }).toString(),
    });
    if (!response.ok) {
        throw new Error(`ChatGPT token exchange failed: ${response.status}`);
    }
    return (await response.json()) as TokenResponse;
}

export async function refreshChatGPTOAuthCredential(
    credential: ChatGPTOAuthCredential
): Promise<ChatGPTOAuthCredential> {
    const response = await fetch(`${credential.issuer}/oauth/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
            grant_type: 'refresh_token',
            refresh_token: credential.refreshToken,
            client_id: CLIENT_ID,
        }).toString(),
    });
    if (!response.ok) {
        throw new Error(`ChatGPT token refresh failed: ${response.status}`);
    }
    return credentialFromTokens((await response.json()) as TokenResponse, credential);
}

async function closeServer(server: Server): Promise<void> {
    if (!server.listening) {
        return;
    }

    await new Promise<void>((resolve, reject) => {
        server.close((error) => {
            if (error) {
                reject(error);
                return;
            }
            resolve();
        });
    });
}

async function listen(server: Server): Promise<void> {
    await new Promise<void>((resolve, reject) => {
        server.once('error', reject);
        server.listen(CALLBACK_PORT, CALLBACK_HOST, () => {
            server.off('error', reject);
            resolve();
        });
    });
}

export async function startChatGPTBrowserLogin(): Promise<PendingChatGPTLogin> {
    const redirectUri = CHATGPT_OAUTH_REDIRECT_URI;
    const pkce = generatePkce();
    const state = base64Url(randomBytes(32));

    const server = createServer();
    const credentialPromise = new Promise<ChatGPTOAuthCredential>((resolve, reject) => {
        server.on('request', async (request, response) => {
            try {
                const url = new URL(request.url ?? '/', redirectUri);
                if (url.pathname !== CALLBACK_PATH) {
                    response.writeHead(404).end('Not found');
                    return;
                }

                if (url.searchParams.get('state') !== state) {
                    throw new Error('ChatGPT Login returned an invalid state');
                }

                const code = url.searchParams.get('code');
                if (!code) {
                    throw new Error(
                        url.searchParams.get('error') ?? 'ChatGPT Login returned no code'
                    );
                }

                const tokens = await exchangeCodeForTokens(code, redirectUri, pkce.verifier);
                response
                    .writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
                    .end(
                        '<!doctype html><title>Dexto ChatGPT Login</title><p>Authorization complete. You can close this window.</p>'
                    );
                resolve(credentialFromTokens(tokens));
            } catch (error) {
                response
                    .writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' })
                    .end(error instanceof Error ? error.message : 'ChatGPT Login failed');
                reject(error);
            } finally {
                void closeServer(server);
            }
        });
        server.once('error', reject);
    });

    await listen(server);

    return {
        authUrl: buildAuthorizeUrl(redirectUri, pkce.challenge, state),
        waitForCredential: () => credentialPromise,
        cancel: async () => {
            await closeServer(server);
        },
    };
}

function removeAuthorizationHeader(headers: globalThis.Headers): void {
    headers.delete('authorization');
    headers.delete('Authorization');
}

function resolveCodexEndpoint(requestInput: RequestInfo | URL): RequestInfo | URL {
    const url =
        requestInput instanceof URL
            ? requestInput
            : new URL(typeof requestInput === 'string' ? requestInput : requestInput.url);
    if (url.pathname.endsWith('/responses') || url.pathname.endsWith('/chat/completions')) {
        return `${CODEX_API_BASE_URL}/responses`;
    }
    return requestInput;
}

function contentToInstructionText(content: unknown): string | null {
    if (typeof content === 'string') {
        return content;
    }

    if (Array.isArray(content)) {
        const text = content
            .map((part) => {
                if (typeof part === 'string') {
                    return part;
                }
                if (
                    part &&
                    typeof part === 'object' &&
                    'text' in part &&
                    typeof part.text === 'string'
                ) {
                    return part.text;
                }
                return JSON.stringify(part);
            })
            .filter((part) => part.trim() !== '')
            .join('\n');
        return text === '' ? null : text;
    }

    if (content === undefined || content === null) {
        return null;
    }

    return JSON.stringify(content);
}

function isInstructionMessage(message: unknown): message is { role: string; content?: unknown } {
    return (
        !!message &&
        typeof message === 'object' &&
        'role' in message &&
        (message.role === 'system' || message.role === 'developer')
    );
}

function extractInstructionMessages(messages: unknown): {
    instructions: string[];
    messages: unknown;
} {
    if (!Array.isArray(messages)) {
        return { instructions: [], messages };
    }

    const instructions: string[] = [];
    const remaining: unknown[] = [];
    for (const message of messages) {
        if (!isInstructionMessage(message)) {
            remaining.push(message);
            continue;
        }

        const text = contentToInstructionText(message.content);
        if (text) {
            instructions.push(text);
        }
    }

    return { instructions, messages: remaining };
}

function normalizeCodexRequestBody(body: Record<string, unknown>): Record<string, unknown> {
    const input = extractInstructionMessages(body.input);
    const messages = extractInstructionMessages(body.messages);
    const instructions = [
        ...input.instructions,
        ...messages.instructions,
        ...(typeof body.instructions === 'string' && body.instructions.trim() !== ''
            ? [body.instructions]
            : []),
    ];

    if (input.instructions.length > 0) {
        body.input = input.messages;
    }
    if (messages.instructions.length > 0) {
        body.messages = messages.messages;
    }

    body.instructions =
        instructions.length > 0 ? instructions.join('\n\n') : DEFAULT_CODEX_INSTRUCTIONS;
    body.store = false;
    return body;
}

function createCodexRequestInit(
    init: RequestInit | undefined,
    credential: ChatGPTOAuthCredential
): RequestInit {
    const headers = new globalThis.Headers(init?.headers);
    removeAuthorizationHeader(headers);
    headers.set('authorization', `Bearer ${credential.accessToken}`);
    headers.set('originator', 'dexto');
    headers.set('OpenAI-Beta', 'responses=experimental');
    if (credential.accountId) {
        headers.set('ChatGPT-Account-Id', credential.accountId);
    }

    if (typeof init?.body !== 'string') {
        return { ...init, headers };
    }

    const body = JSON.parse(init.body) as Record<string, unknown>;

    return {
        ...init,
        body: JSON.stringify(normalizeCodexRequestBody(body)),
        headers,
    };
}

export function createChatGPTRuntimeAuth(input: {
    credential: ChatGPTOAuthCredential;
    updateCredential(credential: ChatGPTOAuthCredential): Promise<void>;
}): ChatGPTRuntimeAuth {
    let current = input.credential;
    let refreshPromise: Promise<ChatGPTOAuthCredential> | null = null;

    async function getFreshCredential(): Promise<ChatGPTOAuthCredential> {
        if (current.expiresAt > Date.now() + 30_000) {
            return current;
        }

        refreshPromise ??= refreshChatGPTOAuthCredential(current)
            .then(async (next) => {
                current = next;
                await input.updateCredential(next);
                return next;
            })
            .finally(() => {
                refreshPromise = null;
            });

        return refreshPromise;
    }

    return {
        apiKey: DUMMY_API_KEY,
        baseURL: CODEX_API_BASE_URL,
        fetch: async (requestInput, init) => {
            const credential = await getFreshCredential();
            return fetch(resolveCodexEndpoint(requestInput), {
                ...createCodexRequestInit(init, credential),
            });
        },
    };
}

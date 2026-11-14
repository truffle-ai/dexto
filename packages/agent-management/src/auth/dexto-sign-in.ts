// Signs a person in to Dexto as the first-party `dexto-cli` OAuth client: browser PKCE on a
// loopback redirect, or a device code (RFC 8628) for SSH sessions and machines without a browser.

import { createHash, randomBytes } from 'node:crypto';
import { hostname } from 'node:os';
import { z } from 'zod';
import { type OAuthLogin, SignedInAsSchema } from './dexto-accounts.js';

/** Dexto's pre-registered public client for this CLI: no secret, no registration. */
export const DEXTO_CLI_CLIENT_ID = 'dexto-cli';

/** Ask once for Project chats and their output; Loops and direct computer writes are step-ups. */
const BASE_TASK_SCOPES = [
    'cloud:read',
    'runs:read',
    'artifacts:read',
    'sessions:write',
    'projects:write',
] as const;

const DEVICE_CODE_GRANT_TYPE = 'urn:ietf:params:oauth:grant-type:device_code';
const LOGIN_TIMEOUT_MS = 5 * 60_000;
/** How long logging out waits on the server before forgetting the login anyway. */
const END_SIGN_IN_TIMEOUT_MS = 10_000;

/** A loopback listener for the browser's redirect back to the CLI. */
export interface RedirectListener {
    /** `http://127.0.0.1:<port>/callback`. */
    readonly redirectUri: string;
    /** The redirect's query parameters. */
    readonly result: Promise<URLSearchParams>;
    readonly close: () => void;
}

/** What talking to the OAuth server needs: refreshing and ending a sign-in need only this. */
export interface OAuthServerRuntime {
    readonly fetch: typeof globalThis.fetch;
    readonly signal: AbortSignal;
}

/**
 * What the person does to finish signing in. The CLI words and styles it; `signInPromptText` is
 * the plain wording.
 */
export type SignInPrompt =
    | { readonly kind: 'browser'; readonly authorizeUrl: string }
    | {
          readonly kind: 'device';
          readonly userCode: string;
          readonly verificationUri: string;
          /** The link with the code already in it, when the server gives one. */
          readonly verificationUriComplete: string | null;
          readonly expiresInSeconds: number;
          /** The organization the request names (id, slug or name); null lets the page choose. */
          readonly organization: string | null;
          /** Every permission the request asks for. */
          readonly scopes: readonly string[];
          /** This computer's name, for the From row. */
          readonly computer: string;
      };

/** What a sign-in request asks for, as the approval page shows it. */
export interface SignInRequest {
    /** The signed-in account's email when known; a new sign-in learns it only on approval. */
    readonly account: string | null;
    readonly organization: string | null;
    /** The device code, once there is one. */
    readonly code: string | null;
    readonly scopes: readonly string[];
    /** The computer the request starts on, for the From row. */
    readonly computer: string;
    /** Name every scope here, rather than leaving the list to the page's Details. */
    readonly listScopes: boolean;
}

export interface SignInRequestRow {
    readonly label: 'Account' | 'Organization' | 'Code' | 'From' | 'Access';
    readonly value: string;
}

/**
 * The request as the approval page lays it out (consent variant C, "Plain rows"): Account,
 * Organization, Code, From and Access, so the terminal and the page can be read side by side.
 */
export function signInRequestRows(request: SignInRequest): SignInRequestRow[] {
    const count = `${request.scopes.length} ${request.scopes.length === 1 ? 'permission' : 'permissions'}`;
    return [
        { label: 'Account', value: request.account ?? 'the one you approve with' },
        { label: 'Organization', value: request.organization ?? 'chosen on the approval page' },
        ...(request.code === null ? [] : [{ label: 'Code' as const, value: request.code }]),
        { label: 'From', value: `this computer (${request.computer})` },
        {
            label: 'Access',
            value: request.listScopes
                ? `${count}: ${request.scopes.join(' ')}`
                : `${count}, listed under Details on the approval page`,
        },
    ];
}

/** `  Account       sam@acme.co`: each row indented, its label padded to one column. */
export function signInRequestText(rows: readonly SignInRequestRow[]): string {
    return rows.map((row) => `  ${row.label.padEnd(14)}${row.value}`).join('\n');
}

export function signInPromptText(prompt: SignInPrompt): string {
    if (prompt.kind === 'browser')
        return `Sign in to Dexto in your browser. If it doesn't open, visit:\n${prompt.authorizeUrl}`;
    return [
        prompt.verificationUriComplete === null
            ? `To sign in, open this link on any device and enter ${prompt.userCode}:\n${prompt.verificationUri}`
            : `To sign in, open this link on any device and check it shows ${prompt.userCode}:\n${prompt.verificationUriComplete}`,
        signInRequestText(devicePromptRows(prompt)),
        'Only approve this if you just ran dexto login.',
    ].join('\n');
}

/** A device prompt's rows: the account is learned on approval, and the page lists the scopes. */
export function devicePromptRows(
    prompt: Extract<SignInPrompt, { kind: 'device' }>
): SignInRequestRow[] {
    return signInRequestRows({
        account: null,
        organization: prompt.organization,
        code: prompt.userCode,
        scopes: prompt.scopes,
        computer: prompt.computer,
        listScopes: false,
    });
}

/** Why a sign-in ended without signing in, so the CLI can say what to do next. */
export type SignInEndReason = 'declined' | 'timed_out' | 'cancelled' | 'expired';

export class SignInEnded extends Error {
    constructor(
        readonly reason: SignInEndReason,
        message: string
    ) {
        super(message);
        this.name = 'SignInEnded';
    }
}

/** What signing in does outside this module, injected so it can be tested. */
export interface SignInRuntime extends OAuthServerRuntime {
    readonly prompt: (prompt: SignInPrompt) => void;
    readonly openBrowser: (url: string) => Promise<void>;
    /** Listens for the redirect; the browser then goes on to `appUrl`'s sign-in result page. */
    readonly listenForRedirect: (appUrl: string) => Promise<RedirectListener>;
    readonly sleep: (ms: number) => Promise<void>;
}

export interface SignInInput {
    /** The Dexto app origin, home of its authorization server and MCP. */
    readonly appUrl: string;
    /** The public API the login is saved for. */
    readonly apiBaseUrl: string;
    /** The organization to sign in for (id, slug or name), where the approval page starts. */
    readonly organization: string | null;
    /** Additional permissions beyond reading, Project changes and starting chats. */
    readonly extraScopes: readonly string[];
    /** Inspect the exact request before any authorization starts; throwing cancels sign-in. */
    readonly beforeAuthorize?: (scopes: readonly string[]) => Promise<void>;
}

export interface BrowserSignInInput extends SignInInput {
    /** Open the browser; when false the URL is only printed. */
    readonly openBrowser: boolean;
}

const ProtectedResourceSchema = z.object({
    authorization_servers: z.array(z.string().url()).min(1),
    resource: z.string().url(),
    scopes_supported: z.array(z.string()),
});

const AuthorizationServerSchema = z.object({
    authorization_endpoint: z.string().url(),
    device_authorization_endpoint: z.string().url(),
    revocation_endpoint: z.string().url(),
    token_endpoint: z.string().url(),
});

const TokenResponseSchema = z.object({
    access_token: z.string().min(1),
    refresh_token: z.string().min(1),
    expires_in: z.number().int().positive(),
    scope: z.string(),
    /** Who the tokens act as. */
    dexto_account: SignedInAsSchema.shape.account.optional(),
    dexto_organization: SignedInAsSchema.shape.organization.optional(),
});

type TokenResponse = z.output<typeof TokenResponseSchema>;

const DeviceAuthorizationSchema = z.object({
    device_code: z.string().min(1),
    user_code: z.string().min(1),
    expires_in: z.number().int().positive(),
    interval: z.number().int().positive().optional(),
    verification_uri: z.string().url(),
    verification_uri_complete: z.string().url().optional(),
});

interface Discovered {
    readonly appUrl: string;
    readonly resource: string;
    readonly scopes: readonly string[];
    readonly server: z.output<typeof AuthorizationServerSchema>;
}

async function readMetadata(runtime: OAuthServerRuntime, appUrl: string) {
    const resource = ProtectedResourceSchema.parse(
        await getJson(runtime, `${appUrl}/.well-known/oauth-protected-resource/mcp`)
    );
    const issuer = (resource.authorization_servers[0] ?? appUrl).replace(/\/+$/u, '');
    const server = AuthorizationServerSchema.parse(
        await getJson(runtime, `${issuer}/.well-known/oauth-authorization-server`)
    );
    return { resource, server };
}

/** Finds the MCP's authorization server and the scopes to ask for. */
async function discover(runtime: SignInRuntime, input: SignInInput): Promise<Discovered> {
    const appUrl = input.appUrl.replace(/\/+$/u, '');
    const { resource, server } = await readMetadata(runtime, appUrl);
    const reading = resource.scopes_supported.filter((scope) => scope.endsWith(':read'));
    const scopes = [...new Set([...reading, ...BASE_TASK_SCOPES, ...input.extraScopes])];
    await input.beforeAuthorize?.(scopes);
    return { appUrl, resource: resource.resource, scopes, server };
}

export async function signInWithBrowser(
    runtime: SignInRuntime,
    input: BrowserSignInInput
): Promise<OAuthLogin> {
    const { appUrl, resource, scopes, server } = await discover(runtime, input);
    const redirect = await runtime.listenForRedirect(appUrl);
    try {
        const verifier = randomBytes(32).toString('base64url');
        const state = randomBytes(16).toString('base64url');
        const authorizeUrl = new URL(server.authorization_endpoint);
        for (const [name, value] of Object.entries({
            client_id: DEXTO_CLI_CLIENT_ID,
            code_challenge: createHash('sha256').update(verifier).digest('base64url'),
            code_challenge_method: 'S256',
            redirect_uri: redirect.redirectUri,
            resource,
            response_type: 'code',
            scope: scopes.join(' '),
            state,
            ...(input.organization === null ? {} : { organization: input.organization }),
        }))
            authorizeUrl.searchParams.set(name, value);

        runtime.prompt({ kind: 'browser', authorizeUrl: authorizeUrl.toString() });
        if (input.openBrowser) await runtime.openBrowser(authorizeUrl.toString());

        const params = await withTimeout(redirect.result, LOGIN_TIMEOUT_MS, runtime.signal);
        if (params.get('state') !== state)
            throw new Error("The sign-in reply didn't match this login.");
        const error = params.get('error');
        if (error !== null)
            throw error === 'access_denied'
                ? new SignInEnded('declined', 'Sign-in was declined.')
                : new Error(`Sign-in failed: ${params.get('error_description') ?? error}.`);
        const code = params.get('code');
        if (code === null) throw new Error('The sign-in reply had no code.');

        const tokens = TokenResponseSchema.parse(
            await postForm(runtime, server.token_endpoint, {
                client_id: DEXTO_CLI_CLIENT_ID,
                code,
                code_verifier: verifier,
                grant_type: 'authorization_code',
                redirect_uri: redirect.redirectUri,
                resource,
            })
        );
        return toLogin(tokens, {
            apiBaseUrl: input.apiBaseUrl,
            appUrl,
            resource,
            tokenEndpoint: server.token_endpoint,
        });
    } finally {
        redirect.close();
    }
}

export async function signInWithDevice(
    runtime: SignInRuntime,
    input: SignInInput
): Promise<OAuthLogin> {
    const { appUrl, resource, scopes, server } = await discover(runtime, input);
    const device = DeviceAuthorizationSchema.parse(
        await postForm(runtime, server.device_authorization_endpoint, {
            client_id: DEXTO_CLI_CLIENT_ID,
            resource,
            scope: scopes.join(' '),
            ...(input.organization === null ? {} : { organization: input.organization }),
        })
    );
    runtime.prompt({
        kind: 'device',
        userCode: device.user_code,
        verificationUri: device.verification_uri,
        verificationUriComplete: device.verification_uri_complete ?? null,
        expiresInSeconds: device.expires_in,
        organization: input.organization,
        scopes,
        computer: hostname(),
    });

    const deadline = Date.now() + device.expires_in * 1000;
    let intervalSeconds = device.interval ?? 5;
    while (Date.now() < deadline) {
        await runtime.sleep(intervalSeconds * 1000);
        try {
            const tokens = TokenResponseSchema.parse(
                await postForm(runtime, server.token_endpoint, {
                    client_id: DEXTO_CLI_CLIENT_ID,
                    device_code: device.device_code,
                    grant_type: DEVICE_CODE_GRANT_TYPE,
                    resource,
                })
            );
            return toLogin(tokens, {
                apiBaseUrl: input.apiBaseUrl,
                appUrl,
                resource,
                tokenEndpoint: server.token_endpoint,
            });
        } catch (error) {
            // A dropped connection or a server error says nothing about the code: poll again.
            if (error instanceof TypeError) continue;
            if (!(error instanceof OAuthHttpError)) throw error;
            if (error.status >= 500 || error.code === 'authorization_pending') continue;
            if (error.code === 'slow_down') {
                intervalSeconds += 5;
                continue;
            }
            if (error.code === 'access_denied')
                throw new SignInEnded('declined', 'Sign-in was declined.');
            if (error.code !== 'expired_token') throw error;
            break;
        }
    }
    throw new SignInEnded('expired', 'The sign-in code expired. Run dexto login --device again.');
}

function toLogin(
    tokens: TokenResponse,
    client: Pick<OAuthLogin, 'apiBaseUrl' | 'appUrl' | 'resource' | 'tokenEndpoint'>
): OAuthLogin {
    return {
        kind: 'oauth',
        ...client,
        clientId: DEXTO_CLI_CLIENT_ID,
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        expiresAt: expiresAt(tokens.expires_in),
        scopes: splitScopes(tokens.scope),
        savedAt: new Date().toISOString(),
        signedInAs: signedInAsFrom(tokens),
        cloudProject: null,
    };
}

function signedInAsFrom(tokens: TokenResponse): OAuthLogin['signedInAs'] {
    return tokens.dexto_account === undefined || tokens.dexto_organization === undefined
        ? null
        : { account: tokens.dexto_account, organization: tokens.dexto_organization };
}

/**
 * Trades the refresh token for new tokens, as the client that signed in; the old refresh token
 * stops working.
 */
export async function refreshSignIn(
    runtime: OAuthServerRuntime,
    login: OAuthLogin
): Promise<OAuthLogin> {
    let body: unknown;
    try {
        body = await postForm(runtime, login.tokenEndpoint, {
            client_id: login.clientId,
            grant_type: 'refresh_token',
            refresh_token: login.refreshToken,
            resource: login.resource,
        });
    } catch (error) {
        if (error instanceof OAuthHttpError && error.status === 400)
            throw new Error('Your Dexto sign-in has expired. Run dexto login again.');
        throw error;
    }
    const tokens = TokenResponseSchema.parse(body);
    return {
        ...login,
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        expiresAt: expiresAt(tokens.expires_in),
        scopes: splitScopes(tokens.scope),
        signedInAs: signedInAsFrom(tokens) ?? login.signedInAs,
    };
}

/** What became of a sign-in on its server when logging out. */
export type EndedSignIn =
    | { readonly status: 'ended' }
    | { readonly status: 'failed'; readonly reason: string };

/**
 * Ends the sign-in on its server (RFC 7009), so its tokens stop working everywhere. Never throws:
 * the login is forgotten either way, and the caller says what happened.
 */
export async function endSignIn(
    runtime: OAuthServerRuntime,
    login: OAuthLogin
): Promise<EndedSignIn> {
    const bounded: OAuthServerRuntime = {
        ...runtime,
        signal: AbortSignal.any([runtime.signal, AbortSignal.timeout(END_SIGN_IN_TIMEOUT_MS)]),
    };
    try {
        const { server } = await readMetadata(bounded, login.appUrl.replace(/\/+$/u, ''));
        await postForm(bounded, server.revocation_endpoint, {
            client_id: login.clientId,
            token: login.refreshToken,
            token_type_hint: 'refresh_token',
        });
        return { status: 'ended' };
    } catch (error) {
        return { status: 'failed', reason: error instanceof Error ? error.message : String(error) };
    }
}

export class OAuthHttpError extends Error {
    /** The OAuth `error` code, such as `authorization_pending`; null when the reply had none. */
    readonly code: string | null;
    readonly status: number;

    constructor(status: number, code: string | null, message: string) {
        super(message);
        this.name = 'OAuthHttpError';
        this.code = code;
        this.status = status;
    }
}

async function getJson(runtime: OAuthServerRuntime, url: string): Promise<unknown> {
    return await readJson(
        await runtime.fetch(url, {
            headers: { accept: 'application/json' },
            signal: runtime.signal,
        }),
        url
    );
}

async function postForm(
    runtime: OAuthServerRuntime,
    url: string,
    fields: Record<string, string>
): Promise<unknown> {
    return await readJson(
        await runtime.fetch(url, {
            body: new URLSearchParams(fields),
            headers: { accept: 'application/json' },
            method: 'POST',
            signal: runtime.signal,
        }),
        url
    );
}

const OAuthErrorSchema = z.object({
    error: z.string().optional(),
    error_description: z.string().optional(),
});

async function readJson(response: Response, url: string): Promise<unknown> {
    const text = await response.text();
    if (response.ok) return text.length === 0 ? null : JSON.parse(text);
    const reply = OAuthErrorSchema.safeParse(parseOrNull(text));
    const code = reply.success ? (reply.data.error ?? null) : null;
    const description =
        (reply.success ? reply.data.error_description : undefined) ??
        code ??
        `HTTP ${response.status}`;
    throw new OAuthHttpError(response.status, code, `${new URL(url).pathname}: ${description}`);
}

/** An error reply's JSON, or null when it has none, such as a gateway's HTML error page. */
function parseOrNull(text: string): unknown {
    try {
        return JSON.parse(text);
    } catch {
        return null;
    }
}

async function withTimeout<T>(promise: Promise<T>, ms: number, signal: AbortSignal): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const stop = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new SignInEnded('timed_out', 'Sign-in timed out.')), ms);
        signal.addEventListener(
            'abort',
            () => reject(new SignInEnded('cancelled', 'Sign-in was cancelled.')),
            {
                once: true,
            }
        );
    });
    try {
        return await Promise.race([promise, stop]);
    } finally {
        clearTimeout(timer);
    }
}

function splitScopes(scope: string): string[] {
    return scope.split(' ').filter((each) => each.length > 0);
}

function expiresAt(expiresInSeconds: number): string {
    return new Date(Date.now() + expiresInSeconds * 1000).toISOString();
}

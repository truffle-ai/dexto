// How a cloud command reaches Dexto: the sign-in or key, the API origin and the Cloud project.

import { dextoAccounts } from '@dexto/agent-management';
import { UsageError } from './command.js';

const DEFAULT_API_BASE_URL = 'https://api.dexto.ai';

/** The global `--api-key`, `--api-base-url`, `--profile` and `--project` values, when given. */
export interface ConnectionOverrides {
    readonly apiBaseUrl: string | null;
    readonly apiKey: string | null;
    readonly cloudProject: string | null;
    readonly profile: string | null;
}

export type Connection = {
    readonly apiBaseUrl: string;
    /** The Cloud project a person's token acts in: --project, DEXTO_CLOUD_PROJECT or the saved one. */
    readonly cloudProject: string | null;
    /** The profile whose sign-in this is, or that --profile or DEXTO_PROFILE named. */
    readonly profile: string;
    readonly source: dextoAccounts.CredentialSource;
} & (
    | { readonly kind: 'api_key'; readonly token: string }
    | {
          readonly kind: 'oauth';
          readonly token: string;
          readonly login: dextoAccounts.OAuthLogin;
          /** The Dexto app: the sign-in's, or the API origin when that moved off the sign-in's. */
          readonly appUrl: string;
          /** The workspace MCP, at `appUrl` like the sign-in's resource. */
          readonly mcpUrl: string;
      }
);

export interface ResolveConnectionInput {
    /** ~/.dexto/accounts */
    readonly dir: string;
    readonly environment: Readonly<Record<string, string | undefined>>;
    readonly overrides: ConnectionOverrides;
    readonly refresh: (
        login: dextoAccounts.OAuthLogin,
        signal: AbortSignal
    ) => Promise<dextoAccounts.OAuthLogin>;
}

/** --api-key, then DEXTO_API_KEY, then the profile's sign-in, refreshed when due; null when none. */
export async function resolveConnection(input: ResolveConnectionInput): Promise<Connection | null> {
    const credential = await dextoAccounts.resolveCredential({
        dir: input.dir,
        apiKey: input.overrides.apiKey,
        profile: input.overrides.profile,
        environment: input.environment,
        refresh: input.refresh,
    });
    if (credential === null) return null;
    const saved =
        credential.kind === 'oauth'
            ? credential.login
            : credential.source === 'login'
              ? await dextoAccounts.readLogin(input.dir, credential.profile)
              : null;
    const environmentUrl = nonEmpty(input.environment.DEXTO_API_BASE_URL);
    if (environmentUrl !== null) assertHttpUrl(environmentUrl, 'DEXTO_API_BASE_URL');
    const apiBaseUrl = withoutTrailingSlash(
        input.overrides.apiBaseUrl ?? environmentUrl ?? saved?.apiBaseUrl ?? DEFAULT_API_BASE_URL
    );
    const named = input.overrides.cloudProject ?? nonEmpty(input.environment.DEXTO_CLOUD_PROJECT);
    const base = { apiBaseUrl, profile: credential.profile, source: credential.source };
    if (credential.kind !== 'oauth')
        return { ...base, kind: 'api_key', token: credential.token, cloudProject: named };
    const { login } = credential;
    // Another API origin is another Dexto, a preview or a local stack, serving its own app and MCP
    // there, so workspace tools follow it instead of reaching the signed-in one.
    const moved = apiBaseUrl !== withoutTrailingSlash(login.apiBaseUrl);
    return {
        ...base,
        kind: 'oauth',
        token: credential.token,
        login,
        appUrl: moved ? apiBaseUrl : login.appUrl,
        mcpUrl: moved ? `${apiBaseUrl}${new URL(login.resource).pathname}` : login.resource,
        cloudProject: named ?? login.cloudProject?.id ?? null,
    };
}

/** Refuses a value that isn't an http(s) URL, such as a mistyped `--api-base-url`. */
export function assertHttpUrl(value: string, name: string): void {
    const protocol = URL.canParse(value) ? new URL(value).protocol : null;
    if (protocol !== 'http:' && protocol !== 'https:')
        throw new UsageError(`${name} must be an http or https URL.`);
}

function withoutTrailingSlash(url: string): string {
    return url.replace(/\/+$/u, '');
}

function nonEmpty(value: string | undefined): string | null {
    return value === undefined || value.length === 0 ? null : value;
}

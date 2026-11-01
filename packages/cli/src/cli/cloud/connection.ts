// How a cloud command reaches Dexto: the sign-in or key, the API origin and the Cloud project.

import { dextoAccounts } from '@dexto/agent-management';

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
    | { readonly kind: 'oauth'; readonly token: string; readonly login: dextoAccounts.OAuthLogin }
);

export interface ResolveConnectionInput {
    /** ~/.dexto/accounts */
    readonly dir: string;
    readonly environment: Readonly<Record<string, string | undefined>>;
    readonly overrides: ConnectionOverrides;
    readonly refresh: (login: dextoAccounts.OAuthLogin) => Promise<dextoAccounts.OAuthLogin>;
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
    const apiBaseUrl = (
        input.overrides.apiBaseUrl ??
        nonEmpty(input.environment.DEXTO_API_BASE_URL) ??
        saved?.apiBaseUrl ??
        DEFAULT_API_BASE_URL
    ).replace(/\/+$/u, '');
    const named = input.overrides.cloudProject ?? nonEmpty(input.environment.DEXTO_CLOUD_PROJECT);
    const base = { apiBaseUrl, profile: credential.profile, source: credential.source };
    return credential.kind === 'oauth'
        ? {
              ...base,
              kind: 'oauth',
              token: credential.token,
              login: credential.login,
              cloudProject: named ?? credential.login.cloudProject?.id ?? null,
          }
        : { ...base, kind: 'api_key', token: credential.token, cloudProject: named };
}

function nonEmpty(value: string | undefined): string | null {
    return value === undefined || value.length === 0 ? null : value;
}

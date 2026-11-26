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

/** The target of a consented operation, without its rotating credentials. */
export function pinConnection(connection: Extract<Connection, { kind: 'oauth' }>) {
    const { login } = connection;
    return {
        profile: connection.profile,
        apiBaseUrl: connection.apiBaseUrl,
        cloudProject: connection.cloudProject,
        accountId: login.signedInAs?.account.id ?? null,
        organizationId: login.signedInAs?.organization.id ?? null,
        savedAt: login.savedAt,
        appUrl: login.appUrl,
        resource: login.resource,
        tokenEndpoint: login.tokenEndpoint,
        clientId: login.clientId,
    };
}

export type PinnedConnection = ReturnType<typeof pinConnection>;

/** A fresh credential must still belong to the target that was previewed. */
export function matchesPinnedConnection(pinned: PinnedConnection, connection: Connection): boolean {
    if (connection.kind !== 'oauth') return false;
    const current = pinConnection(connection);
    return (
        current.profile === pinned.profile &&
        current.apiBaseUrl === pinned.apiBaseUrl &&
        current.cloudProject === pinned.cloudProject &&
        current.appUrl === pinned.appUrl &&
        current.resource === pinned.resource &&
        current.tokenEndpoint === pinned.tokenEndpoint &&
        current.clientId === pinned.clientId &&
        // Without a reported account, the same saved grant may gain identity details on refresh.
        (pinned.accountId === null
            ? current.savedAt === pinned.savedAt
            : current.accountId === pinned.accountId &&
              current.organizationId === pinned.organizationId)
    );
}

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

/** The credential resolveCredential picks, with its API origin and Cloud project; null when none. */
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
            : credential.source === 'saved_key'
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

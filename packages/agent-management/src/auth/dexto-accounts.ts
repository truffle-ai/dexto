// Saved Dexto sign-ins, one per profile, under ~/.dexto/accounts, and the credential a command uses.

import { createHash } from 'node:crypto';
import { chmod, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';

export const DEFAULT_PROFILE = 'default';

/** Who a sign-in acts as: one account in one organization, as the token response says. */
export const SignedInAsSchema = z.object({
    account: z.object({ email: z.string(), id: z.string(), name: z.string() }),
    organization: z.object({ id: z.string(), name: z.string(), slug: z.string() }),
});

export type SignedInAs = z.output<typeof SignedInAsSchema>;

const OAuthLoginSchema = z
    .object({
        kind: z.literal('oauth'),
        accessToken: z.string().min(1),
        refreshToken: z.string().min(1),
        /** When the access token stops working, ISO 8601. */
        expiresAt: z.string(),
        /** `dexto-cli`, or the client an older `dexto-cloud` sign-in registered. */
        clientId: z.string().min(1),
        /** The Dexto app origin: its authorization server and MCP. */
        appUrl: z.string().url(),
        apiBaseUrl: z.string().url(),
        /** The MCP resource the tokens were issued for. */
        resource: z.string().url(),
        tokenEndpoint: z.string().url(),
        scopes: z.array(z.string()),
        savedAt: z.string(),
        /** Null when the server didn't say. */
        signedInAs: SignedInAsSchema.nullable(),
        /** The Cloud project Dexto models bill; null when the organization has none to use. */
        cloudProject: z.object({ id: z.string(), name: z.string() }).strict().nullable(),
    })
    .strict();

const ApiKeyLoginSchema = z
    .object({
        kind: z.literal('api_key'),
        apiKey: z.string().min(1),
        apiBaseUrl: z.string().url(),
        savedAt: z.string(),
    })
    .strict();

const StoredLoginSchema = z.discriminatedUnion('kind', [OAuthLoginSchema, ApiKeyLoginSchema]);

export type OAuthLogin = z.output<typeof OAuthLoginSchema>;
export type StoredLogin = z.output<typeof StoredLoginSchema>;

export interface SavedAccount {
    readonly name: string;
    readonly login: StoredLogin;
}

const PROFILE_NAME = /^[a-z0-9][a-z0-9._-]{0,63}$/u;

/** A profile name as given, refused unless it is one; names are also file names. */
export function requireProfileName(name: string): string {
    if (!PROFILE_NAME.test(name))
        throw new Error(
            `${name} can't name a profile: use up to 64 lowercase letters, digits, ".", "_" and "-".`
        );
    return name;
}

/**
 * The profile a sign-in for an organization gets when none is named: the organization's word, or
 * `org-` and a short hash of it when it has no letters or digits a profile name can use.
 */
export function profileNameFor(organization: string): string {
    const name = organization
        .toLowerCase()
        .replaceAll(/[^a-z0-9._-]+/gu, '-')
        .replaceAll(/^[._-]+|-+$/gu, '')
        .slice(0, 64);
    if (name.length > 0) return requireProfileName(name);
    return `org-${createHash('sha256').update(organization).digest('hex').slice(0, 8)}`;
}

function loginFile(dir: string, profile: string): string {
    return path.join(dir, `${requireProfileName(profile)}.json`);
}

function currentFile(dir: string): string {
    return path.join(dir, 'current');
}

export async function readLogin(dir: string, profile: string): Promise<StoredLogin | null> {
    const file = loginFile(dir, profile);
    const text = await readOptional(file);
    if (text === null) return null;
    const parsed = StoredLoginSchema.safeParse(JSON.parse(text));
    if (!parsed.success) throw new Error(`${file} is not a saved login. Run dexto login again.`);
    return parsed.data;
}

/** Saves the login readable only by this user. */
export async function writeLogin(dir: string, profile: string, login: StoredLogin): Promise<void> {
    await writePrivate(loginFile(dir, profile), `${JSON.stringify(login, null, 4)}\n`);
}

/** Forgets a profile's login; false when it had none. */
export async function forgetLogin(dir: string, profile: string): Promise<boolean> {
    try {
        await rm(loginFile(dir, profile));
        return true;
    } catch (error) {
        if (isMissingFile(error)) return false;
        throw error;
    }
}

/** Every profile with a saved login, `default` first. */
export async function listAccounts(dir: string): Promise<SavedAccount[]> {
    const names = (await readDirectory(dir))
        .filter((file) => file.endsWith('.json'))
        .map((file) => file.slice(0, -'.json'.length))
        .filter((name) => PROFILE_NAME.test(name))
        .sort((a, b) => (a === DEFAULT_PROFILE ? -1 : b === DEFAULT_PROFILE ? 1 : a < b ? -1 : 1));
    const accounts: SavedAccount[] = [];
    for (const name of names) {
        const login = await readLogin(dir, name);
        if (login !== null) accounts.push({ name, login });
    }
    return accounts;
}

/** The profile `accounts use` chose, or `default`. */
export async function readCurrentProfile(dir: string): Promise<string> {
    const text = await readOptional(currentFile(dir));
    if (text === null) return DEFAULT_PROFILE;
    const name = text.trim();
    if (!PROFILE_NAME.test(name))
        throw new Error(`${currentFile(dir)} names no profile. Run dexto accounts use <name>.`);
    return name;
}

export async function writeCurrentProfile(dir: string, profile: string): Promise<void> {
    await writePrivate(currentFile(dir), `${requireProfileName(profile)}\n`);
}

/** --profile, then DEXTO_PROFILE, then the current profile. */
export async function resolveProfile(
    dir: string,
    profile: string | null,
    environment: Readonly<Record<string, string | undefined>>
): Promise<string> {
    const chosen = profile ?? nonEmpty(environment.DEXTO_PROFILE);
    return chosen === null ? await readCurrentProfile(dir) : requireProfileName(chosen);
}

const CloudCliOAuthLoginSchema = OAuthLoginSchema.omit({ signedInAs: true }).strip();
const CloudCliLoginSchema = z.union([CloudCliOAuthLoginSchema, ApiKeyLoginSchema]);
const CloudCliSignedInAsSchema = SignedInAsSchema.extend({ clientId: z.string() });

/**
 * Copies the internal `dexto-cloud` CLI's sign-ins (`~/.config/dexto-cloud`) into `dir`, once:
 * only when `dir` has no sign-in yet. Its files stay as they were. Returns the profiles copied.
 */
export async function carryOverCloudCliLogins(dir: string, cloudCliDir: string): Promise<string[]> {
    if ((await listAccounts(dir)).length > 0) return [];
    const profileFiles = (await readDirectory(path.join(cloudCliDir, 'profiles')))
        .filter((file) => file.endsWith('.json'))
        .map((file) => file.slice(0, -'.json'.length))
        .filter((name) => name !== DEFAULT_PROFILE && PROFILE_NAME.test(name))
        .sort();
    const copied: string[] = [];
    for (const name of [DEFAULT_PROFILE, ...profileFiles]) {
        const file =
            name === DEFAULT_PROFILE
                ? path.join(cloudCliDir, 'credentials.json')
                : path.join(cloudCliDir, 'profiles', `${name}.json`);
        const text = await readOptional(file);
        if (text === null) continue;
        const parsed = CloudCliLoginSchema.safeParse(JSON.parse(text));
        if (!parsed.success) continue;
        const login = parsed.data;
        if (login.kind === 'api_key') {
            await writeLogin(dir, name, login);
        } else {
            await writeLogin(dir, name, {
                ...login,
                signedInAs: await readCloudCliSignedInAs(cloudCliDir, name, login.clientId),
            });
        }
        copied.push(name);
    }
    const current = await readOptional(path.join(cloudCliDir, 'current'));
    if (current !== null && copied.includes(current.trim()))
        await writeCurrentProfile(dir, current.trim());
    return copied;
}

const Dexto1AuthSchema = z.object({
    dextoApiKey: z.string().min(1).optional(),
    dextoPlatformUrl: z.string().url().optional(),
});

/**
 * Copies dexto 1.x's saved API key (`~/.dexto/auth.json`) into `dir` as the default profile, once:
 * only when `dir` has no sign-in yet. Its Supabase token, if any, is left behind. True when copied.
 */
export async function carryOverDexto1ApiKey(
    dir: string,
    authFile: string,
    apiBaseUrl: string
): Promise<boolean> {
    if ((await listAccounts(dir)).length > 0) return false;
    const text = await readOptional(authFile);
    if (text === null) return false;
    const parsed = Dexto1AuthSchema.safeParse(JSON.parse(text));
    if (!parsed.success || parsed.data.dextoApiKey === undefined) return false;
    await writeLogin(dir, DEFAULT_PROFILE, {
        kind: 'api_key',
        apiKey: parsed.data.dextoApiKey,
        apiBaseUrl: parsed.data.dextoPlatformUrl ?? apiBaseUrl,
        savedAt: new Date().toISOString(),
    });
    return true;
}

async function readCloudCliSignedInAs(
    cloudCliDir: string,
    profile: string,
    clientId: string
): Promise<SignedInAs | null> {
    const text = await readOptional(path.join(cloudCliDir, 'accounts', `${profile}.json`));
    if (text === null) return null;
    const parsed = CloudCliSignedInAsSchema.safeParse(JSON.parse(text));
    if (!parsed.success || parsed.data.clientId !== clientId) return null;
    return { account: parsed.data.account, organization: parsed.data.organization };
}

/** Where a command's credential came from, so `whoami` can say. */
export type CredentialSource = 'flag' | 'environment' | 'login';

export type Credential =
    | {
          readonly kind: 'api_key';
          readonly token: string;
          readonly source: CredentialSource;
          readonly profile: string;
      }
    | {
          readonly kind: 'oauth';
          readonly token: string;
          readonly source: 'login';
          readonly profile: string;
          readonly login: OAuthLogin;
      };

export interface ResolveCredentialInput {
    readonly dir: string;
    /** The global --api-key value. */
    readonly apiKey: string | null;
    /** The global --profile value. */
    readonly profile: string | null;
    readonly environment: Readonly<Record<string, string | undefined>>;
    readonly refresh: (login: OAuthLogin) => Promise<OAuthLogin>;
}

/**
 * --api-key, then DEXTO_API_KEY, then the profile's saved login; null when signed out. A saved
 * sign-in is refreshed first when its access token has expired or is about to.
 */
export async function resolveCredential(input: ResolveCredentialInput): Promise<Credential | null> {
    const profile = await resolveProfile(input.dir, input.profile, input.environment);
    if (input.apiKey !== null)
        return { kind: 'api_key', token: input.apiKey, source: 'flag', profile };
    const environmentKey = nonEmpty(input.environment.DEXTO_API_KEY);
    if (environmentKey !== null)
        return { kind: 'api_key', token: environmentKey, source: 'environment', profile };
    const stored = await readLogin(input.dir, profile);
    if (stored === null) return null;
    if (stored.kind === 'api_key')
        return { kind: 'api_key', token: stored.apiKey, source: 'login', profile };
    const login = isExpiring(stored)
        ? await refreshSaved(input.dir, profile, stored, input.refresh)
        : stored;
    return { kind: 'oauth', token: login.accessToken, source: 'login', profile, login };
}

const REFRESH_MARGIN_MS = 60_000;

function isExpiring(login: OAuthLogin): boolean {
    return Date.parse(login.expiresAt) - Date.now() < REFRESH_MARGIN_MS;
}

/**
 * Refreshes and saves the login. Refresh tokens rotate, so when another process refreshed the
 * same login first this refresh fails; the tokens that process saved are used instead.
 */
async function refreshSaved(
    dir: string,
    profile: string,
    stored: OAuthLogin,
    refresh: (login: OAuthLogin) => Promise<OAuthLogin>
): Promise<OAuthLogin> {
    try {
        const refreshed = await refresh(stored);
        await writeLogin(dir, profile, refreshed);
        return refreshed;
    } catch (error) {
        const current = await readLogin(dir, profile);
        if (
            current?.kind === 'oauth' &&
            current.refreshToken !== stored.refreshToken &&
            !isExpiring(current)
        )
            return current;
        throw error;
    }
}

async function readOptional(file: string): Promise<string | null> {
    try {
        return await readFile(file, 'utf8');
    } catch (error) {
        if (isMissingFile(error)) return null;
        throw error;
    }
}

async function readDirectory(dir: string): Promise<string[]> {
    try {
        return await readdir(dir);
    } catch (error) {
        if (isMissingFile(error)) return [];
        throw error;
    }
}

/** Writes a file readable only by this user, in a folder only this user can open. */
async function writePrivate(file: string, text: string): Promise<void> {
    await mkdir(path.dirname(file), { mode: 0o700, recursive: true });
    await chmod(path.dirname(file), 0o700);
    await writeFile(file, text, { mode: 0o600 });
    await chmod(file, 0o600);
}

function nonEmpty(value: string | undefined): string | null {
    return value === undefined || value.length === 0 ? null : value;
}

function isMissingFile(error: unknown): boolean {
    return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}

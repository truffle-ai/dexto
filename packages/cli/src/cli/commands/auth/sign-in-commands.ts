// `dexto login`, `logout`, `whoami` and `accounts`: signing in to Dexto and the saved profiles.

import {
    type OAuthLogin,
    type SignedInAs,
    type StoredLogin,
    DEFAULT_PROFILE,
    forgetLogin,
    listAccounts as readAccounts,
    profileNameFor,
    readCurrentProfile,
    readLogin,
    requireProfileName,
    resolveCredential,
    resolveProfile,
    writeCurrentProfile,
    writeLogin,
} from '../../auth/accounts.js';
import type { BrowserSignInInput, EndedSignIn, SignInInput } from '../../auth/sign-in.js';

/** A command that failed in a way a script can tell apart by its exit code. */
export class CommandError extends Error {
    readonly exitCode: number;

    constructor(exitCode: number, message: string) {
        super(message);
        this.name = 'CommandError';
        this.exitCode = exitCode;
    }
}

const NEEDS_SIGN_IN = 3;
const NEEDS_CONFIRMATION = 4;
const NOT_FOUND = 5;

/** Dexto's side of signing in, injected so commands can be tested without a server. */
export interface DextoSignIn {
    readonly signInWithBrowser: (input: BrowserSignInInput) => Promise<OAuthLogin>;
    readonly signInWithDevice: (input: SignInInput) => Promise<OAuthLogin>;
    readonly endSignIn: (login: OAuthLogin) => Promise<EndedSignIn>;
    readonly refreshSignIn: (login: OAuthLogin) => Promise<OAuthLogin>;
    /** Whether the public API accepts the key; false on 401. */
    readonly acceptsApiKey: (apiBaseUrl: string, apiKey: string) => Promise<boolean>;
}

export interface SignInContext {
    /** ~/.dexto/accounts */
    readonly dir: string;
    readonly environment: Readonly<Record<string, string | undefined>>;
    /** The Dexto app a new sign-in goes to. */
    readonly appUrl: string;
    /** The public API a new sign-in is saved for. */
    readonly apiBaseUrl: string;
    /** A result, on stdout. */
    readonly print: (text: string) => void;
    /** Anything else, on stderr. */
    readonly note: (text: string) => void;
    /** Asks the person; false when there is no one to ask. */
    readonly confirm: (question: string) => Promise<boolean>;
    readonly dexto: DextoSignIn;
}

export interface LoginOptions {
    readonly profile: string | null;
    readonly org: string | null;
    readonly device: boolean;
    readonly browser: boolean;
    readonly scopes: readonly string[];
    readonly apiKey: string | null;
}

export async function login(context: SignInContext, options: LoginOptions): Promise<void> {
    const named = options.profile ?? nonEmpty(context.environment.DEXTO_PROFILE);
    // --org names the profile and switches to it, unless --profile or DEXTO_PROFILE chose one.
    const switches = options.org !== null && named === null;
    const profile =
        options.org !== null && switches
            ? profileNameFor(options.org)
            : await resolveProfile(context.dir, named, {});
    const saved = await readLogin(context.dir, profile);

    if (options.apiKey !== null) {
        if (options.org !== null)
            throw new CommandError(2, 'An API key acts as itself; --org is for signing in.');
        await saveApiKey(context, profile, options.apiKey);
        return;
    }

    const previous = saved?.kind === 'oauth' ? saved : null;
    const input: SignInInput = {
        appUrl: previous?.appUrl ?? context.appUrl,
        apiBaseUrl: previous?.apiBaseUrl ?? context.apiBaseUrl,
        // Signing in again starts at the organization the profile was signed in for.
        organization: options.org ?? previous?.signedInAs?.organization.id ?? null,
        // ...and keeps the permissions granted before.
        extraScopes: [...(previous?.scopes ?? []), ...options.scopes.flatMap(splitList)],
    };
    const signedIn = options.device
        ? await context.dexto.signInWithDevice(input)
        : await context.dexto.signInWithBrowser({ ...input, openBrowser: options.browser });

    // A name made from --org can match another organization's profile: keep that sign-in.
    const savedOrganization = previous?.signedInAs?.organization ?? null;
    const newOrganization = signedIn.signedInAs?.organization ?? null;
    if (
        switches &&
        savedOrganization !== null &&
        newOrganization !== null &&
        savedOrganization.id !== newOrganization.id
    )
        throw new CommandError(
            2,
            `The profile ${profile} already signs in to ${savedOrganization.name}. Sign in to ${newOrganization.name} with --profile <name> to keep both.`
        );

    await writeLogin(context.dir, profile, signedIn);
    if (switches) await writeCurrentProfile(context.dir, profile);
    const current = (await resolveProfile(context.dir, null, context.environment)) === profile;
    context.print(
        [
            `Signed in${describeSignedInAs(signedIn.signedInAs)}${profile === DEFAULT_PROFILE ? '' : ` (profile ${profile})`}.`,
            ...(current
                ? []
                : [
                      `Other commands still use another profile: pass --profile ${profile}, or run dexto accounts use ${profile}.`,
                  ]),
        ].join(' ')
    );
}

async function saveApiKey(context: SignInContext, profile: string, apiKey: string): Promise<void> {
    if (!(await context.dexto.acceptsApiKey(context.apiBaseUrl, apiKey)))
        throw new CommandError(NEEDS_SIGN_IN, 'Dexto refused this API key.');
    await writeLogin(context.dir, profile, {
        kind: 'api_key',
        apiKey,
        apiBaseUrl: context.apiBaseUrl,
        savedAt: new Date().toISOString(),
    });
    context.print(
        `Saved API key ${maskApiKey(apiKey)}${profile === DEFAULT_PROFILE ? '' : ` (profile ${profile})`}.`
    );
}

export async function logout(
    context: SignInContext,
    options: { readonly profile: string | null }
): Promise<void> {
    const profile = await resolveProfile(context.dir, options.profile, context.environment);
    const removed = await logOutProfile(context, profile);
    const named = profile === DEFAULT_PROFILE ? '' : ` for profile ${profile}`;
    context.print(removed ? `Logged out${named}.` : `No saved sign-in${named}.`);
}

/**
 * Ends a profile's sign-in on its server, then forgets it here. A sign-in the server didn't end
 * keeps working until it expires, so a note says where to end it.
 */
async function logOutProfile(context: SignInContext, profile: string): Promise<boolean> {
    const saved = await readLogin(context.dir, profile);
    if (saved?.kind === 'oauth') {
        const ended = await context.dexto.endSignIn(saved);
        if (ended.status === 'failed')
            context.note(
                `Couldn't end the sign-in on ${saved.appUrl} (${ended.reason}). Sign it out at ${new URL('/settings/sign-ins', saved.appUrl).href}, or it keeps working until it expires.`
            );
    }
    return await forgetLogin(context.dir, profile);
}

export async function whoami(
    context: SignInContext,
    options: { readonly profile: string | null; readonly apiKey: string | null }
): Promise<void> {
    const credential = await resolveCredential({
        dir: context.dir,
        apiKey: options.apiKey,
        profile: options.profile,
        environment: context.environment,
        refresh: context.dexto.refreshSignIn,
    });
    if (credential === null)
        throw new CommandError(NEEDS_SIGN_IN, 'Not signed in. Run dexto login.');
    if (credential.kind === 'api_key') {
        const from =
            credential.source === 'flag'
                ? ' (from --api-key)'
                : credential.source === 'environment'
                  ? ' (from DEXTO_API_KEY)'
                  : `, profile ${credential.profile}`;
        context.print(field('api key', `${maskApiKey(credential.token)}${from}`));
        return;
    }
    const { login: saved } = credential;
    context.print(
        [
            field('profile', credential.profile),
            field('account', saved.signedInAs?.account.email ?? 'unknown'),
            field(
                'organization',
                saved.signedInAs === null
                    ? 'unknown'
                    : `${saved.signedInAs.organization.name} (${saved.signedInAs.organization.slug})`
            ),
            field('app', saved.appUrl),
            field('scopes', saved.scopes.join(' ')),
        ].join('\n')
    );
}

export async function listAccounts(
    context: SignInContext,
    options: { readonly profile: string | null }
): Promise<void> {
    const inUse = await resolveProfile(context.dir, options.profile, context.environment);
    const rows = (await readAccounts(context.dir)).map(({ name, login: saved }) => [
        `${name === inUse ? '*' : ' '} ${name}`,
        saved.kind === 'api_key'
            ? `API key ${maskApiKey(saved.apiKey)}`
            : (saved.signedInAs?.account.email ?? saved.appUrl),
        saved.kind === 'oauth' ? (saved.signedInAs?.organization.name ?? '') : '',
    ]);
    if (rows.length === 0) {
        context.print('No saved sign-ins. Run dexto login.');
        return;
    }
    context.print(table(rows));
}

export async function useAccount(context: SignInContext, wanted: string): Promise<void> {
    const { name, login: saved } = await requireSaved(context, wanted);
    await writeCurrentProfile(context.dir, name);
    const overridden = (await resolveProfile(context.dir, null, context.environment)) !== name;
    context.print(
        `Now using ${describeProfile(name, saved)}.${overridden ? ' DEXTO_PROFILE still chooses another profile here.' : ''}`
    );
}

export async function removeAccount(
    context: SignInContext,
    wanted: string,
    options: { readonly yes: boolean }
): Promise<void> {
    const { name, login: saved } = await requireSaved(context, wanted);
    const question =
        saved.kind === 'oauth'
            ? `Log ${describeProfile(name, saved)} out and forget it on this machine?`
            : `Forget ${describeProfile(name, saved)} on this machine?`;
    if (!options.yes && !(await context.confirm(question)))
        throw new CommandError(
            NEEDS_CONFIRMATION,
            `${question} Run dexto accounts remove ${name} --yes to confirm.`
        );
    const wasCurrent = (await readCurrentProfile(context.dir)) === name;
    await logOutProfile(context, name);
    if (wasCurrent) await writeCurrentProfile(context.dir, DEFAULT_PROFILE);
    context.print(
        `Removed ${name}.${wasCurrent && name !== DEFAULT_PROFILE ? ` Now using ${DEFAULT_PROFILE}.` : ''}`
    );
}

async function requireSaved(
    context: SignInContext,
    wanted: string
): Promise<{ name: string; login: StoredLogin }> {
    const name = requireProfileName(wanted);
    const saved = await readLogin(context.dir, name);
    if (saved === null)
        throw new CommandError(
            NOT_FOUND,
            `No saved sign-in is named ${name}. Run dexto login --profile ${name}.`
        );
    return { name, login: saved };
}

/** `work (ada@example.com in Acme)`, or the key or app a profile signs in with. */
function describeProfile(name: string, saved: StoredLogin): string {
    if (saved.kind === 'api_key') return `${name} (API key ${maskApiKey(saved.apiKey)})`;
    return saved.signedInAs === null
        ? `${name} (${saved.appUrl})`
        : `${name} (${saved.signedInAs.account.email} in ${saved.signedInAs.organization.name})`;
}

/** ` as ada@example.com in Acme`, or nothing when the server didn't say. */
function describeSignedInAs(signedInAs: SignedInAs | null): string {
    return signedInAs === null
        ? ''
        : ` as ${signedInAs.account.email} in ${signedInAs.organization.name}`;
}

/** `dxt_123…abcd`: enough to recognize a key without showing it. */
function maskApiKey(apiKey: string): string {
    return apiKey.length <= 12 ? '…' : `${apiKey.slice(0, 7)}…${apiKey.slice(-4)}`;
}

function field(name: string, value: string): string {
    return `${name.padEnd(13)} ${value}`;
}

function table(rows: readonly (readonly string[])[]): string {
    const widths = rows[0]?.map((_, column) =>
        Math.max(...rows.map((row) => row[column]?.length ?? 0))
    );
    return rows
        .map((row) =>
            row
                .map((cell, column) =>
                    column === row.length - 1 ? cell : cell.padEnd(widths?.[column] ?? 0)
                )
                .join('  ')
                .trimEnd()
        )
        .join('\n');
}

function splitList(value: string): string[] {
    return value
        .split(/[\s,]+/u)
        .map((each) => each.trim())
        .filter((each) => each.length > 0);
}

function nonEmpty(value: string | undefined): string | null {
    return value === undefined || value.length === 0 ? null : value;
}

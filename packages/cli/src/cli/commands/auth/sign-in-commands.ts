// `dexto login`, `logout`, `whoami` and `accounts`: signing in to Dexto and the saved profiles.

import { dextoAccounts, type dextoCloud, type dextoSignIn } from '@dexto/agent-management';
import { CommandFailure, UsageError } from '../../cloud/command.js';

type OAuthLogin = dextoAccounts.OAuthLogin;
type SignedInAs = dextoAccounts.SignedInAs;
type StoredLogin = dextoAccounts.StoredLogin;
type CloudProject = dextoCloud.CloudProject;
type BrowserSignInInput = dextoSignIn.BrowserSignInInput;
type EndedSignIn = dextoSignIn.EndedSignIn;
type SignInInput = dextoSignIn.SignInInput;

const {
    DEFAULT_PROFILE,
    forgetLogin,
    listAccounts: readAccounts,
    profileNameFor,
    readCurrentProfile,
    readLogin,
    requireProfileName,
    resolveCredential,
    resolveProfile,
    writeCurrentProfile,
    writeLogin,
} = dextoAccounts;

/** Dexto's side of signing in, injected so commands can be tested without a server. */
export interface DextoSignIn {
    readonly signInWithBrowser: (input: BrowserSignInInput) => Promise<OAuthLogin>;
    readonly signInWithDevice: (input: SignInInput) => Promise<OAuthLogin>;
    readonly endSignIn: (login: OAuthLogin) => Promise<EndedSignIn>;
    readonly refreshSignIn: (login: OAuthLogin) => Promise<OAuthLogin>;
    /** The Cloud projects the signed-in organization has. */
    readonly listProjects: (login: OAuthLogin) => Promise<readonly CloudProject[]>;
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
    /** A command's result: the value for JSON output, the text for people. */
    readonly result: (value: unknown, text: string) => void;
    /** Anything else, on stderr. */
    readonly note: (text: string) => void;
    /** Asks the person; false when there is no one to ask. */
    readonly confirm: (question: string) => Promise<boolean>;
    /** False over SSH or without a display: a loopback redirect can't reach this machine. */
    readonly canOpenBrowser: boolean;
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
            throw new UsageError('An API key acts as itself; --org is for signing in.');
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
    // A browser elsewhere can't reach this machine's loopback redirect, so use a code instead.
    const device = options.device || (options.browser && !context.canOpenBrowser);
    if (device && !options.device)
        context.note('No browser here, so sign in with a code on any device.');
    const signedIn = device
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
        throw new UsageError(
            `The profile ${profile} already signs in to ${savedOrganization.name}. Sign in to ${newOrganization.name} with --profile <name> to keep both.`
        );

    const withProject = {
        ...signedIn,
        cloudProject: chooseProject(
            await context.dexto.listProjects(signedIn),
            previous?.cloudProject ?? null
        ),
    };
    await writeLogin(context.dir, profile, withProject);
    if (switches) await writeCurrentProfile(context.dir, profile);
    const current = (await resolveProfile(context.dir, null, context.environment)) === profile;
    context.result(
        {
            profile,
            current,
            account: signedIn.signedInAs?.account ?? null,
            organization: signedIn.signedInAs?.organization ?? null,
            cloud_project: withProject.cloudProject,
            scopes: withProject.scopes,
        },
        [
            `Signed in${describeSignedInAs(signedIn.signedInAs)}${profile === DEFAULT_PROFILE ? '' : ` (profile ${profile})`}.`,
            withProject.cloudProject === null
                ? 'This organization has no Cloud project for Dexto models to bill.'
                : `Dexto models bill Cloud project ${withProject.cloudProject.name}.`,
            ...(current
                ? []
                : [
                      `Other commands still use another profile: pass --profile ${profile}, or run dexto accounts use ${profile}.`,
                  ]),
        ].join(' ')
    );
}

/**
 * The project chosen before while it is still live, so signing in again doesn't move anyone;
 * otherwise the organization's default project.
 */
function chooseProject(
    projects: readonly CloudProject[],
    previous: OAuthLogin['cloudProject']
): OAuthLogin['cloudProject'] {
    const chosen =
        projects.find((project) => project.id === previous?.id && !project.archived) ??
        projects.find((project) => project.isDefault && !project.archived) ??
        null;
    return chosen === null ? null : { id: chosen.id, name: chosen.name };
}

async function saveApiKey(context: SignInContext, profile: string, apiKey: string): Promise<void> {
    if (!(await context.dexto.acceptsApiKey(context.apiBaseUrl, apiKey)))
        throw new CommandFailure('needs_sign_in', 'Dexto refused this API key.', null);
    await writeLogin(context.dir, profile, {
        kind: 'api_key',
        apiKey,
        apiBaseUrl: context.apiBaseUrl,
        savedAt: new Date().toISOString(),
    });
    context.result(
        { profile, key: maskApiKey(apiKey) },
        `Saved API key ${maskApiKey(apiKey)}${profile === DEFAULT_PROFILE ? '' : ` (profile ${profile})`}.`
    );
}

/** Who the current profile acts as, in a few words, or null when signed out. */
export async function describeSignIn(context: SignInContext): Promise<string | null> {
    const environmentKey = nonEmpty(context.environment.DEXTO_API_KEY);
    if (environmentKey !== null) return `API key ${maskApiKey(environmentKey)} from DEXTO_API_KEY`;
    const profile = await resolveProfile(context.dir, null, context.environment);
    const saved = await readLogin(context.dir, profile);
    if (saved === null) return null;
    const suffix = profile === DEFAULT_PROFILE ? '' : ` (profile ${profile})`;
    if (saved.kind === 'api_key') return `API key ${maskApiKey(saved.apiKey)}${suffix}`;
    const who =
        saved.signedInAs === null
            ? saved.appUrl
            : `${saved.signedInAs.account.email} in ${saved.signedInAs.organization.name}`;
    return `${who}${suffix}`;
}

export async function logout(
    context: SignInContext,
    options: { readonly profile: string | null }
): Promise<void> {
    const profile = await resolveProfile(context.dir, options.profile, context.environment);
    const removed = await logOutProfile(context, profile);
    const named = profile === DEFAULT_PROFILE ? '' : ` for profile ${profile}`;
    context.result(
        { profile, logged_out: removed },
        removed ? `Logged out${named}.` : `No saved sign-in${named}.`
    );
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
        throw new CommandFailure('needs_sign_in', 'Not signed in.', 'dexto login');
    if (credential.kind === 'api_key') {
        const from =
            credential.source === 'flag'
                ? ' (from --api-key)'
                : credential.source === 'environment'
                  ? ' (from DEXTO_API_KEY)'
                  : `, profile ${credential.profile}`;
        context.result(
            { as: 'api_key', key: maskApiKey(credential.token), source: credential.source },
            field('api key', `${maskApiKey(credential.token)}${from}`)
        );
        return;
    }
    const { login: saved } = credential;
    context.result(
        {
            as: 'person',
            profile: credential.profile,
            account: saved.signedInAs?.account ?? null,
            organization: saved.signedInAs?.organization ?? null,
            app_url: saved.appUrl,
            cloud_project: saved.cloudProject,
            scopes: saved.scopes,
        },
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
    const accounts = (await readAccounts(context.dir)).map(({ name, login: saved }) => ({
        profile: name,
        current: name === inUse,
        kind: saved.kind,
        account: saved.kind === 'oauth' ? (saved.signedInAs?.account ?? null) : null,
        organization: saved.kind === 'oauth' ? (saved.signedInAs?.organization ?? null) : null,
        key: saved.kind === 'api_key' ? maskApiKey(saved.apiKey) : null,
        url: saved.kind === 'oauth' ? saved.appUrl : saved.apiBaseUrl,
    }));
    const rows = accounts.map((account) => [
        `${account.current ? '*' : ' '} ${account.profile}`,
        account.key !== null ? `API key ${account.key}` : (account.account?.email ?? account.url),
        account.organization?.name ?? '',
    ]);
    context.result(
        { data: accounts },
        rows.length === 0 ? 'No saved sign-ins. Run dexto login.' : table(rows)
    );
}

export async function useAccount(context: SignInContext, wanted: string): Promise<void> {
    const { name, login: saved } = await requireSaved(context, wanted);
    await writeCurrentProfile(context.dir, name);
    const overridden = (await resolveProfile(context.dir, null, context.environment)) !== name;
    context.result(
        { current: name },
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
        throw new CommandFailure(
            'needs_confirmation',
            `${question} Pass --yes once your person has agreed.`,
            `dexto accounts remove ${name} --yes`
        );
    const wasCurrent = (await readCurrentProfile(context.dir)) === name;
    await logOutProfile(context, name);
    if (wasCurrent) await writeCurrentProfile(context.dir, DEFAULT_PROFILE);
    context.result(
        { removed: name, current: wasCurrent ? DEFAULT_PROFILE : null },
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
        throw new CommandFailure(
            'not_found',
            `No saved sign-in is named ${name}.`,
            `dexto login --profile ${name}`
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

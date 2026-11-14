import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { dextoAccounts, dextoSignIn, type dextoCloud } from '@dexto/agent-management';
import { onTerminal } from '@dexto/tui/signal-harness';
import {
    type SignInContext,
    plainSignInScreen,
    describeSignIn,
    listAccounts,
    login,
    logout,
    removeAccount,
    useAccount,
    whoami,
} from './sign-in-commands.js';

type OAuthLogin = dextoAccounts.OAuthLogin;
type CloudProject = dextoCloud.CloudProject;
type BrowserSignInInput = dextoSignIn.BrowserSignInInput;
type EndedSignIn = dextoSignIn.EndedSignIn;
type SignInInput = dextoSignIn.SignInInput;
const { readCurrentProfile, readLogin, writeCurrentProfile, writeLogin } = dextoAccounts;

const APP = 'https://app.dexto.ai';
const API = 'https://api.dexto.ai';

function signedIn(
    organization: { id: string; name: string; slug: string },
    overrides: Partial<OAuthLogin> = {}
): OAuthLogin {
    return {
        kind: 'oauth',
        accessToken: 'access-1',
        refreshToken: 'refresh-1',
        expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
        clientId: 'dexto-cli',
        appUrl: APP,
        apiBaseUrl: API,
        resource: `${APP}/mcp`,
        tokenEndpoint: `${APP}/api/oauth/token`,
        scopes: ['cloud:read'],
        savedAt: '2026-10-31T00:00:00.000Z',
        cloudProject: null,
        signedInAs: {
            account: { email: 'ada@example.com', id: 'acc_1', name: 'Ada' },
            organization,
        },
        ...overrides,
    };
}

const ACME = { id: 'org_acme', name: 'Acme', slug: 'acme' };
const OTHER = { id: 'org_other', name: 'Other Acme', slug: 'other-acme' };

describe('sign-in commands', () => {
    let dir: string;
    let printed: string[];
    let values: unknown[];
    let notes: string[];
    let browserInputs: BrowserSignInInput[];
    let deviceInputs: SignInInput[];
    let ended: OAuthLogin[];
    let endResult: EndedSignIn;
    let checkedKeys: string[];
    let keyAccepted: boolean;
    let organization: { id: string; name: string; slug: string };
    let projects: CloudProject[];
    let context: SignInContext;
    let chatSyncOn: boolean;

    beforeEach(async () => {
        dir = path.join(await mkdtemp(path.join(os.tmpdir(), 'dexto-sign-in-')), 'accounts');
        printed = [];
        values = [];
        notes = [];
        browserInputs = [];
        deviceInputs = [];
        ended = [];
        endResult = { status: 'ended' };
        checkedKeys = [];
        keyAccepted = true;
        chatSyncOn = false;
        organization = ACME;
        projects = [
            { id: 'prj_old', name: 'Old', isDefault: false, archived: true },
            { id: 'prj_main', name: 'Main', isDefault: true, archived: false },
            { id: 'prj_side', name: 'Side', isDefault: false, archived: false },
        ];
        context = {
            dir,
            environment: {},
            appUrl: APP,
            apiBaseUrl: API,
            result: (value, text) => {
                values.push(value);
                printed.push(text);
            },
            note: (text) => notes.push(text),
            screen: plainSignInScreen((text) => notes.push(text)),
            confirm: async () => false,
            canOpenBrowser: true,
            interactive: true,
            chatSyncOn: async () => chatSyncOn,
            dexto: {
                signInWithBrowser: async (input) => {
                    browserInputs.push(input);
                    return signedIn(organization, {
                        scopes: ['cloud:read', ...input.extraScopes],
                    });
                },
                signInWithDevice: async (input) => {
                    deviceInputs.push(input);
                    return signedIn(organization);
                },
                endSignIn: async (saved) => {
                    ended.push(saved);
                    return endResult;
                },
                refreshSignIn: async (saved) => saved,
                listProjects: async () => projects,
                acceptsApiKey: async (_apiBaseUrl, apiKey) => {
                    checkedKeys.push(apiKey);
                    return keyAccepted;
                },
            },
        };
    });

    afterEach(async () => {
        await rm(path.dirname(dir), { recursive: true, force: true });
    });

    const noOptions = {
        profile: null,
        org: null,
        device: false,
        browser: true,
        scopes: [],
        apiKey: null,
    };

    describe('login', () => {
        it('signs in with the browser into the default profile', async () => {
            await login(context, noOptions);

            expect(browserInputs).toEqual([
                {
                    appUrl: APP,
                    apiBaseUrl: API,
                    organization: null,
                    extraScopes: [],
                    openBrowser: true,
                },
            ]);
            expect((await readLogin(dir, 'default'))?.kind).toBe('oauth');
            expect(printed).toEqual([
                'Signed in as ada@example.com in Acme. Dexto models bill Cloud project Main.',
            ]);
        });

        it("acts in the organization's default Cloud project, and says so", async () => {
            await login(context, noOptions);

            const saved = await readLogin(dir, 'default');
            expect(saved?.kind === 'oauth' && saved.cloudProject).toEqual({
                id: 'prj_main',
                name: 'Main',
            });
            expect(printed).toEqual([
                'Signed in as ada@example.com in Acme. Dexto models bill Cloud project Main.',
            ]);
        });

        it('keeps the Cloud project chosen before while it is live', async () => {
            await writeLogin(
                dir,
                'default',
                signedIn(ACME, { cloudProject: { id: 'prj_side', name: 'Side' } })
            );
            await login(context, noOptions);
            const kept = await readLogin(dir, 'default');
            expect(kept?.kind === 'oauth' && kept.cloudProject?.id).toBe('prj_side');

            await writeLogin(
                dir,
                'default',
                signedIn(ACME, { cloudProject: { id: 'prj_old', name: 'Old' } })
            );
            await login(context, noOptions);
            const moved = await readLogin(dir, 'default');
            expect(moved?.kind === 'oauth' && moved.cloudProject?.id).toBe('prj_main');
        });

        it('uses the browser for plain login from a non-interactive desktop shell', async () => {
            context = { ...context, interactive: false };

            await login(context, noOptions);

            expect(browserInputs).toHaveLength(1);
            expect(browserInputs[0]?.openBrowser).toBe(true);
            expect(deviceInputs).toHaveLength(0);
            expect(notes).toEqual([]);
        });

        it('signs in with a device code with --device', async () => {
            await login(context, { ...noOptions, device: true });

            expect(deviceInputs).toHaveLength(1);
            expect(browserInputs).toHaveLength(0);
        });

        it('signs in with a device code when no browser can open here, and says so', async () => {
            context = { ...context, canOpenBrowser: false };

            await login(context, noOptions);

            expect(deviceInputs).toHaveLength(1);
            expect(browserInputs).toHaveLength(0);
            expect(notes).toEqual(['No browser here, so sign in with a code on any device.']);
        });

        it('only prints the link with --no-browser', async () => {
            await login(context, { ...noOptions, browser: false });

            expect(browserInputs[0]?.openBrowser).toBe(false);
        });

        it('saves --org as a profile named after it and uses it from now on', async () => {
            await login(context, { ...noOptions, org: 'Acme' });

            expect(browserInputs[0]?.organization).toBe('Acme');
            expect((await readLogin(dir, 'acme'))?.kind).toBe('oauth');
            expect(await readCurrentProfile(dir)).toBe('acme');
            expect(printed).toEqual([
                'Signed in as ada@example.com in Acme (profile acme). Dexto models bill Cloud project Main.',
            ]);
        });

        it('keeps the current profile when --profile names where to save', async () => {
            await login(context, { ...noOptions, org: 'acme', profile: 'work' });

            expect((await readLogin(dir, 'work'))?.kind).toBe('oauth');
            expect(await readCurrentProfile(dir)).toBe('default');
            expect(printed.join(' ')).toContain('dexto accounts use work');
        });

        it('signing in again keeps the permissions and organization granted before', async () => {
            await writeLogin(
                dir,
                'default',
                signedIn(ACME, { scopes: ['cloud:read', 'drive:write'] })
            );

            await login(context, { ...noOptions, scopes: ['memories:write'] });

            expect(browserInputs[0]).toMatchObject({
                organization: 'org_acme',
                extraScopes: ['cloud:read', 'drive:write', 'memories:write'],
            });
        });

        it('asks for chats:sync only while chat sync is on', async () => {
            chatSyncOn = true;
            await login(context, noOptions);
            expect(browserInputs[0]?.extraScopes).toEqual(['chats:sync']);

            chatSyncOn = false;
            await login(context, noOptions);
            expect(browserInputs[1]?.extraScopes).toEqual(['cloud:read']);
        });

        it("won't save another organization over a profile --org named", async () => {
            await writeLogin(dir, 'acme', signedIn(OTHER));
            organization = ACME;

            await expect(login(context, { ...noOptions, org: 'acme' })).rejects.toThrow(
                'The profile acme already signs in to Other Acme.'
            );
            const kept = await readLogin(dir, 'acme');
            expect(kept?.kind === 'oauth' && kept.signedInAs?.organization.id).toBe('org_other');
        });

        it('saves an API key after the API accepts it', async () => {
            await login(context, { ...noOptions, apiKey: 'dxt_1234567890abcd' });

            expect(checkedKeys).toEqual(['dxt_1234567890abcd']);
            expect(await readLogin(dir, 'default')).toMatchObject({
                kind: 'api_key',
                apiKey: 'dxt_1234567890abcd',
                apiBaseUrl: API,
            });
            expect(printed).toEqual(['Saved API key dxt_123…abcd.']);
        });

        it('refuses an API key the API rejects', async () => {
            keyAccepted = false;

            await expect(
                login(context, { ...noOptions, apiKey: 'dxt_bad_key_value' })
            ).rejects.toThrow('Dexto refused this API key.');
            expect(await readLogin(dir, 'default')).toBeNull();
        });
    });

    describe('describeSignIn', () => {
        it('is null when signed out', async () => {
            expect(await describeSignIn(context)).toBeNull();
        });

        it('names the account and organization, and a profile other than default', async () => {
            await writeLogin(dir, 'default', signedIn(ACME));
            expect(await describeSignIn(context)).toBe('ada@example.com in Acme');

            await writeLogin(dir, 'other', signedIn(OTHER));
            await writeCurrentProfile(dir, 'other');
            expect(await describeSignIn(context)).toBe(
                'ada@example.com in Other Acme (profile other)'
            );
        });

        it('names a key by its mask, and where it came from', async () => {
            context = { ...context, environment: { DEXTO_API_KEY: 'dxt_1234567890abcd' } };
            expect(await describeSignIn(context)).toBe('API key dxt_123…abcd from DEXTO_API_KEY');
        });
    });

    describe('logout', () => {
        it('ends the sign-in on the server and forgets it', async () => {
            await writeLogin(dir, 'default', signedIn(ACME));

            await logout(context, { profile: null });

            expect(ended).toHaveLength(1);
            expect(await readLogin(dir, 'default')).toBeNull();
            expect(printed).toEqual(['Logged out.']);
        });

        it("forgets the sign-in even when the server couldn't end it, and says so", async () => {
            await writeLogin(dir, 'default', signedIn(ACME));
            endResult = { status: 'failed', reason: 'offline' };

            await logout(context, { profile: null });

            expect(await readLogin(dir, 'default')).toBeNull();
            expect(notes.join('\n')).toContain(`${APP}/settings/sign-ins`);
        });

        it('says when there was nothing to log out of', async () => {
            await logout(context, { profile: 'work' });

            expect(printed).toEqual(['No saved sign-in for profile work.']);
        });
    });

    describe('whoami', () => {
        it('is signed out with exit 3 and how to sign in', async () => {
            await expect(whoami(context, { profile: null, apiKey: null })).rejects.toMatchObject({
                kind: 'needs_sign_in',
                message: 'Not signed in.',
                fix: 'dexto login',
            });
        });

        it('suggests device sign-in in a non-interactive desktop shell', async () => {
            context = { ...context, interactive: false };

            await expect(whoami(context, { profile: null, apiKey: null })).rejects.toMatchObject({
                kind: 'needs_sign_in',
                fix: 'dexto login --device',
            });
        });

        it('gives a device sign-in fix when no browser can finish it', async () => {
            context = { ...context, canOpenBrowser: false };

            await expect(whoami(context, { profile: 'work', apiKey: null })).rejects.toMatchObject({
                kind: 'needs_sign_in',
                fix: 'dexto login --profile work --device',
            });
        });

        it('gives a device sign-in fix over SSH even with a browser available', async () => {
            context = { ...context, environment: { SSH_TTY: '/dev/pts/1' } };

            await expect(whoami(context, { profile: null, apiKey: null })).rejects.toMatchObject({
                kind: 'needs_sign_in',
                fix: 'dexto login --device',
            });
        });

        it('shows the profile, account, organization and where it came from', async () => {
            await writeLogin(dir, 'work', signedIn(ACME));
            await writeCurrentProfile(dir, 'work');

            await whoami(context, { profile: null, apiKey: null });

            expect(printed).toEqual([
                [
                    'profile       work',
                    'account       ada@example.com',
                    'organization  Acme (acme)',
                    `app           ${APP}`,
                    'scopes        cloud:read',
                ].join('\n'),
            ]);
        });

        it('shows a key masked, and that it came from DEXTO_API_KEY', async () => {
            context = { ...context, environment: { DEXTO_API_KEY: 'dxt_1234567890abcd' } };

            await whoami(context, { profile: null, apiKey: null });

            expect(printed).toEqual(['api key       dxt_123…abcd (from DEXTO_API_KEY)']);
            expect(values).toEqual([{ as: 'api_key', key: 'dxt_123…abcd', source: 'environment' }]);
        });

        it("says the account and organization are unknown when the sign-in didn't say", async () => {
            await writeLogin(dir, 'default', signedIn(ACME, { signedInAs: null }));

            await whoami(context, { profile: null, apiKey: null });

            expect(printed).toEqual([
                [
                    'profile       default',
                    'account       unknown',
                    'organization  unknown',
                    `app           ${APP}`,
                    'scopes        cloud:read',
                ].join('\n'),
            ]);
            expect(values).toEqual([
                {
                    as: 'person',
                    profile: 'default',
                    account: null,
                    organization: null,
                    app_url: APP,
                    cloud_project: null,
                    scopes: ['cloud:read'],
                },
            ]);
        });

        it('shows a saved API key masked, with its profile', async () => {
            await writeLogin(dir, 'default', {
                kind: 'api_key',
                apiKey: 'dxt_1234567890abcd',
                apiBaseUrl: API,
                savedAt: '2026-10-31T00:00:00.000Z',
            });

            await whoami(context, { profile: null, apiKey: null });

            expect(printed).toEqual(['api key       dxt_123…abcd, profile default']);
            expect(values).toEqual([{ as: 'api_key', key: 'dxt_123…abcd', source: 'login' }]);
        });
    });

    describe('accounts', () => {
        beforeEach(async () => {
            await writeLogin(dir, 'default', signedIn(ACME));
            await writeLogin(dir, 'other', signedIn(OTHER));
            await writeCurrentProfile(dir, 'other');
        });

        it('lists saved sign-ins and marks the one in use', async () => {
            await listAccounts(context, { profile: null });

            expect(printed).toEqual([
                ['  default  ada@example.com  Acme', '* other    ada@example.com  Other Acme'].join(
                    '\n'
                ),
            ]);
        });

        it('switches the profile in use', async () => {
            await useAccount(context, 'default');

            expect(await readCurrentProfile(dir)).toBe('default');
            expect(printed).toEqual(['Now using default (ada@example.com in Acme).']);
        });

        it('refuses a profile with no sign-in', async () => {
            await expect(useAccount(context, 'nope')).rejects.toMatchObject({
                kind: 'not_found',
                message: 'No saved sign-in is named nope.',
                fix: 'dexto login --profile nope',
            });
        });

        it('asks before removing, and removes with --yes', async () => {
            await expect(removeAccount(context, 'other', { yes: false })).rejects.toMatchObject({
                kind: 'needs_confirmation',
                fix: 'dexto accounts remove other --yes',
            });
            expect(await readLogin(dir, 'other')).not.toBeNull();

            await removeAccount(context, 'other', { yes: true });

            expect(ended).toHaveLength(1);
            expect(await readLogin(dir, 'other')).toBeNull();
            expect(await readCurrentProfile(dir)).toBe('default');
            expect(printed).toEqual(['Removed other. Now using default.']);
        });

        it('removes after the person confirms', async () => {
            context = { ...context, confirm: async () => true };

            await removeAccount(context, 'other', { yes: false });

            expect(await readLogin(dir, 'other')).toBeNull();
        });
    });

    it('reports each result as a value for JSON as well as text', async () => {
        await writeLogin(dir, 'work', signedIn(ACME));
        await writeCurrentProfile(dir, 'work');

        await whoami(context, { profile: null, apiKey: null });

        expect(values).toEqual([
            {
                as: 'person',
                profile: 'work',
                account: { email: 'ada@example.com', id: 'acc_1', name: 'Ada' },
                organization: ACME,
                app_url: APP,
                cloud_project: null,
                scopes: ['cloud:read'],
            },
        ]);
    });

    describe('with control characters in server text', () => {
        // ESC[2J clears the screen, OSC 0 sets the title, CSI as one C1 byte sets a colour.
        const HOSTILE = 'Evil\u001B[2J Org\u001B]0;pwned\u0007 \u009B31mInc';
        // eslint-disable-next-line no-control-regex
        const CONTROLS = /[\u001B\u0007\u0080-\u009F]/u;
        const EVIL = { id: 'org_evil', name: HOSTILE, slug: `evil${HOSTILE}` };
        const evilLogin = (overrides: Partial<OAuthLogin> = {}) =>
            signedIn(EVIL, {
                signedInAs: {
                    account: { email: `ada${HOSTILE}@example.com`, id: 'acc_1', name: 'Ada' },
                    organization: EVIL,
                },
                scopes: ['cloud:read', `cloud:${HOSTILE}`],
                ...overrides,
            });
        const expectClean = (text: string | undefined) => {
            expect(text).toBeDefined();
            expect(text).not.toMatch(CONTROLS);
            expect(text).toContain('Evil[2J Org]0;pwned 31mInc');
        };

        it('strips them from the signed-in words, project name included', async () => {
            organization = EVIL;
            projects = [{ id: 'prj_main', name: HOSTILE, isDefault: true, archived: false }];
            context = {
                ...context,
                dexto: { ...context.dexto, signInWithBrowser: async () => evilLogin() },
            };

            await login(context, noOptions);

            expect(printed).toHaveLength(1);
            expectClean(printed[0]);
            expect(printed[0]).toContain('Signed in as adaEvil[2J Org]0;pwned 31mInc@example.com');
            expect(printed[0]).toContain('Dexto models bill Cloud project Evil[2J');
            expect(JSON.stringify(values)).toContain('\\u001b[2J');
        });

        it('strips them from the organization conflict', async () => {
            await writeLogin(dir, 'acme', evilLogin());
            organization = { ...ACME, name: HOSTILE };

            const failure = await login(context, { ...noOptions, org: 'acme' }).catch(
                (error: unknown) => error
            );

            expect(failure).toBeInstanceOf(Error);
            const message = (failure as Error).message;
            expectClean(message);
            expect(message).toContain('The profile acme already signs in to Evil[2J');
        });

        it('strips them from the sign-in prompt: code and links', () => {
            const shown: string[] = [];
            const screen = plainSignInScreen((text) => shown.push(text));

            screen.show({ kind: 'browser', authorizeUrl: `${APP}/authorize?x=${HOSTILE}` });
            screen.show({
                kind: 'device',
                userCode: `ABCD${HOSTILE}`,
                verificationUri: `${APP}/device${HOSTILE}`,
                verificationUriComplete: null,
                expiresInSeconds: 600,
                organization: `Acme${HOSTILE}`,
                scopes: [`cloud:read${HOSTILE}`],
                computer: `laptop${HOSTILE}`,
            });
            screen.show({
                kind: 'device',
                userCode: `ABCD${HOSTILE}`,
                verificationUri: `${APP}/device`,
                verificationUriComplete: `${APP}/device?code=${HOSTILE}`,
                expiresInSeconds: 600,
                organization: null,
                scopes: [],
                computer: 'laptop',
            });

            expect(shown).toHaveLength(3);
            shown.forEach(expectClean);
            // The prompt's own line breaks stay.
            expect(shown[1]).toContain(
                'To sign in, open this link on any device and enter ABCDEvil[2J'
            );
            expect(shown[1]?.split('\n')).toHaveLength(8);
        });

        it('strips them from describeSignIn', async () => {
            await writeLogin(dir, 'default', evilLogin());
            expectClean((await describeSignIn(context)) ?? undefined);

            await writeLogin(
                dir,
                'default',
                evilLogin({ signedInAs: null, appUrl: `${APP}/${HOSTILE}` })
            );
            expectClean((await describeSignIn(context)) ?? undefined);
        });

        it('strips them from whoami', async () => {
            await writeLogin(dir, 'default', evilLogin({ appUrl: `${APP}/${HOSTILE}` }));

            await whoami(context, { profile: null, apiKey: null });

            expectClean(printed[0]);
            const lines = printed[0]?.split('\n') ?? [];
            expect(lines).toHaveLength(5);
            expect(lines[2]).toBe(
                'organization  Evil[2J Org]0;pwned 31mInc (evilEvil[2J Org]0;pwned 31mInc)'
            );
        });

        it('strips them from the accounts list and the remove question', async () => {
            await writeLogin(dir, 'default', evilLogin());
            await writeLogin(
                dir,
                'other',
                evilLogin({ signedInAs: null, appUrl: `${APP}/${HOSTILE}` })
            );

            await listAccounts(context, { profile: null });
            expectClean(printed[0]);
            expect(printed[0]?.split('\n')).toHaveLength(2);

            for (const name of ['default', 'other']) {
                const failure = await removeAccount(context, name, { yes: false }).catch(
                    (error: unknown) => error
                );
                expectClean((failure as Error).message);
            }
        });

        it("strips them from the note when the server couldn't end a sign-in", async () => {
            await writeLogin(dir, 'default', evilLogin());
            endResult = { status: 'failed', reason: HOSTILE };

            await logout(context, { profile: null });

            expect(notes).toHaveLength(1);
            expectClean(notes[0]);
        });
    });

    describe('on Signal', () => {
        const withSignal = <T>(run: () => Promise<T>) => onTerminal('no-color', run);

        it('shows whoami as one labelled row each, and keeps the JSON as it was', async () => {
            await writeLogin(
                dir,
                'work',
                signedIn(ACME, { cloudProject: { id: 'prj_main', name: 'Main' } })
            );
            await writeCurrentProfile(dir, 'work');

            const lines: string[] = [];
            await withSignal(async () => {
                await whoami(context, { profile: null, apiKey: null });
                lines.push(...printed);
            });

            expect(lines.join('\n')).toBe(
                [
                    '◆ Signed in as Ada  ada@example.com',
                    '  org       Acme (acme)',
                    '  project   Main',
                    '  access    cloud:read',
                    '  profile   work',
                    `  app       ${APP}`,
                    '',
                    '  switch: dexto login --profile <name> · sign out: dexto logout',
                ].join('\n')
            );
            expect(values[0]).toMatchObject({ as: 'person', profile: 'work' });
        });

        it("says Signed in, with the org unknown, when the sign-in didn't say who", async () => {
            await writeLogin(dir, 'default', signedIn(ACME, { signedInAs: null }));

            await withSignal(() => whoami(context, { profile: null, apiKey: null }));

            const lines = printed.join('\n').split('\n');
            expect(lines[0]).toBe('◆ Signed in');
            expect(lines[1]).toBe('  org       unknown');
            expect(values).toEqual([
                expect.objectContaining({ as: 'person', account: null, organization: null }),
            ]);
        });

        it('shows an API key the same way, saved or from DEXTO_API_KEY', async () => {
            await writeLogin(dir, 'default', {
                kind: 'api_key',
                apiKey: 'dxt_1234567890abcd',
                apiBaseUrl: API,
                savedAt: '2026-10-31T00:00:00.000Z',
            });

            await withSignal(() => whoami(context, { profile: null, apiKey: null }));
            context = { ...context, environment: { DEXTO_API_KEY: 'dxt_abcdefgh123456' } };
            await withSignal(() => whoami(context, { profile: null, apiKey: null }));

            expect(printed).toEqual([
                'api key       dxt_123…abcd, profile default',
                'api key       dxt_abc…3456 (from DEXTO_API_KEY)',
            ]);
            expect(values).toEqual([
                { as: 'api_key', key: 'dxt_123…abcd', source: 'login' },
                { as: 'api_key', key: 'dxt_abc…3456', source: 'environment' },
            ]);
        });

        const signalScreen = () => ({
            ...plainSignInScreen(() => undefined),
            look: 'signal' as const,
        });

        it('keeps the plain words for the TUI and JSON, whose screen is plain', async () => {
            context = {
                ...context,
                canOpenBrowser: false,
                dexto: {
                    ...context.dexto,
                    signInWithDevice: async () => {
                        throw new dextoSignIn.SignInEnded('declined', 'Sign-in was declined.');
                    },
                },
            };
            await expect(withSignal(() => login(context, noOptions))).rejects.toThrow(
                'Sign-in was declined.'
            );
            expect(notes).toEqual(['No browser here, so sign in with a code on any device.']);
        });

        it('says what to run when the browser sign-in was declined', async () => {
            context = {
                ...context,
                screen: signalScreen(),
                dexto: {
                    ...context.dexto,
                    signInWithBrowser: async () => {
                        throw new dextoSignIn.SignInEnded('declined', 'Sign-in was declined.');
                    },
                },
            };
            await expect(withSignal(() => login(context, noOptions))).rejects.toMatchObject({
                kind: 'failed',
                message: 'Sign-in cancelled in the browser',
                fix: 'dexto login',
            });
        });

        it("says the sign-in didn't finish when it timed out", async () => {
            context = {
                ...context,
                screen: signalScreen(),
                dexto: {
                    ...context.dexto,
                    signInWithDevice: async () => {
                        throw new dextoSignIn.SignInEnded('timed_out', 'Sign-in timed out.');
                    },
                },
            };
            await expect(
                withSignal(() => login(context, { ...noOptions, device: true }))
            ).rejects.toMatchObject({
                message: "Sign-in didn't finish",
                fix: 'dexto login --device',
            });
        });
    });
});

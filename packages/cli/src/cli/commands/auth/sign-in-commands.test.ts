import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
    type OAuthLogin,
    readCurrentProfile,
    readLogin,
    writeCurrentProfile,
    writeLogin,
} from '../../auth/accounts.js';
import type { BrowserSignInInput, EndedSignIn, SignInInput } from '../../auth/sign-in.js';
import {
    type SignInContext,
    CommandError,
    describeSignIn,
    listAccounts,
    login,
    logout,
    removeAccount,
    useAccount,
    whoami,
} from './sign-in-commands.js';

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
    let notes: string[];
    let browserInputs: BrowserSignInInput[];
    let deviceInputs: SignInInput[];
    let ended: OAuthLogin[];
    let endResult: EndedSignIn;
    let checkedKeys: string[];
    let keyAccepted: boolean;
    let organization: { id: string; name: string; slug: string };
    let context: SignInContext;

    beforeEach(async () => {
        dir = path.join(await mkdtemp(path.join(os.tmpdir(), 'dexto-sign-in-')), 'accounts');
        printed = [];
        notes = [];
        browserInputs = [];
        deviceInputs = [];
        ended = [];
        endResult = { status: 'ended' };
        checkedKeys = [];
        keyAccepted = true;
        organization = ACME;
        context = {
            dir,
            environment: {},
            appUrl: APP,
            apiBaseUrl: API,
            print: (text) => printed.push(text),
            note: (text) => notes.push(text),
            confirm: async () => false,
            canOpenBrowser: true,
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
            expect(printed).toEqual(['Signed in as ada@example.com in Acme.']);
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
            expect(printed).toEqual(['Signed in as ada@example.com in Acme (profile acme).']);
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
                exitCode: 3,
                message: 'Not signed in. Run dexto login.',
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
                exitCode: 5,
                message: 'No saved sign-in is named nope. Run dexto login --profile nope.',
            });
        });

        it('asks before removing, and removes with --yes', async () => {
            await expect(removeAccount(context, 'other', { yes: false })).rejects.toMatchObject({
                exitCode: 4,
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

    it('reports failures as CommandError with an exit code', () => {
        expect(new CommandError(5, 'x').exitCode).toBe(5);
    });
});

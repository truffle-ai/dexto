import { chmod, mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
    type OAuthLogin,
    carryOverCloudCliLogins,
    forgetLogin,
    listAccounts,
    profileNameFor,
    readCurrentProfile,
    readLogin,
    requireProfileName,
    resolveCredential,
    writeCurrentProfile,
    writeLogin,
} from './dexto-accounts.js';

const signedInAs = {
    account: { email: 'ada@example.com', id: 'acc_1', name: 'Ada' },
    organization: { id: 'org_1', name: 'Acme', slug: 'acme' },
};

function oauthLogin(overrides: Partial<OAuthLogin> = {}): OAuthLogin {
    return {
        kind: 'oauth',
        accessToken: 'access-1',
        refreshToken: 'refresh-1',
        expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
        clientId: 'dexto-cli',
        appUrl: 'https://app.dexto.ai',
        apiBaseUrl: 'https://api.dexto.ai',
        resource: 'https://app.dexto.ai/mcp',
        tokenEndpoint: 'https://app.dexto.ai/api/oauth/token',
        scopes: ['cloud:read'],
        savedAt: '2026-10-31T00:00:00.000Z',
        signedInAs,
        cloudProject: null,
        ...overrides,
    };
}

describe('accounts', () => {
    let dir: string;
    let cloudCliDir: string;

    beforeEach(async () => {
        const root = await mkdtemp(path.join(os.tmpdir(), 'dexto-accounts-'));
        dir = path.join(root, 'dexto', 'accounts');
        cloudCliDir = path.join(root, 'config', 'dexto-cloud');
    });

    afterEach(async () => {
        await rm(path.dirname(path.dirname(dir)), { recursive: true, force: true });
    });

    it('saves a login readable only by this user and reads it back', async () => {
        const login = oauthLogin();
        await writeLogin(dir, 'default', login);

        expect(await readLogin(dir, 'default')).toEqual(login);
        const file = await stat(path.join(dir, 'default.json'));
        expect(file.mode & 0o777).toBe(0o600);
        expect((await stat(dir)).mode & 0o777).toBe(0o700);
    });

    it('tightens a folder and file that were readable by others', async () => {
        await mkdir(dir, { recursive: true, mode: 0o755 });
        await writeFile(path.join(dir, 'default.json'), '{}', { mode: 0o644 });
        await chmod(dir, 0o755);
        await chmod(path.join(dir, 'default.json'), 0o644);

        await writeLogin(dir, 'default', oauthLogin());
        await writeCurrentProfile(dir, 'default');

        expect((await stat(dir)).mode & 0o777).toBe(0o700);
        expect((await stat(path.join(dir, 'default.json'))).mode & 0o777).toBe(0o600);
        expect((await stat(path.join(dir, 'current'))).mode & 0o777).toBe(0o600);
    });

    it('reads no login for a profile that has none', async () => {
        expect(await readLogin(dir, 'work')).toBeNull();
    });

    it('refuses a file that is not a saved login', async () => {
        await mkdir(dir, { recursive: true });
        await writeFile(path.join(dir, 'default.json'), '{"kind":"oauth"}');

        await expect(readLogin(dir, 'default')).rejects.toThrow(/not a saved login/);
    });

    it('lists every saved profile, default first, and forgets one', async () => {
        await writeLogin(dir, 'work', oauthLogin());
        await writeLogin(dir, 'default', {
            kind: 'api_key',
            apiKey: 'dxt_1234567890abcd',
            apiBaseUrl: 'https://api.dexto.ai',
            savedAt: '2026-10-31T00:00:00.000Z',
        });

        expect((await listAccounts(dir)).map((account) => account.name)).toEqual([
            'default',
            'work',
        ]);
        expect(await forgetLogin(dir, 'work')).toBe(true);
        expect(await forgetLogin(dir, 'work')).toBe(false);
        expect((await listAccounts(dir)).map((account) => account.name)).toEqual(['default']);
    });

    it('remembers the profile chosen with accounts use, default until then', async () => {
        expect(await readCurrentProfile(dir)).toBe('default');
        await writeCurrentProfile(dir, 'work');
        expect(await readCurrentProfile(dir)).toBe('work');
    });

    it('names profiles safely', () => {
        expect(requireProfileName('work.2')).toBe('work.2');
        expect(() => requireProfileName('../etc')).toThrow(/can't name a profile/);
        expect(profileNameFor('Acme Corp')).toBe('acme-corp');
        expect(profileNameFor('東京')).toMatch(/^org-[0-9a-f]{8}$/);
    });

    describe('carrying over dexto-cloud sign-ins', () => {
        const cloudLogin = {
            accessToken: 'cloud-access',
            apiBaseUrl: 'https://api.dexto.ai',
            appUrl: 'https://app.dexto.ai',
            clientId: 'client_registered',
            cloudProject: { id: 'prj_1', name: 'Main' },
            expiresAt: '2026-11-01T00:00:00.000Z',
            kind: 'oauth',
            refreshToken: 'cloud-refresh',
            resource: 'https://app.dexto.ai/mcp',
            savedAt: '2026-10-30T00:00:00.000Z',
            scopes: ['cloud:read'],
            tokenEndpoint: 'https://app.dexto.ai/api/oauth/token',
        };

        async function seedCloudCli(): Promise<void> {
            await mkdir(path.join(cloudCliDir, 'profiles'), { recursive: true });
            await mkdir(path.join(cloudCliDir, 'accounts'), { recursive: true });
            await writeFile(path.join(cloudCliDir, 'credentials.json'), JSON.stringify(cloudLogin));
            await writeFile(
                path.join(cloudCliDir, 'accounts', 'default.json'),
                JSON.stringify({ ...signedInAs, clientId: 'client_registered' })
            );
            await writeFile(
                path.join(cloudCliDir, 'profiles', 'acme.json'),
                JSON.stringify({
                    kind: 'api_key',
                    apiKey: 'dxt_abcdefghijklmnop',
                    apiBaseUrl: 'https://api.dexto.ai',
                    savedAt: '2026-10-30T00:00:00.000Z',
                })
            );
            await writeFile(path.join(cloudCliDir, 'current'), 'acme\n');
        }

        it('copies every profile, who it acts as and the current choice, once', async () => {
            await seedCloudCli();

            expect(await carryOverCloudCliLogins(dir, cloudCliDir)).toEqual(['default', 'acme']);

            const login = await readLogin(dir, 'default');
            expect(login).toEqual({
                kind: 'oauth',
                accessToken: 'cloud-access',
                refreshToken: 'cloud-refresh',
                expiresAt: '2026-11-01T00:00:00.000Z',
                clientId: 'client_registered',
                appUrl: 'https://app.dexto.ai',
                apiBaseUrl: 'https://api.dexto.ai',
                resource: 'https://app.dexto.ai/mcp',
                tokenEndpoint: 'https://app.dexto.ai/api/oauth/token',
                scopes: ['cloud:read'],
                savedAt: '2026-10-30T00:00:00.000Z',
                signedInAs,
                cloudProject: { id: 'prj_1', name: 'Main' },
            });
            expect((await readLogin(dir, 'acme'))?.kind).toBe('api_key');
            expect(await readCurrentProfile(dir)).toBe('acme');

            await writeLogin(dir, 'default', oauthLogin({ accessToken: 'newer' }));
            expect(await carryOverCloudCliLogins(dir, cloudCliDir)).toEqual([]);
            const kept = await readLogin(dir, 'default');
            expect(kept?.kind === 'oauth' && kept.accessToken).toBe('newer');
        });

        it('carries nothing over when dexto-cloud was never signed in', async () => {
            expect(await carryOverCloudCliLogins(dir, cloudCliDir)).toEqual([]);
            expect(await listAccounts(dir)).toEqual([]);
        });

        it('leaves the dexto-cloud files as they were', async () => {
            await seedCloudCli();
            await carryOverCloudCliLogins(dir, cloudCliDir);

            const original = JSON.parse(
                await readFile(path.join(cloudCliDir, 'credentials.json'), 'utf8')
            );
            expect(original).toEqual(cloudLogin);
        });
    });

    describe('resolveCredential', () => {
        const noRefresh = async (): Promise<OAuthLogin> => {
            throw new Error('should not refresh');
        };

        it('prefers --api-key, then DEXTO_API_KEY, then the saved login', async () => {
            await writeLogin(dir, 'default', oauthLogin());

            await expect(
                resolveCredential({
                    dir,
                    apiKey: 'dxt_flag',
                    environment: { DEXTO_API_KEY: 'dxt_env' },
                    profile: null,
                    refresh: noRefresh,
                })
            ).resolves.toMatchObject({ kind: 'api_key', token: 'dxt_flag', source: 'flag' });
            await expect(
                resolveCredential({
                    dir,
                    apiKey: null,
                    environment: { DEXTO_API_KEY: 'dxt_env' },
                    profile: null,
                    refresh: noRefresh,
                })
            ).resolves.toMatchObject({
                kind: 'api_key',
                token: 'dxt_env',
                source: 'environment',
            });
            await expect(
                resolveCredential({
                    dir,
                    apiKey: null,
                    environment: {},
                    profile: null,
                    refresh: noRefresh,
                })
            ).resolves.toMatchObject({ kind: 'oauth', token: 'access-1', profile: 'default' });
        });

        it('is signed out without a key or a saved login', async () => {
            await expect(
                resolveCredential({
                    dir,
                    apiKey: null,
                    environment: {},
                    profile: null,
                    refresh: noRefresh,
                })
            ).resolves.toBeNull();
        });

        it('uses --profile, then DEXTO_PROFILE, then the current profile', async () => {
            await writeLogin(dir, 'work', oauthLogin({ accessToken: 'work-access' }));
            await writeLogin(dir, 'home', oauthLogin({ accessToken: 'home-access' }));
            await writeCurrentProfile(dir, 'home');

            const resolve = (profile: string | null, environment: Record<string, string>) =>
                resolveCredential({ dir, apiKey: null, environment, profile, refresh: noRefresh });

            await expect(resolve('work', { DEXTO_PROFILE: 'home' })).resolves.toMatchObject({
                token: 'work-access',
            });
            await expect(resolve(null, { DEXTO_PROFILE: 'work' })).resolves.toMatchObject({
                token: 'work-access',
            });
            await expect(resolve(null, {})).resolves.toMatchObject({ token: 'home-access' });
        });

        it('refreshes an expiring login and saves the new tokens', async () => {
            await writeLogin(dir, 'default', oauthLogin({ expiresAt: new Date().toISOString() }));

            const credential = await resolveCredential({
                dir,
                apiKey: null,
                environment: {},
                profile: null,
                refresh: async (login) => ({
                    ...login,
                    accessToken: 'access-2',
                    refreshToken: 'refresh-2',
                    expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
                }),
            });

            expect(credential).toMatchObject({ kind: 'oauth', token: 'access-2' });
            const saved = await readLogin(dir, 'default');
            expect(saved?.kind === 'oauth' && saved.refreshToken).toBe('refresh-2');
        });

        it('uses the tokens another process saved when its refresh won the race', async () => {
            await writeLogin(dir, 'default', oauthLogin({ expiresAt: new Date().toISOString() }));

            const credential = await resolveCredential({
                dir,
                apiKey: null,
                environment: {},
                profile: null,
                refresh: async () => {
                    await writeLogin(
                        dir,
                        'default',
                        oauthLogin({ accessToken: 'other-access', refreshToken: 'other-refresh' })
                    );
                    throw new Error('refresh token already used');
                },
            });

            expect(credential).toMatchObject({ token: 'other-access' });
        });
    });
});

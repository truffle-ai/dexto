import {
    chmod,
    mkdtemp,
    mkdir,
    readFile,
    rm,
    stat,
    symlink,
    utimes,
    writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    type OAuthLogin,
    carryOverCloudCliLogins,
    carryOverDexto1ApiKey,
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

    describe("carrying over dexto 1.x's saved API key", () => {
        let authFile: string;

        beforeEach(async () => {
            authFile = path.join(path.dirname(dir), 'auth.json');
            await mkdir(path.dirname(dir), { recursive: true });
        });

        it('saves it as the default profile, once, for the API it came from', async () => {
            await writeFile(
                authFile,
                JSON.stringify({
                    dextoApiKey: 'dxt_from_1x_key',
                    dextoApiKeySource: 'provisioned',
                    dextoPlatformUrl: 'https://app.dexto.ai',
                    createdAt: 1,
                })
            );

            expect(await carryOverDexto1ApiKey(dir, authFile, 'https://api.dexto.ai')).toBe(true);
            expect(await readLogin(dir, 'default')).toMatchObject({
                kind: 'api_key',
                apiKey: 'dxt_from_1x_key',
                apiBaseUrl: 'https://app.dexto.ai',
            });
            expect(await carryOverDexto1ApiKey(dir, authFile, 'https://api.dexto.ai')).toBe(false);
        });

        it('uses the public API for a key saved before origins were recorded', async () => {
            await writeFile(authFile, JSON.stringify({ dextoApiKey: 'dxt_old', createdAt: 1 }));

            await carryOverDexto1ApiKey(dir, authFile, 'https://api.dexto.ai');

            expect(await readLogin(dir, 'default')).toMatchObject({
                apiBaseUrl: 'https://api.dexto.ai',
            });
        });

        it('leaves a machine that already signed in, or had only a Supabase token', async () => {
            await writeFile(authFile, JSON.stringify({ token: 'supabase', createdAt: 1 }));
            expect(await carryOverDexto1ApiKey(dir, authFile, 'https://api.dexto.ai')).toBe(false);

            await writeFile(authFile, JSON.stringify({ dextoApiKey: 'dxt_x', createdAt: 1 }));
            await writeLogin(dir, 'work', oauthLogin());
            expect(await carryOverDexto1ApiKey(dir, authFile, 'https://api.dexto.ai')).toBe(false);
            expect(await readLogin(dir, 'default')).toBeNull();
        });

        it('never turns a saved sign-in into an API key login', async () => {
            await writeFile(authFile, JSON.stringify({ dextoApiKey: 'dxt_x', createdAt: 1 }));
            const signedIn = oauthLogin();
            await writeLogin(dir, 'default', signedIn);

            expect(await carryOverDexto1ApiKey(dir, authFile, 'https://api.dexto.ai')).toBe(false);
            expect(await readLogin(dir, 'default')).toEqual(signedIn);
        });
    });

    describe('resolveCredential', () => {
        const noRefresh = async (): Promise<OAuthLogin> => {
            throw new Error('should not refresh');
        };

        const resolve = (apiKey: string | null, environment: Record<string, string>) =>
            resolveCredential({ dir, apiKey, environment, profile: null, refresh: noRefresh });

        it('uses the sign-in when DEXTO_API_KEY is set too', async () => {
            await writeLogin(dir, 'default', oauthLogin());

            await expect(resolve(null, { DEXTO_API_KEY: 'dxt_env' })).resolves.toMatchObject({
                kind: 'oauth',
                token: 'access-1',
                source: 'sign_in',
                profile: 'default',
            });
        });

        it('lets --api-key beat the sign-in', async () => {
            await writeLogin(dir, 'default', oauthLogin());

            await expect(resolve('dxt_flag', { DEXTO_API_KEY: 'dxt_env' })).resolves.toMatchObject({
                kind: 'api_key',
                token: 'dxt_flag',
                source: 'flag',
            });
        });

        it('uses DEXTO_API_KEY without a sign-in, before a saved API key', async () => {
            await expect(resolve(null, { DEXTO_API_KEY: 'dxt_env' })).resolves.toMatchObject({
                kind: 'api_key',
                token: 'dxt_env',
                source: 'environment',
            });

            await writeLogin(dir, 'default', {
                kind: 'api_key',
                apiKey: 'dxt_saved',
                apiBaseUrl: 'https://api.dexto.ai',
                savedAt: '2026-10-31T00:00:00.000Z',
            });
            await expect(resolve(null, { DEXTO_API_KEY: 'dxt_env' })).resolves.toMatchObject({
                token: 'dxt_env',
                source: 'environment',
            });
            await expect(resolve(null, { DEXTO_API_KEY: '  ' })).resolves.toMatchObject({
                kind: 'api_key',
                token: 'dxt_saved',
                source: 'saved_key',
            });
        });

        it('refreshes an expiring sign-in even when DEXTO_API_KEY is set', async () => {
            await writeLogin(dir, 'default', oauthLogin({ expiresAt: new Date().toISOString() }));

            await expect(
                resolveCredential({
                    dir,
                    apiKey: null,
                    environment: { DEXTO_API_KEY: 'dxt_env' },
                    profile: null,
                    refresh: async (login) => ({
                        ...login,
                        accessToken: 'access-2',
                        expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
                    }),
                })
            ).resolves.toMatchObject({ kind: 'oauth', token: 'access-2', source: 'sign_in' });
            expect(await readLogin(dir, 'default')).toMatchObject({ accessToken: 'access-2' });
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

        it('refreshes once when several requests in one process find the login expiring', async () => {
            await writeLogin(dir, 'default', oauthLogin({ expiresAt: new Date().toISOString() }));
            let refreshes = 0;
            const refresh = async (login: OAuthLogin): Promise<OAuthLogin> => {
                refreshes += 1;
                await new Promise((resolve) => setTimeout(resolve, 20));
                return {
                    ...login,
                    accessToken: 'access-2',
                    refreshToken: 'refresh-2',
                    expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
                };
            };
            const resolve = () =>
                resolveCredential({ dir, apiKey: null, environment: {}, profile: null, refresh });

            const credentials = await Promise.all([resolve(), resolve(), resolve()]);

            expect(refreshes).toBe(1);
            expect(credentials.map((credential) => credential?.token)).toEqual([
                'access-2',
                'access-2',
                'access-2',
            ]);
        });

        it('waits for another process refreshing the same login and uses the tokens it saved', async () => {
            await writeLogin(dir, 'default', oauthLogin({ expiresAt: new Date().toISOString() }));
            const lock = path.join(dir, 'default.refresh.lock');
            await writeFile(lock, '');
            let refreshes = 0;

            const credential = resolveCredential({
                dir,
                apiKey: null,
                environment: {},
                profile: null,
                refresh: async (login) => {
                    refreshes += 1;
                    return login;
                },
            });
            await new Promise((resolve) => setTimeout(resolve, 150));
            await writeLogin(
                dir,
                'default',
                oauthLogin({ accessToken: 'other-access', refreshToken: 'other-refresh' })
            );
            await rm(lock);

            await expect(credential).resolves.toMatchObject({ token: 'other-access' });
            expect(refreshes).toBe(0);
        });

        it('takes over a refresh lock a crashed process left behind', async () => {
            await writeLogin(dir, 'default', oauthLogin({ expiresAt: new Date().toISOString() }));
            const lock = path.join(dir, 'default.refresh.lock');
            await writeFile(lock, '');
            const old = new Date(Date.now() - 60_000);
            await utimes(lock, old, old);

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

            expect(credential).toMatchObject({ token: 'access-2' });
            await expect(stat(lock)).rejects.toMatchObject({ code: 'ENOENT' });
        });

        it('lets two processes taking over one stale lock refresh only once', async () => {
            await writeLogin(dir, 'default', oauthLogin({ expiresAt: new Date().toISOString() }));
            const lock = path.join(dir, 'default.refresh.lock');
            await writeFile(lock, 'crashed-owner');
            const old = new Date(Date.now() - 60_000);
            await utimes(lock, old, old);
            // A second path to the same folder is a second process: it shares the lock file but
            // not this process's in-flight refresh.
            const otherDir = `${dir}-other-process`;
            await symlink(dir, otherDir);
            let refreshes = 0;
            const refresh = async (login: OAuthLogin): Promise<OAuthLogin> => {
                refreshes += 1;
                await new Promise((resolve) => setTimeout(resolve, 50));
                return {
                    ...login,
                    accessToken: 'access-2',
                    refreshToken: 'refresh-2',
                    expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
                };
            };

            try {
                const credentials = await Promise.all(
                    [dir, otherDir].map((each) =>
                        resolveCredential({
                            dir: each,
                            apiKey: null,
                            environment: {},
                            profile: null,
                            refresh,
                        })
                    )
                );

                expect(refreshes).toBe(1);
                expect(credentials.map((credential) => credential?.token)).toEqual([
                    'access-2',
                    'access-2',
                ]);
                await expect(stat(lock)).rejects.toMatchObject({ code: 'ENOENT' });
            } finally {
                await rm(otherDir, { force: true });
            }
        });

        it('leaves the lock alone when another process took it over during the refresh', async () => {
            await writeLogin(dir, 'default', oauthLogin({ expiresAt: new Date().toISOString() }));
            const lock = path.join(dir, 'default.refresh.lock');
            let finishRefresh = (_login: OAuthLogin) => {};
            const refreshing = new Promise<OAuthLogin>((resolve) => {
                finishRefresh = resolve;
            });
            let started = () => {};
            const refreshStarted = new Promise<void>((resolve) => {
                started = resolve;
            });

            const credential = resolveCredential({
                dir,
                apiKey: null,
                environment: {},
                profile: null,
                refresh: async () => {
                    started();
                    return refreshing;
                },
            });
            await refreshStarted;
            await writeFile(lock, 'new-owner');
            finishRefresh(oauthLogin({ accessToken: 'access-2', refreshToken: 'refresh-2' }));

            await expect(credential).resolves.toMatchObject({ token: 'access-2' });
            await expect(readFile(lock, 'utf8')).resolves.toBe('new-owner');
        });

        it('ends a refresh that outlives its deadline, so it never outlives the lock', async () => {
            await writeLogin(dir, 'default', oauthLogin({ expiresAt: new Date().toISOString() }));
            const lock = path.join(dir, 'default.refresh.lock');
            let refreshSignal: AbortSignal | undefined;
            let started = () => {};
            const refreshStarted = new Promise<void>((resolve) => {
                started = resolve;
            });
            vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });

            try {
                const credential = resolveCredential({
                    dir,
                    apiKey: null,
                    environment: {},
                    profile: null,
                    // Ignores its signal, as a hung request with no timeout of its own would.
                    refresh: (_login, signal) => {
                        refreshSignal = signal;
                        started();
                        return new Promise<OAuthLogin>(() => {});
                    },
                });
                const settled = credential.then(
                    () => 'resolved',
                    (error: unknown) => (error instanceof Error ? error.message : 'rejected')
                );
                await refreshStarted;
                await vi.advanceTimersByTimeAsync(10_000);

                await expect(settled).resolves.toMatch(/timed out/u);
                expect(refreshSignal?.aborted).toBe(true);
                await expect(stat(lock)).rejects.toMatchObject({ code: 'ENOENT' });
            } finally {
                vi.useRealTimers();
            }
        });
    });
});

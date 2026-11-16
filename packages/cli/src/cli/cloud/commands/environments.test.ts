import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { dextoAccounts } from '@dexto/agent-management';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resolveConnection } from '../connection.js';
import { cloudCommands, CLOUD_GROUPS } from '../host.js';
import { runCloud, type CloudHost } from '../run.js';
import type { CloudRuntime } from '../runtime.js';

const unusedSignIn = async (): Promise<never> => {
    throw new Error('unexpected sign-in');
};
describe('cloud environments', () => {
    let dir: string;
    let output: string;
    let errors: string;
    let requests: globalThis.Request[];
    let host: CloudHost;
    let environment: Record<string, string>;
    beforeEach(async () => {
        dir = path.join(await mkdtemp(path.join(os.tmpdir(), 'dexto-env-')), 'accounts');
        await dextoAccounts.writeLogin(dir, 'default', {
            kind: 'oauth',
            accessToken: 'access-1',
            refreshToken: 'refresh-1',
            expiresAt: new Date(Date.now() + 3600000).toISOString(),
            clientId: 'dexto-cli',
            appUrl: 'https://app.dexto.ai',
            apiBaseUrl: 'https://api.dexto.ai',
            resource: 'https://app.dexto.ai/mcp',
            tokenEndpoint: 'https://app.dexto.ai/api/oauth/token',
            scopes: ['cloud:read', 'cloud:write'],
            savedAt: '2026-11-01T00:00:00.000Z',
            signedInAs: null,
            cloudProject: null,
        });
        output = '';
        errors = '';
        requests = [];
        environment = {};
        const runtime: CloudRuntime = {
            color: false,
            environment,
            homeDirectory: os.tmpdir(),
            fetch: async (input, init) => {
                const request = new globalThis.Request(input, init);
                requests.push(request);
                if (request.method === 'POST')
                    return Response.json(
                        { id: 'env-1', name: 'dev', latest_build: null },
                        { status: 201 }
                    );
                return Response.json({
                    object: 'list',
                    data: [],
                    has_more: false,
                    next_after: null,
                });
            },
            prompt: null,
            readStdin: async () => '',
            runProcess: async () => ({ exitCode: 0, output: '' }),
            signal: new AbortController().signal,
            sleep: async () => undefined,
            stdoutIsTerminal: false,
            writeBytes: async () => undefined,
            writeError: (text) => {
                errors += text;
            },
            writeOutput: (text) => {
                output += text;
            },
        };
        host = {
            commands: cloudCommands(dir, unusedSignIn),
            groups: CLOUD_GROUPS,
            signIn: unusedSignIn,
            runtime,
            resolveConnection: (overrides) =>
                resolveConnection({ dir, environment, overrides, refresh: async (login) => login }),
            signInForScope: async () => false,
        };
    });
    afterEach(async () => {
        await rm(path.dirname(dir), { recursive: true, force: true });
    });
    it('lists using the person’s OAuth credential and returns JSON', async () => {
        expect(await runCloud(host, ['cloud', 'environments', 'list', '--json'])).toBe(0);
        expect(requests).toHaveLength(1);
        expect(requests[0]?.url).toBe('https://api.dexto.ai/v1/environments');
        expect(requests[0]?.headers.get('authorization')).toBe('Bearer access-1');
        expect(JSON.parse(output)).toEqual({
            object: 'list',
            data: [],
            has_more: false,
            next_after: null,
        });
    });
    it('shows a dry run without sending it', async () => {
        expect(
            await runCloud(host, [
                'cloud',
                'environments',
                'create',
                'dev',
                '--data',
                '{"repos":[]}',
                '--dry-run',
                '--json',
            ])
        ).toBe(0);
        expect(requests).toHaveLength(0);
        expect(JSON.parse(output)).toEqual({
            dry_run: true,
            request: {
                method: 'POST',
                path: '/v1/environments',
                body: { name: 'dev', spec: { repos: [] } },
            },
        });
    });
    it('sends a spec and visibility when creating', async () => {
        expect(
            await runCloud(host, [
                'cloud',
                'environments',
                'create',
                'dev',
                '--data',
                '{"repos":[]}',
                '--visibility',
                'team',
                '--json',
            ])
        ).toBe(0);
        expect(requests[0]?.method).toBe('POST');
        expect(await requests[0]?.json()).toEqual({
            name: 'dev',
            spec: { repos: [] },
            visibility: 'team',
        });
    });
    it('addresses a specific build', async () => {
        expect(
            await runCloud(host, [
                'cloud',
                'environments',
                'builds',
                'get',
                'env-1',
                'build-1',
                '--json',
            ])
        ).toBe(0);
        expect(requests[0]?.url).toBe('https://api.dexto.ai/v1/environments/env-1/builds/build-1');
    });
    it('shows encoded update and rebuild requests without sending them', async () => {
        expect(
            await runCloud(host, [
                'cloud',
                'environments',
                'update',
                'env/1',
                '--name',
                'new',
                '--dry-run',
                '--json',
            ])
        ).toBe(0);
        expect(JSON.parse(output)).toEqual({
            dry_run: true,
            request: { method: 'PATCH', path: '/v1/environments/env%2F1', body: { name: 'new' } },
        });
        output = '';
        expect(
            await runCloud(host, [
                'cloud',
                'environments',
                'rebuild',
                'env/1',
                '--dry-run',
                '--json',
            ])
        ).toBe(0);
        expect(JSON.parse(output)).toEqual({
            dry_run: true,
            request: { method: 'POST', path: '/v1/environments/env%2F1/rebuild', body: null },
        });
        expect(requests).toHaveLength(0);
    });
    it('refuses API keys before sending a request', async () => {
        environment.DEXTO_API_KEY = 'dxt_key';
        expect(await runCloud(host, ['cloud', 'environments', 'list', '--json'])).not.toBe(0);
        expect(requests).toHaveLength(0);
        expect(JSON.parse(errors).error.code).toBe('needs_sign_in');
    });
});

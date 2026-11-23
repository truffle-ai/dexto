import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { dextoAccounts } from '@dexto/agent-management';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resolveConnection } from '../connection.js';
import { cloudCommands, CLOUD_GROUPS } from '../host.js';
import { runCloud, type CloudHost } from '../run.js';
import type { CloudRuntime } from '../runtime.js';

const MCP = 'https://app.dexto.ai/mcp';
const SITE_ID = '11111111-1111-4111-8111-111111111111';
const DEPLOYMENT_ID = '22222222-2222-4222-8222-222222222222';

const SITE = {
    backendProjectId: null,
    cloudProject: { id: 'p1', name: 'Default' },
    createdAt: '2026-11-01T00:00:00.000Z',
    id: SITE_ID,
    productionUrl: 'https://launch.dexto.site',
    slug: 'launch',
    title: 'Launch',
    updatedAt: '2026-11-02T00:00:00.000Z',
    visibility: 'unlisted',
};
const DEPLOYMENT = {
    backendDeploymentId: null,
    channel: 'preview',
    createdAt: '2026-11-02T00:00:00.000Z',
    id: DEPLOYMENT_ID,
    previewUrl: 'https://preview.dexto.site/launch/2222',
    productionUrl: 'https://launch.dexto.site',
    siteId: SITE_ID,
    staticDeploymentId: 's1',
    status: 'ready',
    updatedAt: '2026-11-02T00:00:00.000Z',
};

type Refusal = { code: number; message: string; data: Record<string, unknown> };

const unusedSignIn = async (): Promise<never> => {
    throw new Error('These tests sign in with a saved login.');
};

describe('dexto cloud sites get and promote', () => {
    let dir: string;
    let stdout: string;
    let stderr: string;
    let scopes: string[];
    let refusal: Refusal | null;
    let calls: { name: string; arguments: Record<string, unknown> }[];
    let host: CloudHost;

    const answer = (name: string, args: Record<string, unknown>): unknown => {
        if (name === 'dexto_site_get') return { deployments: [DEPLOYMENT], site: SITE };
        if (name === 'dexto_site_promote')
            return {
                deployment: { ...DEPLOYMENT, id: args.deploymentId, channel: 'production' },
                site: SITE,
                status: 'promoted',
                url: SITE.productionUrl,
            };
        throw new Error(`Unexpected tool ${name}`);
    };

    beforeEach(async () => {
        dir = path.join(await mkdtemp(path.join(os.tmpdir(), 'dexto-sites-')), 'accounts');
        stdout = '';
        stderr = '';
        scopes = ['sites:read', 'sites:write'];
        refusal = null;
        calls = [];
        const environment: Record<string, string> = {};
        const runtime: CloudRuntime = {
            color: false,
            environment,
            homeDirectory: os.tmpdir(),
            fetch: async (input, init) => {
                const request = new globalThis.Request(input, init);
                if (request.url !== MCP) return Response.json({}, { status: 404 });
                const message = JSON.parse(await request.text());
                calls.push({ name: message.params.name, arguments: message.params.arguments });
                if (refusal !== null)
                    return Response.json({ jsonrpc: '2.0', id: message.id, error: refusal });
                return Response.json({
                    jsonrpc: '2.0',
                    id: message.id,
                    result: {
                        content: [{ type: 'text', text: 'ok' }],
                        structuredContent: answer(message.params.name, message.params.arguments),
                    },
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
                stderr += text;
            },
            writeOutput: (text) => {
                stdout += text;
            },
        };
        host = {
            commands: cloudCommands(dir, unusedSignIn),
            signIn: unusedSignIn,
            groups: CLOUD_GROUPS,
            runtime,
            resolveConnection: async (overrides) => {
                await dextoAccounts.writeLogin(dir, 'default', {
                    kind: 'oauth',
                    accessToken: 'access-1',
                    refreshToken: 'refresh-1',
                    expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
                    clientId: 'dexto-cli',
                    appUrl: 'https://app.dexto.ai',
                    apiBaseUrl: 'https://api.dexto.ai',
                    resource: MCP,
                    tokenEndpoint: 'https://app.dexto.ai/api/oauth/token',
                    scopes,
                    savedAt: '2026-11-01T00:00:00.000Z',
                    signedInAs: null,
                    cloudProject: null,
                });
                return await resolveConnection({
                    dir,
                    environment,
                    overrides,
                    refresh: async (login: dextoAccounts.OAuthLogin) => login,
                });
            },
            signInForScopes: async () => false,
        };
    });

    afterEach(async () => {
        await rm(path.dirname(dir), { recursive: true, force: true });
    });

    it('reads a Site and its deployments through dexto_site_get', async () => {
        expect(await runCloud(host, ['cloud', 'sites', 'get', SITE_ID, '--json'])).toBe(0);

        expect(calls).toEqual([{ name: 'dexto_site_get', arguments: { siteId: SITE_ID } }]);
        expect(JSON.parse(stdout)).toEqual({ deployments: [DEPLOYMENT], site: SITE });
    });

    it('passes --limit as the deployment limit and shows a table for people', async () => {
        expect(
            await runCloud(host, ['cloud', 'sites', 'get', SITE_ID, '--limit', '5', '--table'])
        ).toBe(0);

        expect(calls).toEqual([
            { name: 'dexto_site_get', arguments: { deploymentLimit: 5, siteId: SITE_ID } },
        ]);
        expect(stdout).toContain('launch (Launch) https://launch.dexto.site, unlisted');
        expect(stdout).toContain(DEPLOYMENT_ID);
        expect(stdout).toContain('ready');
    });

    it('asks for sites:read before reading a Site', async () => {
        scopes = ['sites:write'];

        expect(await runCloud(host, ['cloud', 'sites', 'get', SITE_ID, '--json'])).toBe(3);

        expect(calls).toEqual([]);
        expect(JSON.parse(stderr).error.fix).toContain('sites:read');
    });

    it('exits 5 for a Site the caller does not reach', async () => {
        refusal = { code: -32004, message: 'Site was not found.', data: { kind: 'not_found' } };

        expect(await runCloud(host, ['cloud', 'sites', 'get', SITE_ID, '--json'])).toBe(5);

        expect(JSON.parse(stderr).error).toMatchObject({
            code: 'not_found',
            message: 'Site was not found.',
        });
    });

    it('refuses to promote without --yes when nobody can be asked', async () => {
        expect(
            await runCloud(host, ['cloud', 'sites', 'promote', SITE_ID, DEPLOYMENT_ID, '--json'])
        ).toBe(4);

        expect(calls).toEqual([]);
        expect(JSON.parse(stderr).error.code).toBe('needs_confirmation');
    });

    it('promotes a deployment with --yes, confirming the approve-level call', async () => {
        expect(
            await runCloud(host, [
                'cloud',
                'sites',
                'promote',
                SITE_ID,
                DEPLOYMENT_ID,
                '--yes',
                '--json',
            ])
        ).toBe(0);

        expect(calls).toEqual([
            {
                name: 'dexto_site_promote',
                arguments: { confirm: true, deploymentId: DEPLOYMENT_ID, siteId: SITE_ID },
            },
        ]);
        expect(JSON.parse(stdout)).toMatchObject({
            deployment: { id: DEPLOYMENT_ID },
            status: 'promoted',
            url: SITE.productionUrl,
        });
    });

    it('says where a promoted deployment is live for people', async () => {
        expect(
            await runCloud(host, [
                'cloud',
                'sites',
                'promote',
                SITE_ID,
                DEPLOYMENT_ID,
                '--yes',
                '--table',
            ])
        ).toBe(0);

        expect(stdout).toBe(
            `Promoted deployment ${DEPLOYMENT_ID} of launch: live at https://launch.dexto.site.\n`
        );
    });

    it('asks for sites:write before promoting', async () => {
        scopes = ['sites:read'];

        expect(
            await runCloud(host, [
                'cloud',
                'sites',
                'promote',
                SITE_ID,
                DEPLOYMENT_ID,
                '--yes',
                '--json',
            ])
        ).toBe(3);

        expect(calls).toEqual([]);
        expect(JSON.parse(stderr).error.fix).toContain('sites:write');
    });

    it('exits 3 when the caller may not promote the Site', async () => {
        refusal = {
            code: -32003,
            message: 'Only its creator, an Owner or an Admin can promote it.',
            data: { kind: 'forbidden' },
        };

        expect(
            await runCloud(host, [
                'cloud',
                'sites',
                'promote',
                SITE_ID,
                DEPLOYMENT_ID,
                '--yes',
                '--json',
            ])
        ).toBe(3);

        expect(JSON.parse(stderr).error.code).toBe('needs_permission');
    });

    it('exits 5 for a deployment that is not there or not ready', async () => {
        refusal = {
            code: -32004,
            message: 'Site deployment was not found.',
            data: { kind: 'not_found' },
        };

        expect(
            await runCloud(host, [
                'cloud',
                'sites',
                'promote',
                SITE_ID,
                DEPLOYMENT_ID,
                '--yes',
                '--json',
            ])
        ).toBe(5);

        expect(JSON.parse(stderr).error.code).toBe('not_found');
    });
});

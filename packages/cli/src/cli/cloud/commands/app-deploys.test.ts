import { createHash } from 'node:crypto';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CommandFailure } from '../../failure.js';
import { MissingScopeFailure, UsageError, type CommandContext } from '../command.js';
import { appCommands } from './apps.js';

const query = vi.hoisted(() => vi.fn());
const listTools = vi.hoisted(() => vi.fn());
const send = vi.hoisted(() => vi.fn());
vi.mock('./workspace.js', async (importOriginal) => ({
    ...(await importOriginal<typeof import('./workspace.js')>()),
    listWorkspaceTools: listTools,
    queryWorkspaceTool: query,
}));
vi.mock('../transfer.js', () => ({ sendBytes: send }));

const deploy = appCommands.find((command) => command.path.join(' ') === 'apps deploy');
const verify = appCommands.find((command) => command.path.join(' ') === 'apps verify');

const PACKAGE = '{"appId":"notes","appVersion":"1.0.0"}';
const prepared = {
    headers: { 'content-type': 'application/json' },
    method: 'PUT',
    path: 'uploads/abc/deploy-request.json',
    url: 'https://dexto.example/upload/abc',
};
const deployTool = {
    _meta: { 'dexto/level': 'approve' },
    inputSchema: { properties: { appId: {}, uploadPath: {} }, type: 'object' },
    name: 'dexto_app_deploy',
    title: 'Deploy Dexto App',
};
const deployed = {
    app: { id: 'notes', title: 'Notes' },
    deployment: { appId: 'notes', appVersion: '1.0.0', id: 'dep_1' },
    diagnostics: { status: 'current' },
    matchesPackage: true,
    packagePath: prepared.path,
    status: 'deployed',
};
const verified = {
    activeAppId: 'notes',
    app: { id: 'notes', title: 'Notes' },
    diagnostics: { status: 'current' },
    matchesPackage: true,
    status: 'current',
};

async function packageFile(text = PACKAGE): Promise<string> {
    const dir = await mkdtemp(path.join(tmpdir(), 'dexto-app-deploy-'));
    const file = path.join(dir, 'deploy-request.json');
    await writeFile(file, text);
    return file;
}

function contextWith(scopes: readonly string[], json = true) {
    const output = { json, list: vi.fn(), note: vi.fn(), record: vi.fn(), result: vi.fn() };
    const context = {
        connection: async () => ({ kind: 'oauth', login: { scopes } }),
        invocation: ['dexto', 'apps', 'deploy', 'notes', 'pkg.json'],
        output,
        overrides: { profile: null },
        runtime: { environment: {}, prompt: null },
    } as unknown as CommandContext;
    return { context, output };
}

beforeEach(() => {
    query.mockReset();
    listTools.mockReset();
    send.mockReset();
    listTools.mockResolvedValue([deployTool]);
});

describe('dexto apps deploy', () => {
    it('uploads the package for app-package, then deploys that upload, with --yes', async () => {
        const file = await packageFile();
        const { context, output } = contextWith(['apps:write']);
        query.mockResolvedValueOnce(prepared).mockResolvedValueOnce(deployed);
        await deploy?.run(context, { positionals: ['notes', file], values: { yes: true } });

        expect(query).toHaveBeenNthCalledWith(1, context, 'dexto_upload_prepare', {
            filename: 'deploy-request.json',
            mimeType: 'application/json',
            purpose: 'app-package',
            sha256: createHash('sha256').update(PACKAGE).digest('hex'),
            sizeBytes: Buffer.byteLength(PACKAGE),
        });
        expect(send).toHaveBeenCalledWith(
            context,
            { headers: prepared.headers, method: 'PUT', url: prepared.url },
            expect.any(globalThis.Blob)
        );
        const blob: globalThis.Blob = send.mock.calls[0]?.[2];
        expect(await blob.text()).toBe(PACKAGE);
        expect(query).toHaveBeenNthCalledWith(2, context, 'dexto_app_deploy', {
            appId: 'notes',
            uploadPath: prepared.path,
        });
        expect(query).toHaveBeenCalledTimes(2);
        expect(output.result).toHaveBeenCalledWith(deployed, expect.stringContaining('notes'));
    });

    it('refuses without --yes when it cannot ask, before uploading anything', async () => {
        const file = await packageFile();
        const { context } = contextWith(['apps:write']);
        const refused = deploy?.run(context, { positionals: ['notes', file], values: {} });
        await expect(refused).rejects.toBeInstanceOf(CommandFailure);
        await expect(refused).rejects.toMatchObject({ kind: 'needs_confirmation' });
        await expect(refused).rejects.toThrow('--yes');
        expect(query).not.toHaveBeenCalled();
        expect(send).not.toHaveBeenCalled();
    });

    it("sends confirm: true once agreed, where the deploy tool's schema takes it", async () => {
        listTools.mockResolvedValue([
            {
                ...deployTool,
                inputSchema: {
                    properties: { appId: {}, confirm: {}, uploadPath: {} },
                    type: 'object',
                },
            },
        ]);
        const file = await packageFile();
        const { context } = contextWith(['apps:write']);
        query.mockResolvedValueOnce(prepared).mockResolvedValueOnce(deployed);
        await deploy?.run(context, { positionals: ['notes', file], values: { yes: true } });
        expect(query).toHaveBeenNthCalledWith(2, context, 'dexto_app_deploy', {
            appId: 'notes',
            confirm: true,
            uploadPath: prepared.path,
        });
    });

    it('asks for apps:write before reading or uploading', async () => {
        const { context } = contextWith(['apps:read']);
        await expect(
            deploy?.run(context, { positionals: ['notes', 'missing.json'], values: { yes: true } })
        ).rejects.toMatchObject({ scopes: ['apps:write'] });
        await expect(
            deploy?.run(context, { positionals: ['notes', 'missing.json'], values: { yes: true } })
        ).rejects.toBeInstanceOf(MissingScopeFailure);
        expect(query).not.toHaveBeenCalled();
    });

    it("passes the deploy tool's refusal through as the failure", async () => {
        const file = await packageFile();
        const { context } = contextWith(['apps:write']);
        const failure = new CommandFailure('failed', 'Dexto App package is invalid.', null);
        query.mockResolvedValueOnce(prepared).mockRejectedValueOnce(failure);
        await expect(
            deploy?.run(context, { positionals: ['notes', file], values: { yes: true } })
        ).rejects.toBe(failure);
    });

    it('fails when Dexto does not say where to upload', async () => {
        const file = await packageFile();
        const { context } = contextWith(['apps:write']);
        query.mockResolvedValueOnce({});
        await expect(
            deploy?.run(context, { positionals: ['notes', file], values: { yes: true } })
        ).rejects.toThrow("Dexto didn't say where to upload the package.");
        expect(send).not.toHaveBeenCalled();
    });
});

describe('dexto apps verify', () => {
    it('uploads the package and checks it without deploying or asking', async () => {
        const file = await packageFile();
        const { context, output } = contextWith(['apps:read']);
        query.mockResolvedValueOnce(prepared).mockResolvedValueOnce(verified);
        await verify?.run(context, { positionals: ['notes', file], values: {} });

        expect(query).toHaveBeenNthCalledWith(
            1,
            context,
            'dexto_upload_prepare',
            expect.objectContaining({ purpose: 'app-package' })
        );
        expect(query).toHaveBeenNthCalledWith(2, context, 'dexto_app_deployment_verify', {
            appId: 'notes',
            uploadPath: prepared.path,
        });
        expect(query.mock.calls.map((call) => call[1])).not.toContain('dexto_app_deploy');
        expect(listTools).not.toHaveBeenCalled();
        expect(output.result).toHaveBeenCalledWith(verified, expect.stringContaining('matches'));
    });

    it('says when the installed App does not match the package', async () => {
        const file = await packageFile();
        const { context, output } = contextWith(['apps:read'], false);
        const stale = { ...verified, matchesPackage: false, status: 'stale' };
        query.mockResolvedValueOnce(prepared).mockResolvedValueOnce(stale);
        await verify?.run(context, { positionals: ['notes', file], values: {} });
        expect(output.result).toHaveBeenCalledWith(
            stale,
            expect.stringContaining('does not match')
        );
    });

    it('asks for apps:read before any call', async () => {
        const { context } = contextWith([]);
        await expect(
            verify?.run(context, { positionals: ['notes', 'missing.json'], values: {} })
        ).rejects.toMatchObject({ scopes: ['apps:read'] });
        expect(query).not.toHaveBeenCalled();
    });

    it('needs a package file', async () => {
        const { context } = contextWith(['apps:read']);
        await expect(verify?.run(context, { positionals: ['notes'], values: {} })).rejects.toThrow(
            'package'
        );
        const dir = await mkdtemp(path.join(tmpdir(), 'dexto-app-deploy-'));
        await expect(
            verify?.run(context, { positionals: ['notes', dir], values: {} })
        ).rejects.toBeInstanceOf(UsageError);
        expect(query).not.toHaveBeenCalled();
    });

    it("passes verify's not-installed refusal through", async () => {
        const file = await packageFile();
        const { context } = contextWith(['apps:read']);
        const failure = new CommandFailure(
            'not_found',
            'Dexto App notes is not installed in this organization.',
            null
        );
        query.mockResolvedValueOnce(prepared).mockRejectedValueOnce(failure);
        await expect(
            verify?.run(context, { positionals: ['notes', file], values: {} })
        ).rejects.toBe(failure);
    });
});

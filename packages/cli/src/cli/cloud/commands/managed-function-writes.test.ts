import { createHash } from 'node:crypto';
import { mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CommandFailure } from '../../failure.js';
import type { CommandContext } from '../command.js';
import { managedFunctionCommands } from './managed-function-writes.js';

const query = vi.hoisted(() => vi.fn());
const listTools = vi.hoisted(() => vi.fn());
const send = vi.hoisted(() => vi.fn());
vi.mock('./workspace.js', async (importOriginal) => ({
    ...(await importOriginal<typeof import('./workspace.js')>()),
    queryWorkspaceTool: query,
    listWorkspaceTools: listTools,
}));
vi.mock('../transfer.js', () => ({ sendBytes: send }));

beforeEach(() => {
    query.mockReset();
    listTools.mockReset();
    send.mockReset();
});

describe('workspace functions plan', () => {
    it('forwards the provider and prints the complete result', async () => {
        const output = { record: vi.fn() };
        const context = {
            connection: async () => ({ kind: 'oauth', login: { scopes: ['functions:read'] } }),
            output,
        } as unknown as CommandContext;
        const result = { default: 'cloudflare-workers', providers: ['cloudflare-workers'] };
        query.mockResolvedValueOnce(result);
        const command = managedFunctionCommands.find(
            (c) => c.path.join(' ') === 'workspace functions plan'
        );
        expect(command).toBeDefined();
        await command?.run(context, {
            positionals: [],
            values: { provider: 'cloudflare-workers' },
        });
        expect(query).toHaveBeenCalledWith(context, 'dexto_function_plan', {
            provider: 'cloudflare-workers',
        });
        expect(output.record).toHaveBeenCalledWith(result);
    });
});

describe('workspace functions deploy', () => {
    it('uploads the package after approval and deploys it with the chosen access', async () => {
        const file = path.join(
            await mkdtemp(path.join(os.tmpdir(), 'function-package-')),
            'deploy.json'
        );
        await writeFile(file, '{"slug":"demo"}');
        const output = { record: vi.fn() };
        const context = {
            connection: async () => ({ kind: 'oauth', login: { scopes: ['functions:write'] } }),
            output,
            invocation: ['dexto', 'workspace', 'functions', 'deploy'],
            runtime: { prompt: null },
        } as unknown as CommandContext;
        listTools.mockResolvedValueOnce([
            {
                name: 'dexto_function_deploy',
                _meta: { 'dexto/level': 'approve' },
                inputSchema: { properties: { confirm: {} } },
            },
        ]);
        query
            .mockResolvedValueOnce({
                path: 'uploads/pkg',
                method: 'PUT',
                url: 'https://dexto.example/upload',
                headers: {},
            })
            .mockResolvedValueOnce({ status: 'deployed' });
        const command = managedFunctionCommands.find(
            (c) => c.path.join(' ') === 'workspace functions deploy'
        );
        expect(command).toBeDefined();
        await command?.run(context, {
            positionals: [file],
            values: { access: 'public', yes: true },
        });
        expect(query).toHaveBeenNthCalledWith(1, context, 'dexto_upload_prepare', {
            filename: 'deploy-request.json',
            mimeType: 'application/json',
            purpose: 'function-package',
            sha256: createHash('sha256').update('{"slug":"demo"}').digest('hex'),
            sizeBytes: 15,
        });
        expect(send).toHaveBeenCalledOnce();
        expect(query).toHaveBeenNthCalledWith(2, context, 'dexto_function_deploy', {
            uploadPath: 'uploads/pkg',
            access: 'public',
            confirm: true,
        });
        expect(output.record).toHaveBeenCalledWith({ status: 'deployed' });
    });

    it('does not upload when approval is missing in a noninteractive session', async () => {
        const file = path.join(
            await mkdtemp(path.join(os.tmpdir(), 'function-package-')),
            'deploy.json'
        );
        await writeFile(file, '{}');
        const context = {
            connection: async () => ({ kind: 'oauth', login: { scopes: ['functions:write'] } }),
            invocation: ['dexto', 'workspace', 'functions', 'deploy'],
            runtime: { prompt: null },
        } as unknown as CommandContext;
        listTools.mockResolvedValueOnce([
            {
                name: 'dexto_function_deploy',
                _meta: { 'dexto/level': 'approve' },
                inputSchema: { properties: {} },
            },
        ]);
        const command = managedFunctionCommands.find(
            (c) => c.path.join(' ') === 'workspace functions deploy'
        );
        await expect(
            command?.run(context, { positionals: [file], values: {} })
        ).rejects.toMatchObject({ kind: 'needs_confirmation' });
        expect(query).not.toHaveBeenCalled();
        expect(send).not.toHaveBeenCalled();
    });
});

describe('workspace functions credential configure', () => {
    it('returns the secure URL for a declared secret without taking its value', async () => {
        const output = { record: vi.fn() };
        const context = {
            connection: async () => ({ kind: 'oauth', login: { scopes: ['functions:write'] } }),
            output,
            invocation: ['dexto', 'workspace', 'functions', 'credential', 'configure'],
            runtime: { prompt: null },
        } as unknown as CommandContext;
        listTools.mockResolvedValueOnce([
            {
                name: 'dexto_function_credential_configure',
                _meta: { 'dexto/level': 'approve' },
                inputSchema: { properties: { confirm: {} } },
            },
        ]);
        const result = { status: 'needs_input', url: 'https://app.dexto.ai/secure' };
        query.mockResolvedValueOnce(result);
        const command = managedFunctionCommands.find(
            (c) => c.path.join(' ') === 'workspace functions credential configure'
        );
        expect(command).toBeDefined();
        await command?.run(context, {
            positionals: ['project', 'deployment'],
            values: { kind: 'declared-secret', name: 'API_KEY', yes: true },
        });
        expect(query).toHaveBeenCalledWith(context, 'dexto_function_credential_configure', {
            projectId: 'project',
            deploymentId: 'deployment',
            credential: { kind: 'declared-secret', name: 'API_KEY' },
            confirm: true,
        });
        expect(output.record).toHaveBeenCalledWith(result);
    });
});

it('promotes the requested deployment only after approval', async () => {
    const output = { record: vi.fn() };
    const context = {
        connection: async () => ({ kind: 'oauth', login: { scopes: ['functions:write'] } }),
        output,
        invocation: ['dexto'],
        runtime: { prompt: null },
    } as unknown as CommandContext;
    listTools.mockResolvedValueOnce([
        {
            name: 'dexto_function_promote',
            _meta: { 'dexto/level': 'approve' },
            inputSchema: { properties: { confirm: {} } },
        },
    ]);
    query.mockResolvedValueOnce({ promoted: true });
    const command = managedFunctionCommands.find(
        (c) => c.path.join(' ') === 'workspace functions promote'
    );
    expect(command).toBeDefined();
    await command?.run(context, { positionals: ['project', 'deployment'], values: { yes: true } });
    expect(query).toHaveBeenCalledWith(context, 'dexto_function_promote', {
        projectId: 'project',
        deploymentId: 'deployment',
        confirm: true,
    });
    expect(output.record).toHaveBeenCalledWith({ promoted: true });
});

it('requires confirmation to delete a configured secret and forwards the name', async () => {
    const output = { record: vi.fn() };
    const context = {
        connection: async () => ({ kind: 'oauth', login: { scopes: ['functions:write'] } }),
        output,
        invocation: ['dexto'],
        runtime: { prompt: null },
    } as unknown as CommandContext;
    listTools.mockResolvedValue([
        {
            name: 'dexto_function_secret_delete',
            _meta: { 'dexto/level': 'act' },
            inputSchema: { properties: {} },
        },
    ]);
    const command = managedFunctionCommands.find(
        (c) => c.path.join(' ') === 'workspace functions secret delete'
    );
    expect(command).toBeDefined();
    await expect(
        command?.run(context, { positionals: ['project', 'API_KEY'], values: {} })
    ).rejects.toMatchObject({ kind: 'needs_confirmation' });
    expect(query).not.toHaveBeenCalled();
    query.mockResolvedValueOnce({ status: 'deleted' });
    await command?.run(context, { positionals: ['project', 'API_KEY'], values: { yes: true } });
    expect(query).toHaveBeenCalledWith(context, 'dexto_function_secret_delete', {
        projectId: 'project',
        name: 'API_KEY',
    });
    expect(output.record).toHaveBeenCalledWith({ status: 'deleted' });
});

it('checks the write scope before reading or uploading a package', async () => {
    const context = {
        connection: async () => ({ kind: 'oauth', login: { scopes: ['functions:read'] } }),
        overrides: { profile: null },
        runtime: { environment: {} },
    } as unknown as CommandContext;
    const command = managedFunctionCommands.find(
        (c) => c.path.join(' ') === 'workspace functions deploy'
    );
    await expect(
        command?.run(context, { positionals: ['missing.json'], values: { yes: true } })
    ).rejects.toMatchObject({ scopes: ['functions:write'] });
    expect(query).not.toHaveBeenCalled();
    expect(listTools).not.toHaveBeenCalled();
});

it('passes a server refusal through without replacing it', async () => {
    const context = {
        connection: async () => ({ kind: 'oauth', login: { scopes: ['functions:read'] } }),
        output: { record: vi.fn() },
    } as unknown as CommandContext;
    const refusal = new CommandFailure('not_found', 'Function not found.', null);
    query.mockRejectedValueOnce(refusal);
    const command = managedFunctionCommands.find(
        (c) => c.path.join(' ') === 'workspace functions plan'
    );
    await expect(command?.run(context, { positionals: [], values: {} })).rejects.toBe(refusal);
});

it('shows a dry run without signing in or sending a write', async () => {
    const output = { record: vi.fn() };
    const context = { output } as unknown as CommandContext;
    const command = managedFunctionCommands.find(
        (c) => c.path.join(' ') === 'workspace functions promote'
    );
    await command?.run(context, {
        positionals: ['project', 'deployment'],
        values: { 'dry-run': true },
    });
    expect(output.record).toHaveBeenCalledWith({
        dryRun: true,
        tool: 'dexto_function_promote',
        arguments: { projectId: 'project', deploymentId: 'deployment' },
    });
    expect(query).not.toHaveBeenCalled();
});

it('configures a Dexto API key without a secret name', async () => {
    const context = {
        connection: async () => ({ kind: 'oauth', login: { scopes: ['functions:write'] } }),
        output: { record: vi.fn() },
        invocation: ['dexto'],
        runtime: { prompt: null },
    } as unknown as CommandContext;
    listTools.mockResolvedValueOnce([
        {
            name: 'dexto_function_credential_configure',
            _meta: { 'dexto/level': 'approve' },
            inputSchema: { properties: { confirm: {} } },
        },
    ]);
    query.mockResolvedValueOnce({ status: 'configured' });
    const command = managedFunctionCommands.find(
        (c) => c.path.join(' ') === 'workspace functions credential configure'
    );
    await command?.run(context, {
        positionals: ['project', 'deployment'],
        values: { kind: 'dexto-api-key', yes: true },
    });
    expect(query).toHaveBeenCalledWith(context, 'dexto_function_credential_configure', {
        projectId: 'project',
        deploymentId: 'deployment',
        credential: { kind: 'dexto-api-key' },
        confirm: true,
    });
});

it('rejects credential options that would not match the tool contract', async () => {
    const context = {} as CommandContext;
    const command = managedFunctionCommands.find(
        (c) => c.path.join(' ') === 'workspace functions credential configure'
    );
    await expect(
        command?.run(context, {
            positionals: ['project', 'deployment'],
            values: { kind: 'declared-secret' },
        })
    ).rejects.toThrow('--name');
    await expect(
        command?.run(context, {
            positionals: ['project', 'deployment'],
            values: { kind: 'dexto-api-key', name: 'API_KEY' },
        })
    ).rejects.toThrow('--name');
    expect(query).not.toHaveBeenCalled();
});

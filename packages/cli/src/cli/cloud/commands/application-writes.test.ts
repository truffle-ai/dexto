import { createHash } from 'node:crypto';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CommandFailure } from '../../failure.js';
import { MissingScopeFailure, UsageError, type Command, type CommandContext } from '../command.js';
import { applicationCommands } from './applications.js';
import { WorkspaceToolFailure } from './workspace.js';

const query = vi.hoisted(() => vi.fn());
const send = vi.hoisted(() => vi.fn());
vi.mock('./workspace.js', async (importOriginal) => ({
    ...(await importOriginal<typeof import('./workspace.js')>()),
    queryWorkspaceTool: query,
}));
vi.mock('../transfer.js', () => ({ sendBytes: send }));

const applicationId = '6f1f3c55-1e7a-4b8e-9d2b-3a1f5a6c7d80';
const deploymentId = '0b0e6a52-2c55-4c1d-8a43-2f3f7a9e1c11';
const operationId = '9a1b2c3d-4e5f-4a6b-8c7d-0e1f2a3b4c5d';
const connectionId = `app-${applicationId}`;
const DRY_RUN_TEXT =
    "Nothing was sent, so Dexto checked nothing: not your access, the Application's owner or whether its ids exist.";
const PACKAGE = '{"schemaVersion":1,"slug":"orders"}';
const prepared = {
    headers: { 'content-type': 'application/json' },
    method: 'PUT',
    path: 'uploads/abc/deploy-request.json',
    url: 'https://dexto.example/upload/abc',
};

function command(name: string): Command {
    const found = applicationCommands.find((each) => each.path.join(' ') === name);
    if (found === undefined) throw new Error(`No command ${name}`);
    return found;
}

function contextWith(scopes: readonly string[], prompt: (() => Promise<string>) | null = null) {
    const output = { json: true, list: vi.fn(), note: vi.fn(), record: vi.fn(), result: vi.fn() };
    const context = {
        connection: async () => ({ kind: 'oauth', login: { scopes } }),
        invocation: ['dexto', 'applications'],
        output,
        overrides: { cloudProject: null, profile: null },
        runtime: { environment: {}, prompt },
    } as unknown as CommandContext;
    return { context, output };
}

async function packageFile(text = PACKAGE): Promise<string> {
    const dir = await mkdtemp(path.join(tmpdir(), 'dexto-application-deploy-'));
    const file = path.join(dir, 'deploy-request.json');
    await writeFile(file, text);
    return file;
}

beforeEach(() => {
    query.mockReset();
    send.mockReset();
});

// Each write's command line and the exact tool input it forwards.
const WRITES: ReadonlyArray<{
    readonly args: Record<string, unknown>;
    readonly name: string;
    readonly positionals: string[];
    readonly tool: string;
    readonly values: Record<string, string>;
}> = [
    {
        name: 'applications create',
        positionals: ['orders', 'Orders'],
        values: { 'application-id': applicationId },
        tool: 'dexto_application_create',
        args: { applicationId, slug: 'orders', title: 'Orders' },
    },
    {
        name: 'applications rollback',
        positionals: [applicationId, operationId],
        values: { 'deployment-id': deploymentId },
        tool: 'dexto_application_rollback',
        args: { applicationId, deploymentId, rollbackFromId: operationId },
    },
    {
        name: 'applications release delete',
        positionals: [deploymentId],
        values: {},
        tool: 'dexto_application_release_delete',
        args: { deploymentId },
    },
    ...(['suspend', 'resume', 'retire'] as const).map((action) => ({
        name: `applications ${action}`,
        positionals: [applicationId],
        values: { 'operation-id': operationId },
        tool: `dexto_application_${action}`,
        args: { applicationId, operationId },
    })),
    {
        name: 'applications purge',
        positionals: [applicationId],
        values: { 'confirm-application-id': applicationId, 'operation-id': operationId },
        tool: 'dexto_application_purge',
        args: { applicationId, confirmApplicationId: applicationId, operationId },
    },
    {
        name: 'applications install',
        positionals: [applicationId],
        values: {},
        tool: 'dexto_application_install',
        args: { applicationId },
    },
];

describe('dexto applications writes', () => {
    it.each(WRITES)('$name forwards its inputs and the tool result, with --yes', async (write) => {
        const { context, output } = contextWith(['applications:write']);
        const result = { id: 'result', status: 'pending' };
        query.mockResolvedValueOnce(result);
        await command(write.name).run(context, {
            positionals: write.positionals,
            values: { ...write.values, yes: true },
        });
        expect(query).toHaveBeenCalledTimes(1);
        expect(query).toHaveBeenCalledWith(context, write.tool, { ...write.args, confirm: true });
        expect(output.record).toHaveBeenCalledWith(result);
    });

    it.each(WRITES)(
        '$name refuses without --yes when no one is at the terminal, sending nothing',
        async (write) => {
            const { context } = contextWith(['applications:write']);
            const run = command(write.name).run(context, {
                positionals: write.positionals,
                values: write.values,
            });
            await expect(run).rejects.toMatchObject({
                kind: 'needs_confirmation',
                message: expect.stringContaining('--yes'),
            });
            await expect(run).rejects.toBeInstanceOf(CommandFailure);
            expect(query).not.toHaveBeenCalled();
        }
    );

    it.each(WRITES)('$name needs applications:write before asking', async (write) => {
        const { context } = contextWith(['applications:read']);
        await expect(
            command(write.name).run(context, {
                positionals: write.positionals,
                values: { ...write.values, yes: true },
            })
        ).rejects.toBeInstanceOf(MissingScopeFailure);
        expect(query).not.toHaveBeenCalled();
    });

    it.each(WRITES)('$name --dry-run shows the call and sends nothing', async (write) => {
        const { context, output } = contextWith([]);
        await command(write.name).run(context, {
            positionals: write.positionals,
            values: { ...write.values, 'dry-run': true },
        });
        expect(output.result).toHaveBeenCalledWith(
            { arguments: write.args, checkedByDexto: false, dryRun: true, tool: write.tool },
            `Would call ${write.tool}. ${DRY_RUN_TEXT}`
        );
        expect(query).not.toHaveBeenCalled();
    });

    it('asks at a terminal, and a no sends nothing', async () => {
        const prompt = vi.fn(async () => 'n');
        const { context } = contextWith(['applications:write'], prompt);
        await expect(
            command('applications retire').run(context, {
                positionals: [applicationId],
                values: {},
            })
        ).rejects.toMatchObject({ kind: 'needs_confirmation' });
        expect(prompt).toHaveBeenCalledWith(
            expect.stringContaining(`Permanently remove Application ${applicationId}'s compute?`),
            expect.anything()
        );
        expect(query).not.toHaveBeenCalled();
    });

    it('makes a new operation id when none is given and prints it before the call', async () => {
        const { context, output } = contextWith(['applications:write']);
        query.mockResolvedValueOnce({ status: 'pending' });
        await command('applications suspend').run(context, {
            positionals: [applicationId],
            values: { yes: true },
        });
        const made = query.mock.calls[0]?.[2]?.operationId;
        expect(made).toMatch(/^[0-9a-f-]{36}$/);
        expect(output.note.mock.calls).toEqual([[`New operation id: ${made}.`]]);
    });

    it.each([
        ['a refusal the CLI reports', new CommandFailure('failed', 'Slug taken.', null)],
        [
            'a refusal that is not retryable',
            new WorkspaceToolFailure(
                new CommandFailure('not_available', 'Applications are in early access.', null),
                { retryable: false, resume: null }
            ),
        ],
    ])('prints no retry hint after %s', async (_label, refusal) => {
        const { context, output } = contextWith(['applications:write']);
        query.mockRejectedValueOnce(refusal);
        await expect(
            command('applications create').run(context, {
                positionals: ['orders', 'Orders'],
                values: { 'application-id': applicationId, yes: true },
            })
        ).rejects.toBe(refusal);
        expect(output.note.mock.calls).toEqual([[`New application id: ${applicationId}.`]]);
    });

    it.each([
        ['a lost response', new TypeError('fetch failed')],
        [
            'a refusal the server says a retry can get past',
            new WorkspaceToolFailure(new CommandFailure('failed', 'Try again.', null), {
                retryable: true,
                resume: null,
            }),
        ],
    ])('prints how to retry with the same id after %s', async (_label, failure) => {
        const { context, output } = contextWith(['applications:write']);
        query.mockRejectedValueOnce(failure);
        await expect(
            command('applications create').run(context, {
                positionals: ['orders', 'Orders'],
                values: { 'application-id': applicationId, yes: true },
            })
        ).rejects.toBe(failure);
        expect(output.note.mock.calls).toEqual([
            [`New application id: ${applicationId}.`],
            [`To retry: --application-id ${applicationId}`],
        ]);
    });

    it.each([
        ['applications get', ['not-a-uuid'], {}, 'application_id'],
        ['applications release delete', ['42'], { yes: true }, 'deployment_id'],
        ['applications rollback', [applicationId, 'latest'], { yes: true }, 'release_id'],
        [
            'applications create',
            ['orders', 'Orders'],
            { 'application-id': 'x' },
            '--application-id',
        ],
        [
            'applications purge',
            [applicationId],
            { 'confirm-application-id': 'yes', 'dry-run': true },
            '--confirm-application-id',
        ],
    ])(
        '%s checks %j is a UUID before sending anything, even with --dry-run',
        async (name, positionals, values, label) => {
            const { context, output } = contextWith(['applications:read', 'applications:write']);
            await expect(
                command(name).run(context, { positionals, values: { ...values, 'dry-run': true } })
            ).rejects.toMatchObject({
                kind: 'invalid_input',
                message: expect.stringContaining(`${label} must be a UUID`),
            });
            expect(output.result).not.toHaveBeenCalled();
            expect(query).not.toHaveBeenCalled();
        }
    );

    it('purge requires --confirm-application-id', async () => {
        const { context } = contextWith(['applications:write']);
        await expect(
            command('applications purge').run(context, {
                positionals: [applicationId],
                values: { yes: true },
            })
        ).rejects.toThrow(new UsageError('--confirm-application-id is required.'));
        expect(query).not.toHaveBeenCalled();
    });

    it("passes the server's refusal through", async () => {
        const { context } = contextWith(['applications:write']);
        const refusal = new CommandFailure('failed', 'Retire the application first.', null);
        query.mockRejectedValueOnce(refusal);
        await expect(
            command('applications purge').run(context, {
                positionals: [applicationId],
                values: { 'confirm-application-id': applicationId, yes: true },
            })
        ).rejects.toBe(refusal);
    });
});

describe('dexto applications deploy', () => {
    it('uploads the package for application-package once agreed, then deploys that upload', async () => {
        const file = await packageFile();
        const { context, output } = contextWith(['applications:write']);
        const release = { id: deploymentId, status: 'building' };
        query.mockResolvedValueOnce(prepared).mockResolvedValueOnce(release);
        await deploy().run(context, {
            positionals: [connectionId, file],
            values: { 'deployment-id': deploymentId, yes: true },
        });
        expect(query).toHaveBeenNthCalledWith(1, context, 'dexto_upload_prepare', {
            filename: 'deploy-request.json',
            mimeType: 'application/json',
            purpose: 'application-package',
            sha256: createHash('sha256').update(PACKAGE).digest('hex'),
            sizeBytes: Buffer.byteLength(PACKAGE),
        });
        expect(send).toHaveBeenCalledWith(
            context,
            { headers: prepared.headers, method: 'PUT', url: prepared.url },
            expect.any(globalThis.Blob)
        );
        expect(query).toHaveBeenNthCalledWith(2, context, 'dexto_application_deploy', {
            confirm: true,
            connectionId,
            deploymentId,
            uploadPath: prepared.path,
        });
        expect(output.note).toHaveBeenCalledWith(
            `New deployment id: ${deploymentId}. Follow it: dexto applications release ${deploymentId}`
        );
        expect(output.record).toHaveBeenCalledWith(release);
    });

    it('uploads nothing without --yes', async () => {
        const file = await packageFile();
        const { context } = contextWith(['applications:write']);
        await expect(
            deploy().run(context, { positionals: [connectionId, file], values: {} })
        ).rejects.toMatchObject({ kind: 'needs_confirmation' });
        expect(query).not.toHaveBeenCalled();
        expect(send).not.toHaveBeenCalled();
    });

    it('--dry-run checks the file and uploads nothing', async () => {
        const file = await packageFile();
        const { context, output } = contextWith([]);
        await deploy().run(context, {
            positionals: [connectionId, file],
            values: { 'deployment-id': deploymentId, 'dry-run': true },
        });
        expect(output.result).toHaveBeenCalledWith(
            {
                arguments: { connectionId, deploymentId },
                checkedByDexto: false,
                dryRun: true,
                tool: 'dexto_application_deploy',
            },
            `Would call dexto_application_deploy. ${DRY_RUN_TEXT}`
        );
        expect(query).not.toHaveBeenCalled();
        expect(send).not.toHaveBeenCalled();
    });

    // The server matches app-<uuid> case-insensitively, prefix included.
    it.each([`APP-${applicationId}`, `App-${applicationId}`, `app-${applicationId.toUpperCase()}`])(
        'takes the connection id %s in any case, as the server does',
        async (given) => {
            const file = await packageFile();
            const { context, output } = contextWith([]);
            await deploy().run(context, {
                positionals: [given, file],
                values: { 'deployment-id': deploymentId, 'dry-run': true },
            });
            expect(output.result).toHaveBeenCalledWith(
                expect.objectContaining({ arguments: { connectionId: given, deploymentId } }),
                expect.any(String)
            );
        }
    );

    it.each([
        [applicationId, `If ${applicationId} is the Application's id, pass app-${applicationId}.`],
        [
            'orders',
            'connection_id must be app-<application id>, the connectionId applications get shows',
        ],
    ])('checks the connection id %s locally and says what it expects', async (given, says) => {
        const file = await packageFile();
        const { context } = contextWith(['applications:write']);
        await expect(
            deploy().run(context, { positionals: [given, file], values: { 'dry-run': true } })
        ).rejects.toMatchObject({ kind: 'invalid_input', message: expect.stringContaining(says) });
        expect(query).not.toHaveBeenCalled();
        expect(send).not.toHaveBeenCalled();
    });

    it('refuses a package over 5 MiB before asking', async () => {
        const file = await packageFile('x'.repeat(5 * 1024 * 1024 + 1));
        const { context } = contextWith(['applications:write']);
        await expect(
            deploy().run(context, { positionals: [connectionId, file], values: { yes: true } })
        ).rejects.toThrow(/an Application package can be up to 5/);
        expect(query).not.toHaveBeenCalled();
    });
});

function deploy(): Command {
    return command('applications deploy');
}

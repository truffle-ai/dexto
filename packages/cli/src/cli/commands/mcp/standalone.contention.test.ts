import { mkdtemp, readFile, rm, writeFile, unlink, open } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { runStandaloneMcp } from './standalone.js';

vi.mock('node:fs/promises', async (importOriginal) => {
    const original = await importOriginal<typeof import('node:fs/promises')>();
    return {
        ...original,
        unlink: vi.fn(original.unlink),
        open: vi.fn(original.open),
        writeFile: vi.fn(original.writeFile),
    };
});
const directories: string[] = [];
afterEach(async () => {
    vi.restoreAllMocks();
    vi.mocked(unlink).mockImplementation(
        (await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises')).unlink
    );
    vi.mocked(writeFile).mockImplementation(
        (await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises')).writeFile
    );
    await Promise.all(
        directories.splice(0).map((path) => rm(path, { recursive: true, force: true }))
    );
});

async function configFile(content: string): Promise<string> {
    const directory = await mkdtemp(join(tmpdir(), 'dexto-mcp-lock-'));
    directories.push(directory);
    const config = join(directory, 'mcp.yml');
    await writeFile(config, content);
    return config;
}
const serverConfig = JSON.stringify({ type: 'stdio', command: 'never-execute' });

it('reports a failed lock release honestly after its YAML edit already committed', async () => {
    const config = await configFile('mcpServers: {}\n');
    vi.mocked(unlink).mockRejectedValueOnce(new Error('sentinel-private-cleanup-error'));
    const result = await runStandaloneMcp(
        { command: 'add', server: 'local', serverConfig },
        { config }
    );
    expect(result).toEqual({
        exitCode: 2,
        output: {
            error: {
                code: 'config_lock_cleanup_failed',
                message:
                    'MCP configuration edit cleanup failed. The edit may already have committed; inspect the configuration before retrying or removing its lock.',
            },
        },
    });
    expect(await readFile(config, 'utf8')).toContain('local:');
    expect(await readFile(`${config}.lock`, 'utf8')).toBe('');
    expect(
        await runStandaloneMcp({ command: 'remove', server: 'local' }, { config })
    ).toMatchObject({ exitCode: 2, output: { error: { code: 'config_busy' } } });
    await unlink(`${config}.lock`);
    expect(
        await runStandaloneMcp({ command: 'remove', server: 'local' }, { config })
    ).toMatchObject({ exitCode: 0 });
});

it.each(['invalid', 'duplicate', 'missing-server', 'malformed'] as const)(
    'releases ownership after a rejected %s edit so another edit can proceed',
    async (failure) => {
        const config = await configFile(
            failure === 'malformed'
                ? 'mcpServers: ['
                : 'mcpServers:\n  local:\n    type: stdio\n    command: never-execute\n'
        );
        const before = await readFile(config, 'utf8');
        const result = await runStandaloneMcp(
            failure === 'missing-server'
                ? { command: 'remove', server: 'absent' }
                : {
                      command: 'add',
                      server: 'local',
                      serverConfig: failure === 'invalid' ? '{' : serverConfig,
                  },
            { config }
        );
        const code =
            failure === 'invalid'
                ? 'invalid_server_config'
                : failure === 'duplicate'
                  ? 'duplicate_server'
                  : failure === 'missing-server'
                    ? 'server_not_found'
                    : 'invalid_config';
        expect(result).toMatchObject({ exitCode: 2, output: { error: { code } } });
        expect(await readFile(config, 'utf8')).toBe(before);
        await expect(readFile(`${config}.lock`)).rejects.toMatchObject({ code: 'ENOENT' });
        if (failure === 'malformed') await writeFile(config, 'mcpServers: {}\n');
        expect(
            await runStandaloneMcp({ command: 'add', server: 'another', serverConfig }, { config })
        ).toMatchObject({ exitCode: 0 });
    }
);

it.each(['file', 'parent'] as const)(
    'preserves remove missing-%s read failures',
    async (missing) => {
        const present = await configFile('mcpServers: {}\n');
        const config = missing === 'file' ? present : join(dirname(present), 'absent', 'mcp.yml');
        if (missing === 'file') await unlink(present);
        expect(
            await runStandaloneMcp({ command: 'remove', server: 'local' }, { config })
        ).toMatchObject({ exitCode: 2, output: { error: { code: 'config_read_failed' } } });
        await expect(readFile(`${config}.lock`)).rejects.toMatchObject({ code: 'ENOENT' });
    }
);

it('preserves an already-failed operation when its lock release also fails', async () => {
    const config = await configFile('mcpServers: {}\n');
    vi.mocked(unlink).mockRejectedValueOnce(new Error('sentinel-private-cleanup-error'));
    const result = await runStandaloneMcp(
        { command: 'add', server: 'local', serverConfig: '{' },
        { config }
    );
    expect(result).toMatchObject({
        exitCode: 2,
        output: { error: { code: 'invalid_server_config' } },
    });
    expect(JSON.stringify(result)).not.toContain('sentinel');
    expect(await readFile(`${config}.lock`, 'utf8')).toBe('');
    expect(await readFile(config, 'utf8')).toBe('mcpServers: {}\n');
});

it('releases creation and replacement ownership and preserves add semantics', async () => {
    const present = await configFile('mcpServers: {}\n');
    const config = join(dirname(present), 'new', 'mcp.yml');
    expect(
        await runStandaloneMcp({ command: 'add', server: 'local', serverConfig }, { config })
    ).toMatchObject({ exitCode: 0 });
    expect(
        await runStandaloneMcp(
            {
                command: 'add',
                server: 'local',
                serverConfig: JSON.stringify({ type: 'stdio', command: 'replacement' }),
                replace: true,
            },
            { config }
        )
    ).toMatchObject({ exitCode: 0 });
    expect(await readFile(config, 'utf8')).toContain('replacement');
    await expect(readFile(`${config}.lock`)).rejects.toMatchObject({ code: 'ENOENT' });
});

it('attempts sidecar removal when handle closing fails and returns a safe cleanup outcome', async () => {
    const config = await configFile('mcpServers: {}\n');
    const filesystem = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
    let closeOwnedHandle: (() => Promise<void>) | undefined;
    vi.mocked(open).mockImplementationOnce(async (path, flags, mode) => {
        const file = await filesystem.open(path, flags, mode);
        closeOwnedHandle = file.close.bind(file);
        vi.spyOn(file, 'close').mockRejectedValueOnce(new Error('sentinel-private-close-error'));
        return file;
    });
    try {
        const result = await runStandaloneMcp(
            { command: 'add', server: 'local', serverConfig },
            { config }
        );
        expect(result).toMatchObject({
            exitCode: 2,
            output: { error: { code: 'config_lock_cleanup_failed' } },
        });
        expect(JSON.stringify(result)).not.toContain('sentinel');
        expect(unlink).toHaveBeenCalledWith(`${config}.lock`);
        expect(await readFile(config, 'utf8')).toContain('local:');
    } finally {
        if (closeOwnedHandle !== undefined) await closeOwnedHandle();
    }
});

it.skipIf(process.platform !== 'win32')(
    'releases ownership after an in-place Windows write failure',
    async () => {
        const config = await configFile('mcpServers: {}\n');
        vi.mocked(writeFile).mockRejectedValueOnce(
            Object.assign(new Error('sentinel-writer-secret'), { code: 'EACCES' })
        );
        const result = await runStandaloneMcp(
            { command: 'add', server: 'local', serverConfig },
            { config }
        );
        expect(result).toMatchObject({
            exitCode: 2,
            output: { error: { code: 'config_write_failed' } },
        });
        expect(JSON.stringify(result)).not.toContain('sentinel');
        await expect(readFile(`${config}.lock`)).rejects.toMatchObject({ code: 'ENOENT' });
        expect(
            await runStandaloneMcp({ command: 'add', server: 'local', serverConfig }, { config })
        ).toMatchObject({ exitCode: 0 });
    }
);

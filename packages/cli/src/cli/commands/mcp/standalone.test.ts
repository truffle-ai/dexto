import {
    mkdtemp,
    readFile,
    rm,
    writeFile,
    chmod,
    stat,
    symlink,
    lstat,
    readdir,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { MCPManager } from '@dexto/core/mcp';
import { DextoLogger } from '@dexto/core/logger';
import { runStandaloneMcp } from './standalone.js';
const directories: string[] = [];
afterEach(async () => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    await Promise.all(
        directories.splice(0).map((path) => rm(path, { recursive: true, force: true }))
    );
});
async function configFile(text: string): Promise<string> {
    const directory = await mkdtemp(join(tmpdir(), 'dexto-mcp-config-'));
    directories.push(directory);
    const path = join(directory, 'mcp.yml');
    await writeFile(path, text);
    return path;
}
it('lists configured servers without connecting or exposing credential fields', async () => {
    const config = await configFile(
        'mcpServers:\n  private:\n    type: http\n    url: https://user:password@example.test/mcp\n    headers:\n      Authorization: Bearer secret\n  disabled:\n    type: stdio\n    command: never-start-this\n    enabled: false\n'
    );
    expect(await runStandaloneMcp({ command: 'list' }, { config })).toEqual({
        exitCode: 0,
        output: {
            servers: [
                { name: 'private', type: 'http', enabled: true, status: 'configured' },
                { name: 'disabled', type: 'stdio', enabled: false, status: 'disabled' },
            ],
        },
    });
});
it('adds literal environment templates and preserves unrelated YAML comments', async () => {
    const config = await configFile('# operator notes\nlabel: local # keep this\nmcpServers: {}\n');
    const result = await runStandaloneMcp(
        {
            command: 'add',
            server: 'remote',
            serverConfig: JSON.stringify({
                type: 'http',
                url: '${UNSET_MCP_URL}',
                headers: { Authorization: 'Bearer ${UNSET_MCP_TOKEN}' },
            }),
        },
        { config }
    );
    expect(result.exitCode).toBe(0);
    const text = await readFile(config, 'utf8');
    for (const value of [
        '${UNSET_MCP_URL}',
        'Bearer ${UNSET_MCP_TOKEN}',
        '# operator notes',
        '# keep this',
    ])
        expect(text).toContain(value);
});
it('rejects duplicate additions without changing the configuration', async () => {
    const config = await configFile(
        'mcpServers:\n  local:\n    type: stdio\n    command: original\n'
    );
    const before = await readFile(config, 'utf8');
    expect(
        await runStandaloneMcp(
            {
                command: 'add',
                server: 'local',
                serverConfig: '{"type":"stdio","command":"replacement"}',
            },
            { config }
        )
    ).toMatchObject({ exitCode: 2, output: { error: { code: 'duplicate_server' } } });
    expect(await readFile(config, 'utf8')).toBe(before);
});
it('removes only the selected server and preserves other configuration', async () => {
    const config = await configFile(
        '# note\nmcpServers:\n  first:\n    type: stdio\n    command: first\n  second:\n    type: stdio\n    command: second\n'
    );
    expect(await runStandaloneMcp({ command: 'remove', server: 'first' }, { config })).toEqual({
        exitCode: 0,
        output: { server: 'first', status: 'removed' },
    });
    expect((await runStandaloneMcp({ command: 'list' }, { config })).output).toEqual({
        servers: [{ name: 'second', type: 'stdio', enabled: true, status: 'configured' }],
    });
    expect(await readFile(config, 'utf8')).toContain('# note');
});
it('reports invalid argument JSON separately from credential-bearing configuration errors', async () => {
    const config = await configFile(
        'mcpServers:\n  local:\n    type: stdio\n    command: never-start-this\n'
    );
    const result = await runStandaloneMcp(
        { command: 'call', server: 'local', tool: 'echo', argumentsJson: '{"sentinel-secret"' },
        { config }
    );
    expect(result).toMatchObject({ exitCode: 2, output: { error: { code: 'invalid_arguments' } } });
    expect(JSON.stringify(result)).not.toContain('sentinel-secret');
});

it('reports cleanup failure as an operation failure and releases the owned logger', async () => {
    const config = await configFile(
        'mcpServers:\n  local:\n    type: stdio\n    command: fixture\n'
    );
    vi.spyOn(MCPManager.prototype, 'connectServer').mockResolvedValue();
    vi.spyOn(MCPManager.prototype, 'disconnectAll').mockRejectedValue(
        new Error('sentinel-cleanup-secret')
    );
    const destroy = vi.spyOn(DextoLogger.prototype, 'destroy').mockResolvedValue();
    const result = await runStandaloneMcp({ command: 'connect', server: 'local' }, { config });
    expect(result).toMatchObject({
        exitCode: 4,
        output: { error: { code: 'mcp_cleanup_failed' } },
    });
    expect(JSON.stringify(result)).not.toContain('sentinel-cleanup-secret');
    expect(destroy).toHaveBeenCalledOnce();
});
it('distinguishes missing configuration from malformed credential-bearing YAML', async () => {
    const config = await configFile('mcpServers: [sentinel-config-secret\n');
    const malformed = await runStandaloneMcp({ command: 'list' }, { config });
    const missing = await runStandaloneMcp({ command: 'list' }, { config: config + '.missing' });
    expect(malformed).toMatchObject({ exitCode: 2, output: { error: { code: 'invalid_config' } } });
    expect(missing).toMatchObject({
        exitCode: 2,
        output: { error: { code: 'config_read_failed' } },
    });
    expect(JSON.stringify(malformed)).not.toContain('sentinel-config-secret');
});

it('does not treat inherited object keys as configured servers', async () => {
    const config = await configFile('mcpServers: {}\n');
    expect(
        await runStandaloneMcp({ command: 'remove', server: 'constructor' }, { config })
    ).toMatchObject({ exitCode: 2, output: { error: { code: 'server_not_found' } } });
});

it('reports invalid add JSON without leaking supplied fields or changing configuration', async () => {
    const config = await configFile('mcpServers: {}\n');
    const before = await readFile(config, 'utf8');
    expect(
        await runStandaloneMcp(
            { command: 'add', server: 'local', serverConfig: '{sentinel-add-secret' },
            { config }
        )
    ).toMatchObject({ exitCode: 2, output: { error: { code: 'invalid_server_config' } } });
    expect(await readFile(config, 'utf8')).toBe(before);
});

it('rejects blank server names without writing a configuration entry', async () => {
    const config = await configFile('mcpServers: {}\n');
    expect(
        await runStandaloneMcp(
            { command: 'add', server: ' ', serverConfig: '{"type":"stdio","command":"node"}' },
            { config }
        )
    ).toMatchObject({ exitCode: 2, output: { error: { code: 'invalid_server_name' } } });
    expect(await readFile(config, 'utf8')).toBe('mcpServers: {}\n');
});

it.skipIf(process.platform === 'win32')(
    'makes an existing config private when adding a server',
    async () => {
        const config = await configFile('mcpServers: {}\n');
        await chmod(config, 0o644);
        expect(
            (
                await runStandaloneMcp(
                    {
                        command: 'add',
                        server: 'local',
                        serverConfig: '{"type":"stdio","command":"node"}',
                    },
                    { config }
                )
            ).exitCode
        ).toBe(0);
        expect((await stat(config)).mode & 0o777).toBe(0o600);
    }
);

it.skipIf(process.platform === 'win32').each(['add', 'remove'])(
    'rejects %s edits through a leaf symlink',
    async (command) => {
        const target = await configFile(
            'mcpServers:\n  local:\n    type: stdio\n    command: node\n'
        );
        const config = target + '.link';
        await symlink(target, config);
        const before = await readFile(target, 'utf8');
        const result = await runStandaloneMcp(
            command === 'add'
                ? {
                      command: 'add',
                      server: 'second',
                      serverConfig: '{"type":"stdio","command":"node"}',
                  }
                : { command: 'remove', server: 'local' },
            { config }
        );
        expect(result).toMatchObject({
            exitCode: 2,
            output: { error: { code: 'config_write_failed' } },
        });
        expect(await readFile(target, 'utf8')).toBe(before);
        expect((await lstat(config)).isSymbolicLink()).toBe(true);
    }
);

it.skipIf(process.platform === 'win32')(
    'makes an existing config private when removing a server',
    async () => {
        const config = await configFile(
            'mcpServers:\n  local:\n    type: stdio\n    command: node\n'
        );
        await chmod(config, 0o644);
        expect(
            (await runStandaloneMcp({ command: 'remove', server: 'local' }, { config })).exitCode
        ).toBe(0);
        expect((await stat(config)).mode & 0o777).toBe(0o600);
    }
);

it.skipIf(process.platform === 'win32').each(['add', 'remove'])(
    'rejects %s edits to a dangling leaf symlink',
    async (command) => {
        const target = await configFile('mcpServers: {}\n');
        await rm(target);
        const config = target + '.link';
        await symlink(target, config);
        const result = await runStandaloneMcp(
            command === 'add'
                ? {
                      command: 'add',
                      server: 'local',
                      serverConfig: '{"type":"stdio","command":"node"}',
                  }
                : { command: 'remove', server: 'local' },
            { config }
        );
        expect(result).toMatchObject({
            exitCode: 2,
            output: { error: { code: 'config_write_failed' } },
        });
        expect((await lstat(config)).isSymbolicLink()).toBe(true);
        await expect(stat(target)).rejects.toMatchObject({ code: 'ENOENT' });
    }
);

it('creates a missing MCP config and its parent directory without leaving a temporary file', async () => {
    const existing = await configFile('mcpServers: {}\n');
    const config = existing + '.directory/mcp.yml';
    expect(
        (
            await runStandaloneMcp(
                {
                    command: 'add',
                    server: 'local',
                    serverConfig: '{"type":"stdio","command":"node"}',
                },
                { config }
            )
        ).exitCode
    ).toBe(0);
    expect((await runStandaloneMcp({ command: 'list' }, { config })).output).toEqual({
        servers: [{ name: 'local', type: 'stdio', enabled: true, status: 'configured' }],
    });
    if (process.platform !== 'win32') expect((await stat(config)).mode & 0o777).toBe(0o600);
    expect(await readdir(existing + '.directory')).toEqual(['mcp.yml']);
});

it('keeps the existing inode on the Windows edit path', async () => {
    const config = await configFile('mcpServers: {}\n');
    const inode = (await stat(config)).ino;
    vi.stubGlobal('process', { ...process, platform: 'win32' });
    expect(
        (
            await runStandaloneMcp(
                {
                    command: 'add',
                    server: 'local',
                    serverConfig: '{"type":"stdio","command":"node"}',
                },
                { config }
            )
        ).exitCode
    ).toBe(0);
    expect((await stat(config)).ino).toBe(inode);
    expect(await readFile(config, 'utf8')).toContain('local:');
});

it.each(['success', 'connection', 'operation', 'cleanup', 'interruption'] as const)(
    'disposes scoped signal listeners after %s and cleans up once',
    async (outcome) => {
        const config = await configFile(
            'mcpServers:\n  local:\n    type: stdio\n    command: fixture\n'
        );
        const beforeInt = process.listeners('SIGINT');
        const beforeTerm = process.listeners('SIGTERM');
        const lifecycle: string[] = [];
        const connect = vi.spyOn(MCPManager.prototype, 'connectServer');
        if (outcome === 'connection')
            connect.mockRejectedValue(new Error('sentinel-startup-secret'));
        else connect.mockResolvedValue();
        vi.spyOn(MCPManager.prototype, 'getToolDescriptors').mockImplementation(() => {
            throw new Error('sentinel-operation-secret');
        });
        const disconnect = vi
            .spyOn(MCPManager.prototype, 'disconnectAll')
            .mockImplementation(async () => {
                lifecycle.push('disconnect');
                if (outcome === 'cleanup') throw new Error('sentinel-cleanup-secret');
                if (outcome === 'interruption') {
                    const sigint = process
                        .listeners('SIGINT')
                        .find((listener) => !beforeInt.includes(listener));
                    const sigterm = process
                        .listeners('SIGTERM')
                        .find((listener) => !beforeTerm.includes(listener));
                    expect(sigint).toBeDefined();
                    expect(sigterm).toBeDefined();
                    sigint?.('SIGINT');
                    sigterm?.('SIGTERM');
                    sigint?.('SIGINT');
                }
            });
        const destroy = vi.spyOn(DextoLogger.prototype, 'destroy').mockImplementation(async () => {
            lifecycle.push('logger');
        });
        const result = await runStandaloneMcp(
            { command: outcome === 'operation' ? 'tools' : 'connect', server: 'local' },
            { config }
        );
        expect(result.exitCode).toBe(
            outcome === 'success'
                ? 0
                : outcome === 'connection'
                  ? 3
                  : outcome === 'interruption'
                    ? 130
                    : 4
        );
        if (outcome === 'interruption')
            expect(result.output).toEqual({
                server: 'local',
                signal: 'SIGINT',
                error: { code: 'mcp_interrupted', message: 'MCP operation interrupted.' },
            });
        expect(JSON.stringify(result)).not.toContain('sentinel-');
        expect(disconnect).toHaveBeenCalledOnce();
        expect(destroy).toHaveBeenCalledOnce();
        expect(lifecycle).toEqual(['disconnect', 'logger']);
        expect(process.listeners('SIGINT')).toEqual(beforeInt);
        expect(process.listeners('SIGTERM')).toEqual(beforeTerm);
    }
);

it('preserves an interruption when startup rejects and removes its signal listeners', async () => {
    const config = await configFile(
        'mcpServers:\n  local:\n    type: stdio\n    command: fixture\n'
    );
    const beforeInt = process.listeners('SIGINT');
    const beforeTerm = process.listeners('SIGTERM');
    vi.spyOn(MCPManager.prototype, 'connectServer').mockImplementation(async () => {
        const listener = process.listeners('SIGTERM').find((item) => !beforeTerm.includes(item));
        expect(listener).toBeDefined();
        listener?.('SIGTERM');
        throw new Error('sentinel-startup-secret');
    });
    const disconnect = vi.spyOn(MCPManager.prototype, 'disconnectAll').mockResolvedValue();
    const destroy = vi.spyOn(DextoLogger.prototype, 'destroy').mockResolvedValue();
    expect(await runStandaloneMcp({ command: 'connect', server: 'local' }, { config })).toEqual({
        exitCode: 143,
        output: {
            server: 'local',
            signal: 'SIGTERM',
            error: { code: 'mcp_interrupted', message: 'MCP operation interrupted.' },
        },
    });
    expect(disconnect).toHaveBeenCalledOnce();
    expect(destroy).toHaveBeenCalledOnce();
    expect(process.listeners('SIGINT')).toEqual(beforeInt);
    expect(process.listeners('SIGTERM')).toEqual(beforeTerm);
});

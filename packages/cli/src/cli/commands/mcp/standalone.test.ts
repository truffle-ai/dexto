import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { MCPManager } from '@dexto/core/mcp';
import { DextoLogger } from '@dexto/core/logger';
import { runStandaloneMcp } from './standalone.js';
const directories: string[] = [];
afterEach(async () => {
    vi.restoreAllMocks();
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

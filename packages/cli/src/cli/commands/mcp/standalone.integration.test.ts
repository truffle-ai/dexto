import { execFile } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import {
    mkdtemp,
    mkdir,
    rm,
    writeFile,
    readFile,
    chmod,
    stat,
    symlink,
    lstat,
} from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { stringify } from 'yaml';
import { createServer, type Server } from 'node:http';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';
import { createMcpTransport } from '@dexto/server';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const execute = promisify(execFile);
const require = createRequire(import.meta.url);
const tsx = require.resolve('tsx');
const entrypoint = fileURLToPath(new URL('../../../index.ts', import.meta.url));
let directory: string;
let config: string;
let fixturePath: string;
let httpServer: Server;
let origin: string;
const gatewayPids: number[] = [];
beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), 'dexto-mcp-command-'));
    config = join(directory, 'mcp.yml');
    const fixture = join(directory, 'fixture.mjs');
    fixturePath = fixture;
    const sdkServer = pathToFileURL(
        require.resolve('@modelcontextprotocol/sdk/server/mcp.js')
    ).href;
    const sdkTransport = pathToFileURL(
        require.resolve('@modelcontextprotocol/sdk/server/stdio.js')
    ).href;
    const zod = pathToFileURL(require.resolve('zod')).href;
    await writeFile(
        fixture,
        `
        import { writeFileSync } from 'node:fs';
        if (process.env.MCP_PID_FILE) writeFileSync(process.env.MCP_PID_FILE, String(process.pid));
        import { McpServer } from ${JSON.stringify(sdkServer)};
        import { StdioServerTransport } from ${JSON.stringify(sdkTransport)};
        import { z } from ${JSON.stringify(zod)};
        const server = new McpServer({ name: 'fixture', version: '1.0.0' });
        if (process.env.MCP_RESOURCES_ONLY !== '1') {
        server.tool('echo--literal', { message: z.string() }, async ({ message }) => ({ content: [{ type: 'text', text: JSON.stringify({ message, pid: process.pid }) }] }));
        server.tool('echo', { message: z.string() }, async ({ message }) => ({ content: [{ type: 'text', text: JSON.stringify({ message, pid: process.pid }) }] }));
        server.tool('failure', {}, async () => ({ isError: true, content: [{ type: 'text', text: 'fixture tool failure' }] }));
        }
        server.resource('fixture', 'fixture://resource', async (uri) => ({ contents: [{ uri: uri.href, text: JSON.stringify({ data: 'fixture data', pid: process.pid }), mimeType: 'application/json' }, { uri: uri.href + '#binary', blob: 'AAEC', mimeType: 'application/octet-stream' }] }));
        if (process.env.MCP_RESOURCES_ONLY !== '1') server.prompt('fixture', {}, async () => ({ messages: [{ role: 'user', content: { type: 'text', text: 'fixture prompt' } }] }));
        if (process.env.MCP_RESOURCES_ONLY !== '1') server.prompt('fixture--literal', { name: z.string() }, async ({ name }) => ({ description: 'Rendered fixture', messages: [{ role: 'user', content: { type: 'text', text: JSON.stringify({ name, pid: process.pid }) } }] }));
        await server.connect(new StdioServerTransport());
    `
    );
    httpServer = createServer(async (request, response) => {
        if (request.headers.authorization !== 'Bearer fixture-header') {
            response.writeHead(401).end();
            return;
        }
        const server = new McpServer({ name: 'remote-fixture', version: '1.0.0' });
        server.tool('remote_echo', { message: z.string() }, async ({ message }) => ({
            content: [{ type: 'text', text: message }],
        }));
        const transport = await createMcpTransport('http');
        response.once('close', () => {
            void server.close();
        });
        await server.connect(transport);
        if (!(transport instanceof StreamableHTTPServerTransport))
            throw new Error('Expected HTTP transport');
        let text = '';
        for await (const chunk of request) text += chunk;
        await transport.handleRequest(request, response, text ? JSON.parse(text) : undefined);
    });
    await new Promise<void>((resolve) => httpServer.listen(0, '127.0.0.1', resolve));
    const address = httpServer.address();
    if (!address || typeof address === 'string') throw new Error('Expected TCP fixture');
    origin = `http://127.0.0.1:${address.port}/mcp`;
    await writeFile(
        config,
        stringify({
            mcpServers: {
                local: { type: 'stdio', command: process.execPath, args: [fixture] },
                disabled: { type: 'stdio', command: 'never-start-this', enabled: false },
            },
        })
    );
});
afterAll(async () => {
    for (const pid of gatewayPids) {
        try {
            process.kill(pid, 'SIGKILL');
        } catch {
            /* owned fixture already exited */
        }
    }
    await new Promise<void>((resolve, reject) =>
        httpServer.close((error) => (error ? reject(error) : resolve()))
    );
    await rm(directory, { recursive: true, force: true });
});
function run(args: string[], configPath: string | null = config) {
    return execute(
        process.execPath,
        [
            '--import',
            tsx,
            entrypoint,
            'mcp',
            ...args,
            ...(configPath === null ? [] : ['--config', configPath]),
            '--json',
        ],
        {
            cwd: directory,
            env: {
                PATH: process.env.PATH,
                SystemRoot: process.env.SystemRoot,
                HOME: directory,
                USERPROFILE: directory,
                DEXTO_DEV_MODE: 'false',
                DEXTO_ANALYTICS_DISABLED: '1',
                DEXTO_LLM_REGISTRY_DISABLE_FETCH: '1',
                MCP_PID_FILE: join(directory, 'last-pid'),
            },
            timeout: 20000,
        }
    );
}
it('runs standalone listing without model, login or agent configuration', async () => {
    const result = await run(['list']);
    expect(JSON.parse(result.stdout)).toEqual({
        servers: [
            { name: 'local', type: 'stdio', enabled: true, status: 'configured' },
            { name: 'disabled', type: 'stdio', enabled: false, status: 'disabled' },
        ],
    });
}, 30000);

it('honors parent configuration, explicit leaf override and the project default', async () => {
    const empty = join(directory, 'empty.yml');
    await writeFile(empty, 'mcpServers: {}\n');
    await mkdir(join(directory, '.dexto'), { recursive: true });
    await writeFile(join(directory, '.dexto', 'mcp.yml'), await readFile(config));
    expect(JSON.parse((await run(['--config', empty, 'list'], null)).stdout)).toEqual({
        servers: [],
    });
    expect(JSON.parse((await run(['list', '--config', empty], null)).stdout)).toEqual({
        servers: [],
    });
    expect(
        JSON.parse((await run(['--config', config, 'list', '--config', empty], null)).stdout)
    ).toEqual({ servers: [] });
    expect(JSON.parse((await run(['list'], null)).stdout).servers).toHaveLength(2);
}, 30000);

it('uses the parent-selected file for mutations and direct tool execution', async () => {
    const selected = join(directory, 'parent-selected.yml');
    await writeFile(selected, 'mcpServers: {}\n');
    await run(
        [
            '--config',
            selected,
            'add',
            'selected',
            '--command',
            process.execPath,
            '--arg',
            fixturePath,
        ],
        null
    );
    const result = JSON.parse(
        (
            await run(
                [
                    '--config',
                    selected,
                    'call',
                    'selected',
                    'echo',
                    '--arguments',
                    '{"message":"selected-file"}',
                ],
                null
            )
        ).stdout
    );
    const answer = JSON.parse(result.result.content[0].text);
    expect(answer.message).toBe('selected-file');
    expect(() => process.kill(answer.pid, 0)).toThrow();
    expect(await readFile(config, 'utf8')).not.toContain('selected:');
    await run(['--config', selected, 'remove', 'selected'], null);
    expect(JSON.parse((await run(['--config', selected, 'list'], null)).stdout)).toEqual({
        servers: [],
    });
}, 30000);

it('reports command parser errors on stderr with exit 1 before an action runs', async () => {
    for (const args of [
        ['list', '--unknown-option'],
        ['call', 'local'],
    ]) {
        await expect(run(args, null)).rejects.toMatchObject({
            code: 1,
            stdout: '',
            stderr: expect.stringContaining('error:'),
        });
    }
}, 30000);

it('probes a selected real stdio server and reports closed ownership', async () => {
    const result = await run(['connect', 'local']);
    expect(JSON.parse(result.stdout)).toEqual({
        server: 'local',
        status: 'connected',
        connection: 'closed',
    });
}, 30000);

it('calls the exact upstream tool name and closes the owned child process', async () => {
    const result = await run([
        'call',
        'local',
        'echo--literal',
        '--arguments',
        '{"message":"hello"}',
    ]);
    const output = JSON.parse(result.stdout);
    const answer = JSON.parse(output.result.content[0].text);
    expect(answer.message).toBe('hello');
    expect(() => process.kill(answer.pid, 0)).toThrow();
}, 30000);
it('discovers upstream tool schemas without bootstrapping an agent', async () => {
    const output = JSON.parse((await run(['tools', 'local'])).stdout);
    expect(output.tools).toEqual(
        expect.arrayContaining([
            expect.objectContaining({
                identity: { type: 'mcp', connectionId: 'local', toolName: 'echo--literal' },
                inputSchema: expect.objectContaining({ type: 'object' }),
            }),
        ])
    );
    expect(output.connection).toBe('closed');
}, 30000);
it('lists resource metadata from the selected server', async () => {
    const output = JSON.parse((await run(['resources', 'local'])).stdout);
    expect(output.resources).toEqual([
        expect.objectContaining({
            serverName: 'local',
            summary: expect.objectContaining({ uri: 'fixture://resource' }),
        }),
    ]);
    expect(output.connection).toBe('closed');
}, 30000);
it('reads a selected resource and closes the owned child process', async () => {
    const output = JSON.parse((await run(['read-resource', 'local', 'fixture://resource'])).stdout);
    const content = JSON.parse(output.result.contents[0].text);
    expect(content.data).toBe('fixture data');
    expect(output.result.contents[0].mimeType).toBe('application/json');
    expect(output.result.contents[1]).toEqual({
        uri: 'fixture://resource#binary',
        blob: 'AAEC',
        mimeType: 'application/octet-stream',
    });
    expect(output).toMatchObject({
        server: 'local',
        uri: 'fixture://resource',
        connection: 'closed',
    });
    expect(() => process.kill(content.pid, 0)).toThrow();
}, 30000);

it('lists prompt metadata from the selected server', async () => {
    const output = JSON.parse((await run(['prompts', 'local'])).stdout);
    expect(output.prompts).toEqual(
        expect.arrayContaining([
            expect.objectContaining({ serverName: 'local', promptName: 'fixture' }),
            expect.objectContaining({ serverName: 'local', promptName: 'fixture--literal' }),
        ])
    );
    expect(output.connection).toBe('closed');
}, 30000);
it('renders an exact selected prompt with string arguments and closes the owned child', async () => {
    const output = JSON.parse(
        (
            await run([
                'get-prompt',
                'local',
                'fixture--literal',
                '--arguments',
                '{"name":"rendered"}',
            ])
        ).stdout
    );
    const content = JSON.parse(output.result.messages[0].content.text);
    expect(content.name).toBe('rendered');
    expect(output).toMatchObject({
        server: 'local',
        prompt: 'fixture--literal',
        connection: 'closed',
    });
    expect(output.result.description).toBe('Rendered fixture');
    expect(output.result.messages[0].role).toBe('user');
    expect(() => process.kill(content.pid, 0)).toThrow();
}, 30000);

it('rejects non-string prompt arguments before connecting', async () => {
    const pidFile = join(directory, 'last-pid');
    await writeFile(pidFile, 'not-started');
    for (const value of ['{"name":42}', '[]', 'not-json']) {
        await expect(
            run(['get-prompt', 'local', 'fixture--literal', '--arguments', value])
        ).rejects.toMatchObject({
            code: 2,
            stdout: expect.stringContaining('invalid_arguments'),
        });
        expect(await readFile(pidFile, 'utf8')).toBe('not-started');
    }
}, 30000);

it('uses parent-selected configuration for resource reads and prompt rendering', async () => {
    const resource = JSON.parse(
        (await run(['--config', config, 'read-resource', 'local', 'fixture://resource'], null))
            .stdout
    );
    expect(JSON.parse(resource.result.contents[0].text).data).toBe('fixture data');
    const prompt = JSON.parse(
        (
            await run(
                [
                    '--config',
                    config,
                    'get-prompt',
                    'local',
                    'fixture--literal',
                    '--arguments',
                    '{"name":"parent"}',
                ],
                null
            )
        ).stdout
    );
    expect(JSON.parse(prompt.result.messages[0].content.text).name).toBe('parent');
}, 30000);

it('returns safe protocol failures and closes resource/prompt command ownership', async () => {
    for (const args of [
        ['read-resource', 'local', 'fixture://missing?token=sentinel'],
        ['get-prompt', 'local', 'missing-sentinel'],
    ]) {
        await run(args).then(
            () => {
                throw new Error('Expected protocol failure');
            },
            (error: unknown) => {
                if (
                    typeof error !== 'object' ||
                    error === null ||
                    !('stdout' in error) ||
                    typeof error.stdout !== 'string'
                )
                    throw error;
                expect(error).toMatchObject({ code: 4 });
                expect(JSON.parse(error.stdout)).toMatchObject({
                    server: 'local',
                    error: { code: 'mcp_operation_failed' },
                });
                expect(error.stdout).not.toContain('sentinel');
                if ('stderr' in error) expect(error.stderr).not.toContain('sentinel');
            }
        );
        const pid = Number(await readFile(join(directory, 'last-pid'), 'utf8'));
        expect(() => process.kill(pid, 0)).toThrow();
    }
}, 30000);

it('adds and removes portable server configuration through real command registration', async () => {
    const serverConfig =
        '{"type":"http","url":"${MCP_ENDPOINT}","headers":{"Authorization":"Bearer ${MCP_TOKEN}"}}';
    const added = JSON.parse(
        (await run(['add', 'remote', '--server-config', serverConfig])).stdout
    );
    expect(added).toEqual({ server: 'remote', status: 'configured' });
    const duplicate = await run(['add', 'remote', '--server-config', serverConfig]).catch(
        (error: unknown) => error
    );
    expect(duplicate).toMatchObject({ code: 2 });
    expect(JSON.parse((await run(['remove', 'remote'])).stdout)).toEqual({
        server: 'remote',
        status: 'removed',
    });
}, 30000);

it('sets up a stdio server with typed flags and discovers/calls its upstream tool', async () => {
    await run([
        'add',
        'typed',
        '--command',
        process.execPath,
        '--arg',
        fixturePath,
        '--env',
        'MCP_MARKER=typed',
    ]);
    expect(JSON.parse((await run(['tools', 'typed'])).stdout).tools).toEqual(
        expect.arrayContaining([
            expect.objectContaining({
                identity: { type: 'mcp', connectionId: 'typed', toolName: 'echo--literal' },
            }),
        ])
    );
    const result = JSON.parse(
        (await run(['call', 'typed', 'echo--literal', '--arguments', '{"message":"typed setup"}']))
            .stdout
    );
    expect(JSON.parse(result.result.content[0].text).message).toBe('typed setup');
}, 30000);

it('sets up a remote server with URL/header flags and discovers/calls it over real loopback HTTP', async () => {
    await run([
        'add',
        'remote-http',
        '--url',
        origin,
        '--header',
        'Authorization=Bearer fixture-header',
    ]);
    const tools = JSON.parse((await run(['tools', 'remote-http'])).stdout);
    expect(tools.tools).toEqual(
        expect.arrayContaining([
            expect.objectContaining({
                identity: { type: 'mcp', connectionId: 'remote-http', toolName: 'remote_echo' },
            }),
        ])
    );
    const output = JSON.parse(
        (
            await run([
                'call',
                'remote-http',
                'remote_echo',
                '--arguments',
                '{"message":"remote setup"}',
            ])
        ).stdout
    );
    expect(output.result.content).toEqual([{ type: 'text', text: 'remote setup' }]);
}, 30000);
async function failed(args: string[], code: number) {
    try {
        await run(args);
        throw new Error('Expected failure');
    } catch (error) {
        const failure = z
            .object({ code: z.number(), stdout: z.string(), stderr: z.string() })
            .parse(error);
        expect(failure.code).toBe(code);
        return failure;
    }
}
it('preserves the MCP tool error result with nonzero status and closes the child', async () => {
    const failure = await failed(['call', 'local', 'failure'], 4);
    const output = JSON.parse(failure.stdout);
    expect(output.result).toMatchObject({
        isError: true,
        content: [{ type: 'text', text: 'fixture tool failure' }],
    });
    const pid = Number(await readFile(join(directory, 'last-pid'), 'utf8'));
    expect(() => process.kill(pid, 0)).toThrow();
}, 30000);

it('keeps connection diagnostics free of configured credential values', async () => {
    const secret = 'sentinel-private-connection-value';
    await run([
        'add',
        'denied',
        '--url',
        origin + '?token=' + secret,
        '--header',
        'Authorization=Bearer ' + secret,
    ]);
    const result = await failed(['connect', 'denied'], 3);
    expect(JSON.parse(result.stdout)).toMatchObject({ error: { code: 'mcp_connection_failed' } });
    expect(result.stdout + result.stderr).not.toContain(secret);
}, 30000);

it('closes a real stdio child after initialization rejects', async () => {
    const rejected = join(directory, 'rejected.mjs');
    await writeFile(
        rejected,
        `
        import { createInterface } from 'node:readline';
        import { writeFileSync } from 'node:fs';
        writeFileSync(process.env.MCP_PID_FILE, String(process.pid));
        createInterface({ input: process.stdin }).on('line', (line) => {
            const request = JSON.parse(line);
            if (request.id !== undefined) process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: request.id, error: { code: -32603, message: 'sentinel-handshake-secret' } }) + '\\n');
        });
        setInterval(() => {}, 1000);
    `
    );
    await run(['add', 'rejected', '--command', process.execPath, '--arg', rejected]);
    const result = await failed(['connect', 'rejected'], 3);
    expect(JSON.parse(result.stdout)).toMatchObject({ error: { code: 'mcp_connection_failed' } });
    expect(result.stdout + result.stderr).not.toContain('sentinel-handshake-secret');
    const pid = Number(await readFile(join(directory, 'last-pid'), 'utf8'));
    expect(() => process.kill(pid, 0)).toThrow();
}, 30000);

it.each(['EOF', 'SIGTERM'])(
    'hosts an MCP-only gateway without credentials and closes upstream ownership on %s',
    async (shutdown) => {
        const gatewayConfig = join(directory, 'gateway.yml');
        await writeFile(
            gatewayConfig,
            stringify({
                mcpServers: {
                    local: { type: 'stdio', command: process.execPath, args: [fixturePath] },
                },
            })
        );
        const client = new Client({ name: 'gateway-test', version: '1.0.0' });
        const transport = new StdioClientTransport({
            command: process.execPath,
            args: [
                '--import',
                tsx,
                entrypoint,
                'mcp',
                '--group-servers',
                '--config',
                gatewayConfig,
            ],
            cwd: directory,
            env: {
                PATH: process.env.PATH ?? '',
                HOME: directory,
                USERPROFILE: directory,
                DEXTO_DEV_MODE: 'false',
                DEXTO_ANALYTICS_DISABLED: '1',
                DEXTO_LLM_REGISTRY_DISABLE_FETCH: '1',
                MCP_PID_FILE: join(directory, 'last-pid'),
            },
            stderr: 'pipe',
        });
        let upstreamPid: number | undefined;
        let closeDuration = 0;
        try {
            await client.connect(transport, { timeout: 5000 });
            const tools = await client.listTools();
            expect(tools.tools).toEqual(
                expect.arrayContaining([expect.objectContaining({ name: 'echo' })])
            );
            const result = await client.callTool({
                name: 'echo',
                arguments: { message: 'gateway' },
            });
            const answer = z
                .object({
                    content: z.array(z.object({ type: z.literal('text'), text: z.string() })),
                })
                .parse(result);
            const value = z
                .object({ message: z.string(), pid: z.number() })
                .parse(JSON.parse(answer.content[0]?.text ?? '{}'));
            expect(value.message).toBe('gateway');
            upstreamPid = value.pid;
            if (shutdown === 'SIGTERM') {
                if (transport.pid === null) throw new Error('Gateway process missing');
                process.kill(transport.pid, 'SIGTERM');
            }
        } finally {
            const closing = performance.now();
            await client.close();
            closeDuration = performance.now() - closing;
            const recorded = Number(
                await readFile(join(directory, 'last-pid'), 'utf8').catch(() => '')
            );
            if (recorded > 0) gatewayPids.push(recorded);
        }
        // The SDK escalates EOF to SIGTERM after two seconds. Closure must complete
        // before that fallback to prove the requested interface owns shutdown.
        expect(closeDuration).toBeLessThan(1500);
        expect(upstreamPid).toBeTypeOf('number');
        if (upstreamPid === undefined) throw new Error('Fixture did not return its PID');
        expect(() => process.kill(upstreamPid, 0)).toThrow();
    },
    30000
);

it('connects and lists metadata from a valid resources-only server', async () => {
    await run([
        'add',
        'resources-only',
        '--command',
        process.execPath,
        '--arg',
        fixturePath,
        '--env',
        'MCP_RESOURCES_ONLY=1',
    ]);
    expect(JSON.parse((await run(['connect', 'resources-only'])).stdout)).toMatchObject({
        status: 'connected',
        connection: 'closed',
    });
    const output = JSON.parse((await run(['resources', 'resources-only'])).stdout);
    expect(output).toMatchObject({
        resources: [
            expect.objectContaining({
                serverName: 'resources-only',
                summary: expect.objectContaining({ uri: 'fixture://resource' }),
            }),
        ],
        connection: 'closed',
    });
    const pid = Number(await readFile(join(directory, 'last-pid'), 'utf8'));
    expect(() => process.kill(pid, 0)).toThrow();
}, 30000);

it.skipIf(process.platform === 'win32')(
    'writes private MCP configuration through the actual add and remove commands',
    async () => {
        const selected = join(directory, 'private-edit.yml');
        await writeFile(selected, '# operator notes\nmcpServers: {}\n', { mode: 0o644 });
        await run(
            ['add', 'local', '--server-config', '{"type":"stdio","command":"node"}'],
            selected
        );
        expect((await stat(selected)).mode & 0o777).toBe(0o600);
        expect(await readFile(selected, 'utf8')).toContain('# operator notes');
        await chmod(selected, 0o644);
        await run(['remove', 'local'], selected);
        expect((await stat(selected)).mode & 0o777).toBe(0o600);
        expect(JSON.parse((await run(['list'], selected)).stdout)).toEqual({ servers: [] });
    },
    30000
);

it.skipIf(process.platform === 'win32')(
    'refuses a leaf-symlink edit through actual command registration',
    async () => {
        const target = join(directory, 'symlink-target.yml');
        const selected = join(directory, 'symlink-edit.yml');
        const before = 'mcpServers: {}\n';
        await writeFile(target, before);
        await symlink(target, selected);
        const result = await run(
            ['add', 'local', '--server-config', '{"type":"stdio","command":"node"}'],
            selected
        ).catch((error: unknown) => error);
        expect(result).toMatchObject({
            code: 2,
            stdout: expect.stringContaining('config_write_failed'),
        });
        expect(await readFile(target, 'utf8')).toBe(before);
        expect((await lstat(selected)).isSymbolicLink()).toBe(true);
    },
    30000
);

it.skipIf(process.platform !== 'win32')(
    'preserves the existing Windows file ACL on actual add and remove',
    async () => {
        const systemRoot = process.env.SystemRoot;
        if (!systemRoot) throw new Error('Windows fixture requires SystemRoot');
        const selectedDirectory = join(directory, 'windows-acl-edit');
        await mkdir(selectedDirectory);
        const selected = join(selectedDirectory, 'mcp.yml');
        await writeFile(selected, 'mcpServers: {}\n');
        const powershell = join(
            systemRoot,
            'System32',
            'WindowsPowerShell',
            'v1.0',
            'powershell.exe'
        );
        const aclCommand = (script: string) =>
            execute(powershell, ['-NoProfile', '-NonInteractive', '-Command', script], {
                cwd: directory,
                env: {
                    SystemRoot: systemRoot,
                    PATH: process.env.PATH,
                    HOME: directory,
                    USERPROFILE: directory,
                    MCP_ACL_CONFIG_PATH: selected,
                },
                timeout: 20000,
            });
        const hashAcl = `
        function Get-AclHash($path) {
            $bytes = [System.Text.Encoding]::UTF8.GetBytes((Get-Acl -LiteralPath $path).Sddl)
            $sha = [System.Security.Cryptography.SHA256]::Create()
            try { return [System.BitConverter]::ToString($sha.ComputeHash($bytes)) }
            finally { $sha.Dispose() }
        }
    `;
        const before = (
            await aclCommand(`${hashAcl}
        $ErrorActionPreference = 'Stop'
        $path = $env:MCP_ACL_CONFIG_PATH
        $directory = [System.IO.Path]::GetDirectoryName($path)
        $parent = Get-Acl -LiteralPath $directory
        $parent.AddAccessRule([System.Security.AccessControl.FileSystemAccessRule]::new(
            [System.Security.Principal.SecurityIdentifier]::new('S-1-5-32-545'),
            'ReadAndExecute', 'ContainerInherit,ObjectInherit', 'None', 'Allow'))
        Set-Acl -LiteralPath $directory -AclObject $parent
        $acl = Get-Acl -LiteralPath $path
        $acl.SetAccessRuleProtection($true, $false)
        $acl.SetAccessRule([System.Security.AccessControl.FileSystemAccessRule]::new(
            [System.Security.Principal.WindowsIdentity]::GetCurrent().User, 'FullControl', 'Allow'))
        Set-Acl -LiteralPath $path -AclObject $acl
        $control = Join-Path $directory 'inherited-control.yml'
        [System.IO.File]::WriteAllText($control, 'synthetic')
        try {
            if ((Get-AclHash $path) -eq (Get-AclHash $control)) {
                throw 'Fixture did not establish distinct file and inherited ACLs'
            }
            [Console]::Write((Get-AclHash $path))
        } finally { Remove-Item -LiteralPath $control }
    `)
        ).stdout.trim();
        const readAcl = async () =>
            (
                await aclCommand(
                    `${hashAcl}
        $ErrorActionPreference = 'Stop'
        [Console]::Write((Get-AclHash $env:MCP_ACL_CONFIG_PATH))
    `
                )
            ).stdout.trim();
        await run(
            ['add', 'local', '--server-config', '{"type":"stdio","command":"node"}'],
            selected
        );
        expect(await readAcl()).toBe(before);
        await run(['remove', 'local'], selected);
        expect(await readAcl()).toBe(before);
        expect(JSON.parse((await run(['list'], selected)).stdout)).toEqual({ servers: [] });
    },
    60000
);

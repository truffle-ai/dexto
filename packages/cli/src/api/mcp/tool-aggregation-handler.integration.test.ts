import { assert, afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer, request as httpRequest } from 'node:http';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { startMcpHttpAggregationGateway } from './http-gateway.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ServersConfigSchema, type ValidatedServersConfig } from '@dexto/core/mcp';
import { eventBus } from '@dexto/core/events';
import {
    initializeMcpToolAggregationServer,
    initializeMcpToolAggregationHost,
} from './tool-aggregation-handler.js';

const inputSchema = {
    type: 'object',
    required: ['value'],
    properties: {
        value: {
            anyOf: [
                { type: 'string', pattern: '^valid' },
                { type: 'integer', minimum: 2 },
            ],
        },
    },
    additionalProperties: false,
};
let directory: string;
let fixture: string;
const servers: McpServer[] = [];
const gateways: { close(): Promise<void> }[] = [];
const clients: Client[] = [];
const identities = new Set<string>();

beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), 'dexto-aggregation-'));
    fixture = join(directory, 'upstream.mjs');
    const require = createRequire(import.meta.url);
    const sdk = (path: string) =>
        JSON.stringify(pathToFileURL(require.resolve(`@modelcontextprotocol/sdk/${path}`)).href);
    await writeFile(
        fixture,
        `
import { Server } from ${sdk('server/index.js')};
import { StdioServerTransport } from ${sdk('server/stdio.js')};
import { ListToolsRequestSchema, CallToolRequestSchema, ListResourcesRequestSchema, ReadResourceRequestSchema, ListPromptsRequestSchema, GetPromptRequestSchema } from ${sdk('types.js')};
import { writeFileSync } from 'node:fs';
const identity = process.env.IDENTITY;
let refreshed = false;
writeFileSync(process.env.MARKER + '.pid', String(process.pid));
process.on('exit', () => writeFileSync(process.env.MARKER, 'closed'));
const server = new Server({ name: identity, version: '1.0.0' }, { capabilities: { ...(process.env.NO_TOOLS ? {} : { tools: {} }), resources: {}, prompts: {} } });
if (!process.env.NO_TOOLS) {
server.setRequestHandler(ListToolsRequestSchema, async () => { if (process.env.TOOLS_DELAY) await new Promise(resolve => setTimeout(resolve, Number(process.env.TOOLS_DELAY))); return { tools: [{ name: refreshed && process.env.REFRESH_TOOL_NAME ? process.env.REFRESH_TOOL_NAME : process.env.TOOL_NAME || 'lookup', title: 'Original title', description: 'Lookup', inputSchema: ${JSON.stringify(inputSchema)}, outputSchema: { type: 'object', properties: { owner: { type: 'string' } }, required: ['owner'] }, annotations: { readOnlyHint: true }, _meta: { original: true } }] }; });
server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
    if (request.params.arguments?.value === 'valid-refresh') { refreshed = true; await server.notification({ method: 'notifications/tools/list_changed' }); }
    if (request.params.arguments?.value === 'valid-wait') {
        writeFileSync(process.env.MARKER + '.started', 'started');
        await new Promise(resolve => extra.signal.addEventListener('abort', () => { writeFileSync(process.env.MARKER + '.cancelled', 'cancelled'); resolve(); }, { once: true }));
    }
    return { isError: true, content: [{ type: 'text', text: identity }], structuredContent: { owner: identity }, _meta: { original: true } };
});
}
server.setRequestHandler(ListResourcesRequestSchema, async () => { return { resources: Array.from({ length: process.env.DUPLICATE_RESOURCE ? 2 : 1 }, () => ({ uri: 'fixture://data', name: 'Data', description: 'Raw resource', mimeType: 'text/plain', _meta: { original: true } })) }; });
server.setRequestHandler(ReadResourceRequestSchema, async () => ({ contents: [{ uri: 'fixture://data', text: identity }] }));
server.setRequestHandler(ListPromptsRequestSchema, async () => ({ prompts: [{ name: process.env.PROMPT_NAME || 'greet', description: 'Original prompt', arguments: [{ name: 'person', required: true }], _meta: { original: true } }] }));
server.setRequestHandler(GetPromptRequestSchema, async request => ({ description: 'Original result', messages: [{ role: 'user', content: { type: 'text', text: request.params.arguments?.person || 'missing' } }] }));
await server.connect(new StdioServerTransport());
`
    );
});

afterEach(async () => {
    await Promise.allSettled(clients.splice(0).map((client) => client.close()));
    await Promise.allSettled(servers.splice(0).map((server) => server.close()));
    await Promise.allSettled(gateways.splice(0).map((gateway) => gateway.close()));
    // Clean up only fixture-owned children when running regressions against the old host.
    for (const identity of identities) {
        try {
            process.kill(
                Number(await readFile(join(directory, `${identity}.pid`), 'utf8')),
                'SIGTERM'
            );
        } catch (error) {
            if (
                !(
                    error instanceof Error &&
                    'code' in error &&
                    (error.code === 'ESRCH' || error.code === 'ENOENT')
                )
            )
                throw error;
        }
    }
    identities.clear();
});
afterAll(async () => {
    await rm(directory, { recursive: true, force: true });
});

function config(identity: string, env: Record<string, string> = {}) {
    identities.add(identity);
    return {
        type: 'stdio',
        command: process.execPath,
        args: [fixture],
        env: { IDENTITY: identity, MARKER: join(directory, identity), ...env },
        timeout: 1000,
    };
}
async function connect(configs: ValidatedServersConfig, strict = false) {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const server = await initializeMcpToolAggregationServer(
        configs,
        serverTransport,
        'aggregation',
        '1.0.0',
        strict
    );
    servers.push(server);
    const client = new Client({ name: 'test-client', version: '1.0.0' });
    clients.push(client);
    await client.connect(clientTransport);
    return { client, server, serverTransport };
}

describe('MCP aggregation protocol', () => {
    it('shares upstream ownership across independent peers without closing siblings', async () => {
        const host = await initializeMcpToolAggregationHost(
            ServersConfigSchema.parse({ first: config('shared-first') }),
            'aggregation',
            '1.0.0',
            false
        );
        try {
            for (let index = 0; index < 2; index++) {
                const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
                servers.push(await host.connect(serverTransport));
                const client = new Client({ name: `peer-${index}`, version: '1.0.0' });
                clients.push(client);
                await client.connect(clientTransport);
            }
            const [first, second] = clients;
            expect(first).toBeDefined();
            expect(second).toBeDefined();
            assert(first && second);
            await first.close();
            expect((await second.listTools()).tools).toHaveLength(1);
            expect(
                await second.callTool({ name: 'lookup', arguments: { value: 2 } })
            ).toMatchObject({ structuredContent: { owner: 'shared-first' } });
            await Promise.all([host.close(), host.close()]);
            await expect(readFile(join(directory, 'shared-first'), 'utf8')).resolves.toBe('closed');
            await expect(host.connect(InMemoryTransport.createLinkedPair()[1])).rejects.toThrow();
        } finally {
            await host.close();
        }
    });
    it('serves independent HTTP clients and preserves upstream results after a peer closes', async () => {
        const gateway = await startMcpHttpAggregationGateway(
            ServersConfigSchema.parse({ first: config('http-first') }),
            {
                name: 'aggregation',
                version: '1.0.0',
                strict: false,
                host: '127.0.0.1',
                port: 0,
                authorize: (header) =>
                    header === 'Bearer fixture-key'
                        ? { allowed: true }
                        : {
                              allowed: false,
                              status: 401,
                              body: { error: 'Unauthorized', message: 'Missing or invalid token' },
                          },
            }
        );
        gateways.push(gateway);
        const url = new URL(`http://127.0.0.1:${gateway.port}/mcp`);
        for (const method of ['POST', 'GET', 'DELETE']) {
            expect((await fetch(url, { method })).status).toBe(401);
        }
        expect(
            (await fetch(url, { method: 'GET', headers: { authorization: 'Bearer fixture-key' } }))
                .status
        ).toBe(405);
        for (const headers of [
            { authorization: 'Bearer fixture-key', host: 'attacker.example' },
            { authorization: 'Bearer fixture-key', origin: 'http://attacker.example' },
        ]) {
            const status = await new Promise<number | undefined>((resolve, reject) => {
                const request = httpRequest(url, { method: 'POST', headers }, (response) => {
                    response.resume();
                    response.once('end', () => resolve(response.statusCode));
                });
                request.once('error', reject);
                request.end();
            });
            expect(status).toBe(403);
        }
        for (let index = 0; index < 2; index++) {
            const client = new Client({ name: `http-peer-${index}`, version: '1.0.0' });
            clients.push(client);
            // SDK sessionId getters include undefined, unlike Transport's optional property
            // under exactOptionalPropertyTypes; keep the real HTTP transport at this boundary.
            await client.connect(
                new StreamableHTTPClientTransport(url, {
                    requestInit: { headers: { authorization: 'Bearer fixture-key' } },
                }) as Transport
            );
        }
        const [first, second] = clients;
        expect(first).toBeDefined();
        expect(second).toBeDefined();
        assert(first && second);
        expect((await first.listTools()).tools[0]?.inputSchema).toEqual(inputSchema);
        await first.close();
        expect(await second.callTool({ name: 'lookup', arguments: { value: 2 } })).toEqual({
            isError: true,
            content: [{ type: 'text', text: 'http-first' }],
            structuredContent: { owner: 'http-first' },
            _meta: { original: true },
        });
        expect((await second.listResources()).resources).toHaveLength(1);
        expect(
            (await second.getPrompt({ name: 'greet', arguments: { person: 'Ada' } })).messages[0]
                ?.content
        ).toEqual({ type: 'text', text: 'Ada' });
        await Promise.all([gateway.close(), gateway.close()]);
        await expect(readFile(join(directory, 'http-first'), 'utf8')).resolves.toBe('closed');
        await expect(fetch(url)).rejects.toThrow();
    });
    it('cancels a disconnected HTTP request without stopping the shared upstream', async () => {
        const gateway = await startMcpHttpAggregationGateway(
            ServersConfigSchema.parse({ first: { ...config('http-cancel'), timeout: 10000 } }),
            {
                name: 'aggregation',
                version: '1.0.0',
                strict: false,
                host: '127.0.0.1',
                port: 0,
                authorize: () => ({ allowed: true }),
            }
        );
        gateways.push(gateway);
        const url = new URL(`http://127.0.0.1:${gateway.port}/mcp`);
        const controller = new AbortController();
        const pending = fetch(url, {
            method: 'POST',
            signal: controller.signal,
            headers: {
                'content-type': 'application/json',
                accept: 'application/json, text/event-stream',
                'mcp-protocol-version': '2025-03-26',
            },
            body: JSON.stringify({
                jsonrpc: '2.0',
                id: 1,
                method: 'tools/call',
                params: { name: 'lookup', arguments: { value: 'valid-wait' } },
            }),
        }).catch((error) => error);
        await expect
            .poll(() => readFile(join(directory, 'http-cancel.started'), 'utf8').catch(() => ''))
            .toBe('started');
        controller.abort();
        await pending;
        await expect
            .poll(() => readFile(join(directory, 'http-cancel.cancelled'), 'utf8').catch(() => ''))
            .toBe('cancelled');
        const client = new Client({ name: 'remaining-peer', version: '1.0.0' });
        clients.push(client);
        await client.connect(new StreamableHTTPClientTransport(url) as Transport);
        expect((await client.listTools()).tools).toHaveLength(1);
    });
    it('rolls back upstream ownership when its HTTP listener cannot bind', async () => {
        const occupied = createServer();
        await new Promise<void>((resolve) => occupied.listen(0, '127.0.0.1', resolve));
        try {
            const address = occupied.address();
            expect(address).not.toBeNull();
            assert(address && typeof address !== 'string');
            await expect(
                startMcpHttpAggregationGateway(
                    ServersConfigSchema.parse({ first: config('http-bind-failure') }),
                    {
                        name: 'aggregation',
                        version: '1.0.0',
                        strict: false,
                        host: '127.0.0.1',
                        port: address.port,
                        authorize: () => ({ allowed: true }),
                    }
                )
            ).rejects.toMatchObject({ code: 'EADDRINUSE' });
            await expect(readFile(join(directory, 'http-bind-failure'), 'utf8')).resolves.toBe(
                'closed'
            );
        } finally {
            await new Promise<void>((resolve, reject) =>
                occupied.close((error) => (error ? reject(error) : resolve()))
            );
        }
    });
    it('settles admitted transport startup before host shutdown and never returns a closed peer', async () => {
        const host = await initializeMcpToolAggregationHost(
            ServersConfigSchema.parse({ first: config('pending-peer') }),
            'aggregation',
            '1.0.0',
            false
        );
        const [, transport] = InMemoryTransport.createLinkedPair();
        let releaseStart = () => {};
        const gate = new Promise<void>((resolve) => {
            releaseStart = resolve;
        });
        let started = () => {};
        const entered = new Promise<void>((resolve) => {
            started = resolve;
        });
        const originalStart = transport.start.bind(transport);
        transport.start = async () => {
            started();
            await gate;
            await originalStart();
        };
        const connecting = host.connect(transport);
        try {
            await entered;
            const closing = host.close();
            releaseStart();
            await expect(connecting).rejects.toThrow('closing');
            await closing;
            await expect(readFile(join(directory, 'pending-peer'), 'utf8')).resolves.toBe('closed');
        } finally {
            releaseStart();
            await connecting.catch(() => undefined);
            await host.close();
        }
    });
    it('strict startup rejects failed enabled servers and closes acquired connections without mutating config', async () => {
        const configs = ServersConfigSchema.parse({
            first: config('strict-first'),
            unavailable: {
                type: 'stdio',
                command: process.execPath,
                args: ['-e', 'process.exit(1)'],
                timeout: 1000,
            },
        });
        const original = structuredClone(configs);
        await expect(connect(configs, true)).rejects.toThrow();
        expect(configs).toEqual(original);
        await expect(readFile(join(directory, 'strict-first'), 'utf8')).resolves.toBe('closed');
    });
    it('keeps lenient successes and closes their processes on repeated explicit and transport close', async () => {
        const { client, server } = await connect(
            ServersConfigSchema.parse({
                first: config('close-first'),
                unavailable: {
                    type: 'stdio',
                    command: process.execPath,
                    args: ['-e', 'process.exit(1)'],
                    timeout: 1000,
                },
            })
        );
        expect((await client.listTools()).tools).toHaveLength(1);
        await client.close();
        await expect
            .poll(async () => {
                try {
                    return await readFile(join(directory, 'close-first'), 'utf8');
                } catch {
                    return undefined;
                }
            })
            .toBe('closed');
        await Promise.all([server.close(), server.close()]);
        await expect(readFile(join(directory, 'close-first'), 'utf8')).resolves.toBe('closed');
    });
    it('preserves raw tool schemas, metadata and structured error results', async () => {
        const { client } = await connect(ServersConfigSchema.parse({ first: config('raw-first') }));
        const { tools } = await client.listTools();
        expect(tools).toEqual([
            {
                name: 'lookup',
                title: 'Original title',
                description: 'Lookup',
                inputSchema,
                outputSchema: {
                    type: 'object',
                    properties: { owner: { type: 'string' } },
                    required: ['owner'],
                },
                annotations: { readOnlyHint: true },
                _meta: { original: true },
            },
        ]);
        expect(await client.callTool({ name: 'lookup', arguments: { value: 2 } })).toEqual({
            isError: true,
            content: [{ type: 'text', text: 'raw-first' }],
            structuredContent: { owner: 'raw-first' },
            _meta: { original: true },
        });
    });
    it('preserves prompt arguments and resource metadata with qualified resource routing', async () => {
        const { client } = await connect(
            ServersConfigSchema.parse({ first: config('capabilities-first') })
        );
        expect((await client.listPrompts()).prompts).toEqual([
            {
                name: 'greet',
                description: 'Original prompt',
                arguments: [{ name: 'person', required: true }],
                _meta: { original: true },
            },
        ]);
        expect(await client.getPrompt({ name: 'greet', arguments: { person: 'Ada' } })).toEqual({
            description: 'Original result',
            messages: [{ role: 'user', content: { type: 'text', text: 'Ada' } }],
        });
        expect((await client.listResources()).resources).toEqual([
            {
                uri: 'mcp:first:fixture://data',
                name: 'Data',
                description: 'Raw resource',
                mimeType: 'text/plain',
                _meta: { original: true },
            },
        ]);
        expect(await client.readResource({ uri: 'mcp:first:fixture://data' })).toEqual({
            contents: [{ uri: 'fixture://data', text: 'capabilities-first' }],
        });
    });
    it('discovers resources and prompts from an upstream without a tools capability', async () => {
        const { client } = await connect(
            ServersConfigSchema.parse({ first: config('resource-only', { NO_TOOLS: '1' }) })
        );
        expect((await client.listTools()).tools).toEqual([]);
        expect((await client.listResources()).resources).toEqual([
            {
                uri: 'mcp:first:fixture://data',
                name: 'Data',
                description: 'Raw resource',
                mimeType: 'text/plain',
                _meta: { original: true },
            },
        ]);
        expect(await client.readResource({ uri: 'mcp:first:fixture://data' })).toEqual({
            contents: [{ uri: 'fixture://data', text: 'resource-only' }],
        });
        expect((await client.listPrompts()).prompts[0]?.arguments).toEqual([
            { name: 'person', required: true },
        ]);
        expect(await client.getPrompt({ name: 'greet', arguments: { person: 'Ada' } })).toEqual({
            description: 'Original result',
            messages: [{ role: 'user', content: { type: 'text', text: 'Ada' } }],
        });
    });
    it('rejects duplicate prompt identities and rolls back every connected upstream', async () => {
        await expect(
            connect(
                ServersConfigSchema.parse({
                    first: config('duplicate-first'),
                    second: config('duplicate-second'),
                })
            )
        ).rejects.toThrow('Duplicate aggregation prompt identity');
        for (const identity of ['duplicate-first', 'duplicate-second']) {
            await expect(readFile(join(directory, identity), 'utf8')).resolves.toBe('closed');
        }
    });
    it('forwards cancellation to the active upstream request', async () => {
        const { client } = await connect(
            ServersConfigSchema.parse({ first: config('cancel-first') })
        );
        const controller = new AbortController();
        const request = client.callTool(
            { name: 'lookup', arguments: { value: 'valid-wait' } },
            undefined,
            { signal: controller.signal }
        );
        const rejected = expect(request).rejects.toThrow();
        await expect
            .poll(async () => {
                try {
                    return await readFile(join(directory, 'cancel-first.started'), 'utf8');
                } catch {
                    return undefined;
                }
            })
            .toBe('started');
        controller.abort();
        await rejected;
        await expect
            .poll(async () => {
                try {
                    return await readFile(join(directory, 'cancel-first.cancelled'), 'utf8');
                } catch {
                    return undefined;
                }
            })
            .toBe('cancelled');
    });

    it('keeps conflicting tool aliases bound to the owning upstream', async () => {
        const { client } = await connect(
            ServersConfigSchema.parse({
                first: config('bound-first', { PROMPT_NAME: 'first-prompt' }),
                second: config('bound-second', { PROMPT_NAME: 'second-prompt' }),
            })
        );
        expect((await client.listTools()).tools.map((tool) => tool.name).sort()).toEqual([
            'first--lookup',
            'second--lookup',
        ]);
        for (const { name, identity } of [
            { name: 'first--lookup', identity: 'bound-first' },
            { name: 'second--lookup', identity: 'bound-second' },
        ]) {
            expect(await client.callTool({ name, arguments: { value: 2 } })).toMatchObject({
                isError: true,
                structuredContent: { owner: identity },
            });
        }
    });

    it('rejects raw tool identities that were lost through manager alias collision', async () => {
        await expect(
            connect(
                ServersConfigSchema.parse({
                    first: config('alias-first', {
                        PROMPT_NAME: 'first-prompt',
                        TOOLS_DELAY: '200',
                    }),
                    second: config('alias-second', {
                        PROMPT_NAME: 'second-prompt',
                        TOOLS_DELAY: '300',
                    }),
                    third: config('alias-third', {
                        PROMPT_NAME: 'third-prompt',
                        TOOL_NAME: 'first--lookup',
                    }),
                })
            )
        ).rejects.toThrow('Ambiguous aggregation tool aliases');
    });
    it('rejects server prefix collisions detected by the manager even in lenient mode', async () => {
        await expect(
            connect(
                ServersConfigSchema.parse({
                    'same.name': config('prefix-first'),
                    same_name: config('prefix-second'),
                })
            )
        ).rejects.toThrow('Duplicate upstream server identity');
        for (const identity of ['prefix-first', 'prefix-second']) {
            await expect(readFile(join(directory, identity), 'utf8')).resolves.toBe('closed');
        }
    });
    it('retains advertised tool ownership when upstream notifications alter manager aliases', async () => {
        const { client } = await connect(
            ServersConfigSchema.parse({
                first: config('snapshot-first', { PROMPT_NAME: 'first-prompt' }),
                second: config('snapshot-second', {
                    PROMPT_NAME: 'second-prompt',
                    REFRESH_TOOL_NAME: 'first--lookup',
                }),
            })
        );
        let refreshComplete = false;
        const onRefresh = (event: { serverName: string }) => {
            if (event.serverName === 'second') refreshComplete = true;
        };
        eventBus.on('mcp:tools-list-changed', onRefresh);
        try {
            await client.callTool({
                name: 'second--lookup',
                arguments: { value: 'valid-refresh' },
            });
            await expect.poll(() => refreshComplete).toBe(true);
        } finally {
            eventBus.off('mcp:tools-list-changed', onRefresh);
        }
        expect((await client.listTools()).tools.map((tool) => tool.name).sort()).toEqual([
            'first--lookup',
            'second--lookup',
        ]);
        expect(
            await client.callTool({ name: 'first--lookup', arguments: { value: 2 } })
        ).toMatchObject({ structuredContent: { owner: 'snapshot-first' } });
    });

    it('rolls back upstream ownership when downstream transport startup fails', async () => {
        const [, transport] = InMemoryTransport.createLinkedPair();
        const failure = new Error('downstream startup failed');
        transport.start = async () => {
            throw failure;
        };
        await expect(
            initializeMcpToolAggregationServer(
                ServersConfigSchema.parse({ first: config('transport-first') }),
                transport,
                'aggregation',
                '1.0.0',
                false
            )
        ).rejects.toBe(failure);
        await expect(readFile(join(directory, 'transport-first'), 'utf8')).resolves.toBe('closed');
    });

    it('still releases upstreams when downstream close fails', async () => {
        const { server, serverTransport } = await connect(
            ServersConfigSchema.parse({ first: config('close-error-first') })
        );
        serverTransport.close = async () => {
            throw new Error('downstream close failed');
        };
        await expect(server.close()).rejects.toThrow('MCP aggregation cleanup failed');
        await expect(readFile(join(directory, 'close-error-first'), 'utf8')).resolves.toBe(
            'closed'
        );
        await expect(server.close()).rejects.toThrow('MCP aggregation cleanup failed');
    });
    it('rejects duplicate raw resource URIs instead of silently dropping metadata', async () => {
        await expect(
            connect(
                ServersConfigSchema.parse({
                    first: config('resource-duplicate', { DUPLICATE_RESOURCE: '1' }),
                })
            )
        ).rejects.toThrow('Duplicate upstream resource identity');
        await expect(readFile(join(directory, 'resource-duplicate'), 'utf8')).resolves.toBe(
            'closed'
        );
    });
    it('keeps disabled servers disabled during strict startup', async () => {
        const { client } = await connect(
            ServersConfigSchema.parse({
                first: config('enabled-first'),
                disabled: { ...config('disabled-second'), enabled: false },
            }),
            true
        );
        expect((await client.listTools()).tools).toHaveLength(1);
        await expect(
            readFile(join(directory, 'disabled-second.pid'), 'utf8')
        ).rejects.toMatchObject({ code: 'ENOENT' });
    });
});

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ServersConfigSchema, type ValidatedServersConfig } from '@dexto/core/mcp';
import { eventBus } from '@dexto/core/events';
import { initializeMcpToolAggregationServer } from './tool-aggregation-handler.js';

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
const server = new Server({ name: identity, version: '1.0.0' }, { capabilities: { tools: {}, resources: {}, prompts: {} } });
server.setRequestHandler(ListToolsRequestSchema, async () => { if (process.env.TOOLS_DELAY) await new Promise(resolve => setTimeout(resolve, Number(process.env.TOOLS_DELAY))); return { tools: [{ name: refreshed && process.env.REFRESH_TOOL_NAME ? process.env.REFRESH_TOOL_NAME : process.env.TOOL_NAME || 'lookup', title: 'Original title', description: 'Lookup', inputSchema: ${JSON.stringify(inputSchema)}, outputSchema: { type: 'object', properties: { owner: { type: 'string' } }, required: ['owner'] }, annotations: { readOnlyHint: true }, _meta: { original: true } }] }; });
server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
    if (request.params.arguments?.value === 'valid-refresh') { refreshed = true; await server.notification({ method: 'notifications/tools/list_changed' }); }
    if (request.params.arguments?.value === 'valid-wait') {
        writeFileSync(process.env.MARKER + '.started', 'started');
        await new Promise(resolve => extra.signal.addEventListener('abort', () => { writeFileSync(process.env.MARKER + '.cancelled', 'cancelled'); resolve(); }, { once: true }));
    }
    return { isError: true, content: [{ type: 'text', text: identity }], structuredContent: { owner: identity }, _meta: { original: true } };
});
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

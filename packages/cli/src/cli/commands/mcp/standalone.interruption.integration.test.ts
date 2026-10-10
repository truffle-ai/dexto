import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { stringify } from 'yaml';

const require = createRequire(import.meta.url);
const tsx = require.resolve('tsx');
const entrypoint = fileURLToPath(new URL('../../../index.ts', import.meta.url));
let directory: string;
let fixture: string;
beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), 'dexto-mcp-interruption-'));
    fixture = join(directory, 'fixture.mjs');
    const sdk = (path: string) =>
        JSON.stringify(pathToFileURL(require.resolve(`@modelcontextprotocol/sdk/${path}`)).href);
    await writeFile(
        fixture,
        `
import { appendFileSync, existsSync, writeFileSync } from 'node:fs';
import { McpServer } from ${sdk('server/mcp.js')};
import { StdioServerTransport } from ${sdk('server/stdio.js')};
import { ListToolsRequestSchema } from ${sdk('types.js')};
writeFileSync(process.env.MCP_PID_FILE, String(process.pid));
setInterval(() => {}, 1000);
process.stdin.on('end', () => appendFileSync(process.env.MCP_EVENTS_FILE, 'eof\\n'));
const server = new McpServer({ name: 'interruption-fixture', version: '1.0.0' });
const event = text => appendFileSync(process.env.MCP_EVENTS_FILE, text + '\\n');
async function waitForRelease() {
    event('startup-blocked');
    while (!existsSync(process.env.MCP_RELEASE_FILE)) await new Promise(resolve => setTimeout(resolve, 20));
}
async function operation() {
    event('operation-started');
    event('call-started');
    await new Promise(resolve => setTimeout(resolve, process.env.MCP_RESULT_MODE ? 20 : 90000));
}
server.tool('wait', {}, async () => {
    await operation();
    return { ...(process.env.MCP_RESULT_MODE === 'error' ? { isError: true } : {}), content: [{ type: 'text', text: 'done' }] };
});
server.resource('wait', 'fixture://wait', async uri => {
    await operation();
    return { contents: [{ uri: uri.href, text: 'done' }] };
});
server.prompt('wait', {}, async () => {
    await operation();
    return { messages: [{ role: 'user', content: { type: 'text', text: 'done' } }] };
});
if (process.env.MCP_STARTUP_GATE === 'discovery') server.server.setRequestHandler(ListToolsRequestSchema, async () => {
    await waitForRelease();
    return { tools: [{ name: 'wait', inputSchema: { type: 'object', properties: {} } }] };
});
const transport = new StdioServerTransport();
const start = transport.start.bind(transport);
transport.start = async () => {
    const onmessage = transport.onmessage;
    transport.onmessage = (message, extra) => {
        if (message.method === 'notifications/cancelled') event('cancelled');
        if (message.method === 'initialize' && process.env.MCP_STARTUP_GATE === 'handshake') {
            void waitForRelease().then(() => onmessage?.call(transport, message, extra));
        } else onmessage?.call(transport, message, extra);
    };
    await start();
};
await server.connect(transport);
`
    );
});
afterAll(async () => {
    await rm(directory, { recursive: true, force: true });
});

function alive(pid: number): boolean {
    try {
        process.kill(pid, 0);
        return true;
    } catch {
        return false;
    }
}
function stopOwnedProcesses(cli: ChildProcess, childPid: number): void {
    if (cli.pid !== undefined && alive(cli.pid)) cli.kill('SIGKILL');
    if (alive(childPid)) process.kill(childPid, 'SIGKILL');
}
async function waitForEvent(path: string, event: string): Promise<void> {
    for (let attempt = 0; attempt < 200; attempt++) {
        try {
            if ((await readFile(path, 'utf8')).includes(event)) return;
        } catch {
            /* fixture not started */
        }
        await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error(`Fixture did not report ${event}`);
}
async function waitForClose<T>(closed: Promise<T>): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
        return await Promise.race([
            closed,
            new Promise<never>((_resolve, reject) => {
                timer = setTimeout(
                    () => reject(new Error('Owned CLI did not close its pipes')),
                    8000
                );
            }),
        ]);
    } finally {
        if (timer !== undefined) clearTimeout(timer);
    }
}
async function startCall(
    operation: 'call' | 'read-resource' | 'get-prompt' = 'call',
    startupGate?: 'handshake' | 'discovery',
    resultMode?: 'success' | 'error'
): Promise<{
    cli: ChildProcess;
    childPid: number;
    eventsFile: string;
    releaseFile: string;
    closed: Promise<{
        code: number | null;
        signal: NodeJS.Signals | null;
        stdout: string;
        stderr: string;
    }>;
}> {
    const ownDirectory = await mkdtemp(join(directory, 'run-'));
    const config = join(ownDirectory, 'mcp.yml');
    const pidFile = join(ownDirectory, 'pid');
    const eventsFile = join(ownDirectory, 'events');
    const releaseFile = join(ownDirectory, 'release');
    await writeFile(
        config,
        stringify({
            mcpServers: {
                owned: {
                    type: 'stdio',
                    command: process.execPath,
                    args: [fixture],
                    timeout: 120000,
                },
            },
        })
    );
    const operationArgs =
        operation === 'read-resource'
            ? ['read-resource', 'owned', 'fixture://wait']
            : [operation, 'owned', 'wait', '--arguments', '{}'];
    const cli = spawn(
        process.execPath,
        ['--import', tsx, entrypoint, 'mcp', ...operationArgs, '--config', config, '--json'],
        {
            cwd: ownDirectory,
            env: {
                PATH: process.env.PATH,
                HOME: ownDirectory,
                USERPROFILE: ownDirectory,
                DEXTO_DEV_MODE: 'false',
                DEXTO_ANALYTICS_DISABLED: '1',
                DEXTO_LLM_REGISTRY_DISABLE_FETCH: '1',
                MCP_PID_FILE: pidFile,
                MCP_EVENTS_FILE: eventsFile,
                MCP_RELEASE_FILE: releaseFile,
                ...(startupGate ? { MCP_STARTUP_GATE: startupGate } : {}),
                ...(resultMode ? { MCP_RESULT_MODE: resultMode } : {}),
            },
            stdio: ['ignore', 'pipe', 'pipe'],
        }
    );
    let stdout = '',
        stderr = '';
    cli.stdout?.on('data', (chunk) => {
        stdout += chunk;
    });
    cli.stderr?.on('data', (chunk) => {
        stderr += chunk;
    });
    const closed = new Promise<{
        code: number | null;
        signal: NodeJS.Signals | null;
        stdout: string;
        stderr: string;
    }>((resolve, reject) => {
        cli.once('error', reject);
        cli.once('close', (code, signal) => resolve({ code, signal, stdout, stderr }));
    });
    try {
        await waitForEvent(eventsFile, startupGate ? 'startup-blocked' : 'operation-started');
        return {
            cli,
            childPid: Number(await readFile(pidFile, 'utf8')),
            eventsFile,
            releaseFile,
            closed,
        };
    } catch (error) {
        cli.kill('SIGKILL');
        try {
            process.kill(Number(await readFile(pidFile, 'utf8')), 'SIGKILL');
        } catch {
            /* owned fixture absent */
        }
        throw error;
    }
}

it.skipIf(process.platform === 'win32')(
    'closes its owned stdio child and returns JSON after SIGTERM',
    async () => {
        const { cli, childPid, closed } = await startCall();
        try {
            cli.kill('SIGTERM');
            const result = await waitForClose(closed);
            expect(result).toMatchObject({ code: 143, signal: null, stderr: '' });
            expect(JSON.parse(result.stdout)).toEqual({
                server: 'owned',
                signal: 'SIGTERM',
                error: { code: 'mcp_interrupted', message: 'MCP operation interrupted.' },
            });
            expect(alive(childPid)).toBe(false);
        } finally {
            stopOwnedProcesses(cli, childPid);
        }
    },
    30000
);

for (const operation of ['call', 'read-resource', 'get-prompt'] as const) {
    it.skipIf(process.platform === 'win32')(
        `cancels ${operation} after SIGINT and releases the owned child`,
        async () => {
            const { cli, childPid, eventsFile, closed } = await startCall(operation);
            try {
                cli.kill('SIGINT');
                const result = await waitForClose(closed);
                expect(result).toMatchObject({ code: 130, signal: null, stderr: '' });
                expect(JSON.parse(result.stdout)).toEqual({
                    server: 'owned',
                    signal: 'SIGINT',
                    error: { code: 'mcp_interrupted', message: 'MCP operation interrupted.' },
                });
                expect(await readFile(eventsFile, 'utf8')).toContain('cancelled');
                expect(alive(childPid)).toBe(false);
            } finally {
                stopOwnedProcesses(cli, childPid);
            }
        },
        30000
    );
}

it.skipIf(process.platform === 'win32')(
    'retains the first signal while repeated signals arrive during cleanup',
    async () => {
        const { cli, childPid, eventsFile, closed } = await startCall();
        try {
            cli.kill('SIGINT');
            await waitForEvent(eventsFile, 'cancelled');
            cli.kill('SIGTERM');
            cli.kill('SIGINT');
            const result = await waitForClose(closed);
            expect(result).toMatchObject({ code: 130, signal: null, stderr: '' });
            expect(JSON.parse(result.stdout).signal).toBe('SIGINT');
            expect(alive(childPid)).toBe(false);
        } finally {
            stopOwnedProcesses(cli, childPid);
        }
    },
    30000
);

for (const startupGate of ['handshake', 'discovery'] as const) {
    it.skipIf(process.platform === 'win32')(
        `waits for delayed ${startupGate} then skips the requested operation`,
        async () => {
            const { cli, childPid, eventsFile, releaseFile, closed } = await startCall(
                'call',
                startupGate
            );
            try {
                cli.kill('SIGTERM');
                await new Promise((resolve) => setTimeout(resolve, 100));
                expect(cli.pid !== undefined && alive(cli.pid)).toBe(true);
                expect(alive(childPid)).toBe(true);
                await writeFile(releaseFile, 'release');
                const result = await waitForClose(closed);
                expect(result).toMatchObject({ code: 143, signal: null, stderr: '' });
                expect(JSON.parse(result.stdout).error.code).toBe('mcp_interrupted');
                expect(await readFile(eventsFile, 'utf8')).not.toContain('operation-started');
                expect(alive(childPid)).toBe(false);
            } finally {
                stopOwnedProcesses(cli, childPid);
            }
        },
        30000
    );
}

for (const resultMode of ['success', 'error'] as const) {
    it.skipIf(process.platform === 'win32')(
        `preserves ${resultMode} outcomes and closes a child that ignores EOF`,
        async () => {
            const { cli, childPid, closed } = await startCall('call', undefined, resultMode);
            try {
                const result = await waitForClose(closed);
                expect(result).toMatchObject({
                    code: resultMode === 'success' ? 0 : 4,
                    signal: null,
                    stderr: '',
                });
                const output = JSON.parse(result.stdout);
                expect(output.connection).toBe('closed');
                expect(output.result.isError).toBe(resultMode === 'error' ? true : undefined);
                expect(alive(childPid)).toBe(false);
            } finally {
                stopOwnedProcesses(cli, childPid);
            }
        },
        30000
    );
}

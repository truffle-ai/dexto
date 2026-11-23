/* global ReadableStream */
import { spawn, type ChildProcess } from 'node:child_process';
import { createServer, type Server, type ServerResponse } from 'node:http';
import { access, mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable, Writable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import * as acp from '@agentclientprotocol/sdk';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

const entrypoint = fileURLToPath(new URL('../../../index.ts', import.meta.url));
const tsx = createRequire(import.meta.url).resolve('tsx');
const imageLocalUrl = new URL('../../../../../image-local/dist/index.js', import.meta.url).href;
const zodUrl = new URL(`file://${createRequire(import.meta.url).resolve('zod')}`).href;

type Chunk = { delta: Record<string, unknown>; finish_reason: string | null };

/**
 * A local OpenAI-compatible model whose reply depends on the latest user message, so each test
 * scripts its own turn. No provider credentials or remote calls.
 */
function scriptedReply(input: { messages: Array<{ role: string; content: unknown }> }): {
    chunks: Chunk[];
    delayMs: number;
} {
    const user = [...input.messages].reverse().find((message) => message.role === 'user');
    const text = JSON.stringify(user?.content ?? '');
    const toolResult = input.messages.at(-1)?.role === 'tool';
    const say = (content: string): Chunk[] => [
        { delta: { role: 'assistant', content }, finish_reason: null },
        { delta: {}, finish_reason: 'stop' },
    ];
    if (text.includes('change state')) {
        if (toolResult) return { chunks: say('state handled'), delayMs: 0 };
        return {
            chunks: [
                {
                    delta: {
                        role: 'assistant',
                        tool_calls: [
                            {
                                index: 0,
                                id: 'ordinary-call',
                                type: 'function',
                                function: {
                                    name: 'ordinary_operation',
                                    arguments: '{"path":"note.txt"}',
                                },
                            },
                        ],
                    },
                    finish_reason: null,
                },
                { delta: {}, finish_reason: 'tool_calls' },
            ],
            delayMs: 0,
        };
    }
    if (text.includes('slow')) {
        const words = Array.from({ length: 40 }, (_, i) => ({
            delta: { role: 'assistant', content: `word${i} ` },
            finish_reason: null,
        }));
        return { chunks: [...words, { delta: {}, finish_reason: 'stop' }], delayMs: 150 };
    }
    return {
        chunks: [
            { delta: { role: 'assistant', content: 'hello ' }, finish_reason: null },
            { delta: { role: 'assistant', content: 'there' }, finish_reason: null },
            { delta: {}, finish_reason: 'stop' },
        ],
        delayMs: 0,
    };
}

async function streamReply(response: ServerResponse, chunks: Chunk[], delayMs: number) {
    response.writeHead(200, { 'Content-Type': 'text/event-stream' });
    for (const choice of chunks) {
        if (response.destroyed) return;
        response.write(
            `data: ${JSON.stringify({
                id: 'acp',
                object: 'chat.completion.chunk',
                created: 1,
                model: 'acp-model',
                choices: [{ index: 0, ...choice }],
            })}\n\n`
        );
        if (delayMs > 0) await new Promise((done) => setTimeout(done, delayMs));
    }
    response.end('data: [DONE]\n\n');
}

type Recorded = {
    updates: acp.SessionUpdate[];
    permissions: acp.RequestPermissionRequest[];
    /** Tool-call updates and permission requests in arrival order. */
    order: string[];
};

describe('dexto acp over stdio', () => {
    let server: Server;
    let directory: string;
    let otherDirectory: string;
    let home: string;
    let configPath: string;
    let effectPath: string;
    const children: ChildProcess[] = [];

    beforeAll(async () => {
        server = createServer(async (request, response) => {
            let body = '';
            for await (const chunk of request) body += chunk;
            const { chunks, delayMs } = scriptedReply(JSON.parse(body));
            await streamReply(response, chunks, delayMs);
        });
        await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
        const address = server.address();
        if (!address || typeof address === 'string') throw new Error('Expected a TCP address');
        directory = await mkdtemp(join(tmpdir(), 'dexto-acp-'));
        directory = await realpath(directory);
        home = join(directory, 'home');
        await mkdir(home);
        otherDirectory = join(directory, 'other');
        await mkdir(otherDirectory);
        effectPath = join(directory, 'effect');
        const imagePath = join(directory, 'image.mjs');
        await writeFile(
            imagePath,
            `
import imageLocal from ${JSON.stringify(imageLocalUrl)};
import { z } from ${JSON.stringify(zodUrl)};
import { writeFile } from 'node:fs/promises';
export default {
    ...imageLocal,
    tools: {
        ...imageLocal.tools,
        'ordinary-tools': {
            configSchema: z.object({ type: z.literal('ordinary-tools') }).strict(),
            create: () => [{
                id: 'ordinary_operation',
                description: 'Changes local state after approval',
                inputSchema: z.object({ path: z.string().optional() }).strict(),
                needsApproval: true,
                execute: async () => {
                    await writeFile(${JSON.stringify(effectPath)}, 'effect');
                    return 'effect written in ' + process.cwd();
                },
            }],
        },
    },
};
`
        );
        configPath = join(directory, 'agent.yml');
        await writeFile(
            configPath,
            `image: ${JSON.stringify(imagePath)}
systemPrompt: Answer briefly.
permissions:
  mode: asks-you
llm:
  provider: openai-compatible
  model: acp-model
  apiKey: acp-key
  maxInputTokens: 32768
  baseURL: http://127.0.0.1:${address.port}/v1
storage:
  cache:
    type: in-memory
  database:
    type: in-memory
tools:
  - type: ordinary-tools
`
        );
    });

    afterEach(async () => {
        for (const child of children.splice(0)) child.kill();
        await rm(effectPath, { force: true });
    });

    afterAll(async () => {
        if (server) server.closeAllConnections();
        if (server) await new Promise<void>((done) => server.close(() => done()));
        if (directory) await rm(directory, { recursive: true, force: true });
    });

    /** Starts `dexto acp` and runs `op` as an ACP client that answers permissions with `answer`. */
    async function withAgent<T>(
        answer: (request: acp.RequestPermissionRequest) => acp.RequestPermissionResponse,
        op: (cx: acp.ClientContext, recorded: Recorded) => Promise<T>
    ): Promise<T> {
        const child = spawn(
            process.execPath,
            ['--import', tsx, entrypoint, '--agent', configPath, 'acp'],
            {
                cwd: directory,
                stdio: ['pipe', 'pipe', 'pipe'],
                env: {
                    PATH: process.env.PATH,
                    SystemRoot: process.env.SystemRoot,
                    HOME: home,
                    USERPROFILE: home,
                    DEXTO_ANALYTICS_DISABLED: '1',
                    DEXTO_FEATURE_AUTH: 'false',
                    DEXTO_DEV_MODE: 'false',
                    DEXTO_LLM_REGISTRY_DISABLE_FETCH: '1',
                },
            }
        );
        children.push(child);
        if (!child.stdin || !child.stdout) throw new Error('Expected piped stdio');
        const stream = acp.ndJsonStream(
            Writable.toWeb(child.stdin),
            Readable.toWeb(child.stdout) as ReadableStream<Uint8Array>
        );
        const recorded: Recorded = { updates: [], permissions: [], order: [] };
        return await acp
            .client({ name: 'acp-test' })
            .onNotification('session/update', ({ params }) => {
                recorded.updates.push(params.update);
                if (params.update.sessionUpdate === 'tool_call') recorded.order.push('tool_call');
            })
            .onRequest('session/request_permission', ({ params }) => {
                recorded.permissions.push(params);
                recorded.order.push('permission');
                return answer(params);
            })
            .connectWith(stream, async (cx) => {
                const init = await cx.request(acp.methods.agent.initialize, {
                    protocolVersion: acp.PROTOCOL_VERSION,
                    clientCapabilities: {},
                });
                expect(init.agentCapabilities?.loadSession).toBe(true);
                return await op(cx, recorded);
            });
    }

    const allow = (): acp.RequestPermissionResponse => ({
        outcome: { outcome: 'selected', optionId: 'allow' },
    });
    const reject = (): acp.RequestPermissionResponse => ({
        outcome: { outcome: 'selected', optionId: 'reject' },
    });

    async function newSession(cx: acp.ClientContext, cwd = directory): Promise<string> {
        const { sessionId } = await cx.request(acp.methods.agent.session.new, {
            cwd,
            mcpServers: [],
        });
        return sessionId;
    }

    function prompt(cx: acp.ClientContext, sessionId: string, text: string) {
        return cx.request(acp.methods.agent.session.prompt, {
            sessionId,
            prompt: [{ type: 'text', text }],
        });
    }

    function agentText(updates: acp.SessionUpdate[]): string {
        return updates
            .flatMap((update) =>
                update.sessionUpdate === 'agent_message_chunk' && update.content.type === 'text'
                    ? [update.content.text]
                    : []
            )
            .join('');
    }

    it('streams a reply and ends the turn', async () => {
        await withAgent(allow, async (cx, recorded) => {
            const sessionId = await newSession(cx);
            await expect(prompt(cx, sessionId, 'say hello')).resolves.toEqual({
                stopReason: 'end_turn',
            });
            expect(agentText(recorded.updates)).toBe('hello there');
        });
    }, 60000);

    it('asks permission before an approval-gated tool and runs it once allowed', async () => {
        await withAgent(allow, async (cx, recorded) => {
            const sessionId = await newSession(cx);
            await expect(prompt(cx, sessionId, 'change state')).resolves.toEqual({
                stopReason: 'end_turn',
            });
            const opened = recorded.updates.findIndex(
                (update) => update.sessionUpdate === 'tool_call'
            );
            expect(opened).toBeGreaterThanOrEqual(0);
            expect(recorded.order).toEqual(['tool_call', 'permission']);
            expect(recorded.permissions).toHaveLength(1);
            expect(recorded.permissions[0]?.toolCall.toolCallId).toBe('ordinary-call');
            expect(recorded.updates).toContainEqual(
                expect.objectContaining({
                    sessionUpdate: 'tool_call_update',
                    toolCallId: 'ordinary-call',
                    status: 'completed',
                })
            );
            await expect(access(effectPath)).resolves.toBeUndefined();
            expect(agentText(recorded.updates)).toBe('state handled');
        });
    }, 60000);

    it('fails the tool call and skips its effect when permission is rejected', async () => {
        await withAgent(reject, async (cx, recorded) => {
            const sessionId = await newSession(cx);
            await prompt(cx, sessionId, 'change state');
            expect(recorded.updates).toContainEqual(
                expect.objectContaining({
                    sessionUpdate: 'tool_call_update',
                    toolCallId: 'ordinary-call',
                    status: 'failed',
                })
            );
            await expect(access(effectPath)).rejects.toMatchObject({ code: 'ENOENT' });
        });
    }, 60000);

    it('ends a cancelled turn with the cancelled stop reason', async () => {
        await withAgent(allow, async (cx, recorded) => {
            const sessionId = await newSession(cx);
            const turn = prompt(cx, sessionId, 'slow answer');
            await expect
                .poll(() => agentText(recorded.updates).length, { timeout: 20000 })
                .toBeGreaterThan(0);
            await cx.notify(acp.methods.agent.session.cancel, { sessionId });
            await expect(turn).resolves.toEqual({ stopReason: 'cancelled' });
            expect(agentText(recorded.updates)).not.toContain('word39');
        });
    }, 60000);

    it('stops a turn cancelled before its run starts and frees the session', async () => {
        await withAgent(allow, async (cx) => {
            const sessionId = await newSession(cx);
            const turn = prompt(cx, sessionId, 'slow answer');
            await cx.notify(acp.methods.agent.session.cancel, { sessionId });
            await expect(turn).resolves.toEqual({ stopReason: 'cancelled' });
            await expect(prompt(cx, sessionId, 'say hello')).resolves.toEqual({
                stopReason: 'end_turn',
            });
        });
    }, 60000);

    it('refuses a second prompt while a turn runs and keeps the first turn intact', async () => {
        await withAgent(allow, async (cx, recorded) => {
            const sessionId = await newSession(cx);
            const first = prompt(cx, sessionId, 'slow answer');
            await expect
                .poll(() => agentText(recorded.updates).length, { timeout: 20000 })
                .toBeGreaterThan(0);
            await expect(prompt(cx, sessionId, 'say hello')).rejects.toBeInstanceOf(
                acp.RequestError
            );
            await cx.notify(acp.methods.agent.session.cancel, { sessionId });
            await expect(first).resolves.toEqual({ stopReason: 'cancelled' });
        });
    }, 60000);

    it('runs tools in the project and refuses a session in another project', async () => {
        await withAgent(allow, async (cx, recorded) => {
            const sessionId = await newSession(cx);
            await expect(newSession(cx, otherDirectory)).rejects.toBeInstanceOf(acp.RequestError);
            await expect(
                cx.request(acp.methods.agent.session.load, {
                    sessionId,
                    cwd: otherDirectory,
                    mcpServers: [],
                })
            ).rejects.toBeInstanceOf(acp.RequestError);
            await prompt(cx, sessionId, 'change state');
            expect(recorded.updates).toContainEqual(
                expect.objectContaining({
                    sessionUpdate: 'tool_call',
                    toolCallId: 'ordinary-call',
                    locations: [{ path: join(directory, 'note.txt') }],
                })
            );
            const result = recorded.updates.find(
                (update) =>
                    update.sessionUpdate === 'tool_call_update' && update.status === 'completed'
            );
            expect(JSON.stringify(result)).toContain(`effect written in ${directory}"`);
        });
    }, 60000);

    it("offers the session's model and keeps it when chosen", async () => {
        await withAgent(allow, async (cx) => {
            const created = await cx.request(acp.methods.agent.session.new, {
                cwd: directory,
                mcpServers: [],
            });
            const option = created.configOptions?.find((entry) => entry.id === 'model');
            expect(option).toMatchObject({ category: 'model', type: 'select' });
            if (option?.type !== 'select') throw new Error('Expected a select option');
            const chosen = await cx.request(acp.methods.agent.session.setConfigOption, {
                sessionId: created.sessionId,
                configId: 'model',
                value: option.currentValue,
            });
            expect(chosen.configOptions.find((entry) => entry.id === 'model')).toMatchObject({
                currentValue: option.currentValue,
            });
            await expect(
                cx.request(acp.methods.agent.session.setConfigOption, {
                    sessionId: created.sessionId,
                    configId: 'missing',
                    value: 'x',
                })
            ).rejects.toBeInstanceOf(acp.RequestError);
        });
    }, 60000);

    it('replays a session when the client loads it', async () => {
        await withAgent(allow, async (cx, recorded) => {
            const sessionId = await newSession(cx);
            await prompt(cx, sessionId, 'say hello');
            recorded.updates.length = 0;
            await cx.request(acp.methods.agent.session.load, {
                sessionId,
                cwd: directory,
                mcpServers: [],
            });
            expect(recorded.updates).toEqual([
                {
                    sessionUpdate: 'user_message_chunk',
                    content: { type: 'text', text: 'say hello' },
                },
                {
                    sessionUpdate: 'agent_message_chunk',
                    content: { type: 'text', text: 'hello there' },
                },
            ]);
        });
    }, 60000);
});

/* global ReadableStream */
import { spawn, type ChildProcess } from 'node:child_process';
import { createServer, type Server, type ServerResponse } from 'node:http';
import { access, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable, Writable } from 'node:stream';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as acp from '@agentclientprotocol/sdk';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

const entrypoint = fileURLToPath(new URL('../../../index.ts', import.meta.url));
const tsx = createRequire(import.meta.url).resolve('tsx');
const imageLocalUrl = new URL('../../../../../image-local/dist/index.js', import.meta.url).href;
const zodUrl = pathToFileURL(createRequire(import.meta.url).resolve('zod')).href;

type Chunk = { delta: Record<string, unknown>; finish_reason: string | null };

/**
 * A local OpenAI-compatible model whose reply depends on the latest user message, so each test
 * scripts its own turn. No provider credentials or remote calls.
 */
type ScriptedReply = { chunks: Chunk[]; delayMs: number };

function scriptedReply(input: {
    messages: Array<{ role: string; content: unknown }>;
}): ScriptedReply {
    const user = [...input.messages].reverse().find((message) => message.role === 'user');
    const text = JSON.stringify(user?.content ?? '');
    const toolResult = input.messages.at(-1)?.role === 'tool';
    const say = (content: string): Chunk[] => [
        { delta: { role: 'assistant', content }, finish_reason: null },
        { delta: {}, finish_reason: 'stop' },
    ];
    const callTool = (
        id: string,
        name: string,
        args: Record<string, unknown> = { path: 'note.txt' }
    ): ScriptedReply => ({
        chunks: [
            {
                delta: {
                    role: 'assistant',
                    tool_calls: [
                        {
                            index: 0,
                            id,
                            type: 'function',
                            function: { name, arguments: JSON.stringify(args) },
                        },
                    ],
                },
                finish_reason: null,
            },
            { delta: {}, finish_reason: 'tool_calls' },
        ],
        delayMs: 0,
    });
    if (text.includes('PLAN RULES')) {
        if (text.includes('keep planning')) return { chunks: say('still planning'), delayMs: 0 };
        if (toolResult) return { chunks: say('planned'), delayMs: 0 };
        return callTool('plan-call', 'plan_review', {});
    }
    if (text.includes('GREETING TEMPLATE')) return { chunks: say('greeted'), delayMs: 0 };
    if (text.includes('always ask')) {
        if (toolResult) return { chunks: say('asked'), delayMs: 0 };
        return callTool('always-call', 'always_ask_operation');
    }
    if (text.includes('change state')) {
        if (toolResult) return { chunks: say('state handled'), delayMs: 0 };
        return callTool('ordinary-call', 'ordinary_operation');
    }
    if (text.includes('edit note')) {
        if (toolResult) return { chunks: say('note edited'), delayMs: 0 };
        return callTool('edit-call', 'edit_note');
    }
    if (text.includes('ask size')) {
        if (toolResult) {
            const result = JSON.stringify(input.messages.at(-1)?.content ?? '');
            return { chunks: say(`answer was ${result}`), delayMs: 0 };
        }
        return callTool('ask-call', 'ask_user', {
            question: 'Which size?',
            schema: {
                type: 'object',
                properties: { size: { type: 'string', enum: ['small', 'large'] } },
                required: ['size'],
            },
        });
    }
    if (text.includes('real edit')) {
        if (toolResult) return { chunks: say('file edited'), delayMs: 0 };
        return callTool('real-edit-call', 'edit_file', {
            file_path: 'note.txt',
            old_string: 'old line',
            new_string: 'new line',
        });
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
    // Providers report the turn's token usage in a last chunk.
    response.write(
        `data: ${JSON.stringify({
            id: 'acp',
            object: 'chat.completion.chunk',
            created: 1,
            model: 'acp-model',
            choices: [],
            usage: { prompt_tokens: 120, completion_tokens: 2, total_tokens: 122 },
        })}\n\n`
    );
    response.end('data: [DONE]\n\n');
}

const ACCOUNT_MODELS = [
    { id: 'openai/gpt-5', name: 'GPT-5', context_window: 400000 },
    { id: 'deepseek/deepseek-v3.2', name: 'DeepSeek V3.2', context_window: 128000 },
];

const TITLE = 'Greeting From Test';
const titleReply = {
    id: 'acp-title',
    object: 'chat.completion',
    created: 1,
    model: 'acp-model',
    choices: [
        {
            index: 0,
            message: { role: 'assistant', content: TITLE },
            finish_reason: 'stop',
        },
    ],
    usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
};

type Recorded = {
    updates: acp.SessionUpdate[];
    permissions: acp.RequestPermissionRequest[];
    /** Tool-call updates and permission requests in arrival order. */
    order: string[];
    forms: acp.CreateElicitationRequest[];
    capabilities: acp.AgentCapabilities | undefined;
};

/** How the test client answers forms; without one it does not advertise form support. */
type FormAnswer = (
    request: acp.CreateElicitationRequest,
    signal: AbortSignal
) => acp.CreateElicitationResponse | Promise<acp.CreateElicitationResponse>;

describe('dexto acp over stdio', () => {
    let server: Server;
    let directory: string;
    let otherDirectory: string;
    let home: string;
    let configPath: string;
    let formTimeoutConfigPath: string;
    let persistentConfigPath: string;
    let permissionTimeoutConfigPath: string;
    let fullAccessConfigPath: string;
    let keylessConfigPath: string;
    let effectPath: string;
    const children: ChildProcess[] = [];

    beforeAll(async () => {
        server = createServer(async (request, response) => {
            if (request.method === 'GET') {
                // The Dexto account's models; nothing else is served to GET.
                if (request.url !== '/v1/models') {
                    response.writeHead(404).end();
                    return;
                }
                response.writeHead(200, { 'Content-Type': 'application/json' });
                response.end(JSON.stringify({ data: ACCOUNT_MODELS }));
                return;
            }
            let body = '';
            for await (const chunk of request) body += chunk;
            const input = JSON.parse(body);
            if (input.stream !== true) {
                // Session titles are asked for without streaming.
                // Slow enough that a second prompt can end while the first title is made.
                await new Promise((done) => setTimeout(done, 300));
                response.writeHead(200, { 'Content-Type': 'application/json' });
                response.end(JSON.stringify(titleReply));
                return;
            }
            const { chunks, delayMs } = scriptedReply(input);
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
const noteDiff = {
    type: 'diff',
    unified: '--- note.txt\\n+++ note.txt\\n@@ -1 +1 @@\\n-old line\\n+new line\\n',
    filename: 'note.txt',
    additions: 1,
    deletions: 1,
};
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
            }, {
                id: 'edit_note',
                description: 'Edits a note after approval',
                inputSchema: z.object({ path: z.string() }).strict(),
                needsApproval: true,
                presentation: {
                    activity: {
                        category: 'file-edit',
                        label: { running: 'Editing', completed: 'Edited' },
                        summary: { verb: 'Edited', singular: 'file', plural: 'files' },
                    },
                    preview: () => noteDiff,
                    result: { type: 'display', resolve: () => noteDiff },
                },
                execute: async () => 'note edited',
            }, {
                id: 'always_ask_operation',
                description: 'Asks the person every time, in every mode',
                inputSchema: z.object({ path: z.string().optional() }).strict(),
                needsApproval: { kind: 'always-ask' },
                execute: async () => 'asked and ran',
            }, {
                id: 'plan_review',
                description: 'Stands in for plan review: the plan is approved',
                inputSchema: z.object({}).strict(),
                execute: async () => ({ approved: true }),
            }],
        },
    },
};
`
        );
        const agentYaml = `image: ${JSON.stringify(imagePath)}
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
prompts:
  - type: inline
    id: dexto-plan-mode
    user-invocable: false
    prompt: PLAN RULES
  - type: inline
    id: greet
    description: Greets someone
    prompt: GREETING TEMPLATE
tools:
  - type: ordinary-tools
  - type: filesystem-tools
    enabledTools: [edit_file]
  - type: builtin-tools
    enabledTools: [ask_user]
`;
        configPath = join(directory, 'agent.yml');
        await writeFile(configPath, agentYaml);
        persistentConfigPath = join(directory, 'agent-persistent.yml');
        await writeFile(
            persistentConfigPath,
            agentYaml.replace(
                '  database:\n    type: in-memory',
                `  database:\n    type: sqlite\n    path: ${JSON.stringify(join(home, 'sessions.db'))}`
            )
        );
        permissionTimeoutConfigPath = join(directory, 'agent-permission-timeout.yml');
        await writeFile(
            permissionTimeoutConfigPath,
            agentYaml.replace('  mode: asks-you\n', '  mode: asks-you\n  timeout: 300\n')
        );
        keylessConfigPath = join(directory, 'agent-keyless.yml');
        await writeFile(
            keylessConfigPath,
            agentYaml.replace(
                /llm:\n(?: {2}.*\n)+/,
                'llm:\n  provider: anthropic\n  model: claude-sonnet-4-5-20250929\n'
            )
        );
        fullAccessConfigPath = join(directory, 'agent-full-access.yml');
        await writeFile(
            fullAccessConfigPath,
            agentYaml.replace('  mode: asks-you\n', '  mode: full-access\n')
        );
        formTimeoutConfigPath = join(directory, 'agent-form-timeout.yml');
        await writeFile(formTimeoutConfigPath, `${agentYaml}elicitation:\n  timeout: 300\n`);
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
        answer: (
            request: acp.RequestPermissionRequest,
            signal: AbortSignal
        ) => acp.RequestPermissionResponse | Promise<acp.RequestPermissionResponse>,
        op: (cx: acp.ClientContext, recorded: Recorded) => Promise<T>,
        form?: FormAnswer,
        {
            config = configPath,
            flags = [],
            env = {},
        }: { config?: string; flags?: string[]; env?: Record<string, string> } = {}
    ): Promise<T> {
        const child = spawn(
            process.execPath,
            ['--import', tsx, entrypoint, '--agent', config, ...flags, 'acp'],
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
                    ...env,
                },
            }
        );
        children.push(child);
        if (!child.stdin || !child.stdout) throw new Error('Expected piped stdio');
        const stream = acp.ndJsonStream(
            Writable.toWeb(child.stdin),
            Readable.toWeb(child.stdout) as ReadableStream<Uint8Array>
        );
        const recorded: Recorded = {
            updates: [],
            permissions: [],
            order: [],
            forms: [],
            capabilities: undefined,
        };
        return await acp
            .client({ name: 'acp-test' })
            .onNotification('session/update', ({ params }) => {
                recorded.updates.push(params.update);
                if (params.update.sessionUpdate === 'tool_call') recorded.order.push('tool_call');
            })
            .onRequest('session/request_permission', ({ params, signal }) => {
                recorded.permissions.push(params);
                recorded.order.push('permission');
                return answer(params, signal);
            })
            .onRequest('elicitation/create', ({ params, signal }) => {
                recorded.forms.push(params);
                if (!form) throw new Error('This client advertised no form support');
                return form(params, signal);
            })
            .connectWith(stream, async (cx) => {
                const init = await cx.request(acp.methods.agent.initialize, {
                    protocolVersion: acp.PROTOCOL_VERSION,
                    clientCapabilities: form ? { elicitation: { form: {} } } : {},
                });
                expect(init.agentCapabilities?.loadSession).toBe(true);
                recorded.capabilities = init.agentCapabilities;
                return await op(cx, recorded);
            });
    }

    const allow = (): acp.RequestPermissionResponse => ({
        outcome: { outcome: 'selected', optionId: 'allow' },
    });
    const reject = (): acp.RequestPermissionResponse => ({
        outcome: { outcome: 'selected', optionId: 'reject' },
    });

    function toolResultText(recorded: Recorded, toolCallId: string): string {
        return toolText(
            recorded.updates.find(
                (update) =>
                    update.sessionUpdate === 'tool_call_update' &&
                    update.toolCallId === toolCallId &&
                    (update.status === 'completed' || update.status === 'failed')
            )
        );
    }

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

    /** The text a tool result reports, as the client receives it. */
    function toolText(update: acp.SessionUpdate | undefined): string {
        if (update?.sessionUpdate !== 'tool_call_update') return '';
        return (update.content ?? [])
            .map((item) =>
                item.type === 'content' && item.content.type === 'text' ? item.content.text : ''
            )
            .join('');
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

    it('shows an edit as an ACP diff in the permission request and the result', async () => {
        await withAgent(allow, async (cx, recorded) => {
            const sessionId = await newSession(cx);
            await prompt(cx, sessionId, 'edit note');
            const diff = {
                type: 'diff',
                path: join(directory, 'note.txt'),
                oldText: 'old line\n',
                newText: 'new line\n',
            };
            expect(recorded.updates).toContainEqual(
                expect.objectContaining({
                    sessionUpdate: 'tool_call',
                    toolCallId: 'edit-call',
                    kind: 'edit',
                })
            );
            expect(recorded.permissions[0]?.toolCall).toMatchObject({
                toolCallId: 'edit-call',
                kind: 'edit',
                content: [diff],
            });
            expect(recorded.updates).toContainEqual(
                expect.objectContaining({
                    sessionUpdate: 'tool_call_update',
                    toolCallId: 'edit-call',
                    status: 'completed',
                    content: [diff],
                })
            );
        });
    }, 60000);

    it('names the file the real edit tool changes when the session sits inside a Dexto project', async () => {
        // A session in /repo/pkg under the Dexto project /repo: the workspace is /repo, and
        // edit_file resolves a relative path against it.
        const project = join(directory, 'repo');
        const sessionDirectory = join(project, 'pkg');
        await mkdir(join(project, '.dexto'), { recursive: true });
        await writeFile(join(project, '.dexto', 'deploy.json'), '{}');
        await mkdir(sessionDirectory);
        const note = join(project, 'note.txt');
        await writeFile(note, 'old line\n');
        await withAgent(allow, async (cx, recorded) => {
            const sessionId = await newSession(cx, sessionDirectory);
            await prompt(cx, sessionId, 'real edit');
            const diff = { type: 'diff', path: note, oldText: 'old line\n', newText: 'new line\n' };
            expect(recorded.updates).toContainEqual(
                expect.objectContaining({
                    sessionUpdate: 'tool_call',
                    toolCallId: 'real-edit-call',
                    kind: 'edit',
                    locations: [{ path: note }],
                })
            );
            expect(recorded.permissions[0]?.toolCall).toMatchObject({
                toolCallId: 'real-edit-call',
                content: [diff],
            });
            expect(recorded.updates).toContainEqual(
                expect.objectContaining({
                    sessionUpdate: 'tool_call_update',
                    toolCallId: 'real-edit-call',
                    status: 'completed',
                    content: [diff],
                })
            );
            await expect(readFile(note, 'utf8')).resolves.toBe('new line\n');
        });
    }, 60000);

    it("asks ask_user's question as an ACP form and returns the answer", async () => {
        await withAgent(
            allow,
            async (cx, recorded) => {
                const sessionId = await newSession(cx);
                await expect(prompt(cx, sessionId, 'ask size')).resolves.toEqual({
                    stopReason: 'end_turn',
                });
                expect(recorded.forms).toEqual([
                    expect.objectContaining({
                        mode: 'form',
                        sessionId,
                        message: 'Which size?',
                        requestedSchema: expect.objectContaining({
                            type: 'object',
                            properties: {
                                size: expect.objectContaining({
                                    type: 'string',
                                    enum: ['small', 'large'],
                                }),
                            },
                            required: ['size'],
                        }),
                    }),
                ]);
                expect(toolResultText(recorded, 'ask-call')).toContain('large');
                expect(agentText(recorded.updates)).toContain('large');
            },
            () => ({ action: 'accept', content: { size: 'large' } })
        );
    }, 60000);

    it('fails ask_user when the person declines the form', async () => {
        await withAgent(
            allow,
            async (cx, recorded) => {
                const sessionId = await newSession(cx);
                await expect(prompt(cx, sessionId, 'ask size')).resolves.toEqual({
                    stopReason: 'end_turn',
                });
                expect(recorded.forms).toHaveLength(1);
                expect(recorded.updates).toContainEqual(
                    expect.objectContaining({
                        sessionUpdate: 'tool_call_update',
                        toolCallId: 'ask-call',
                        status: 'failed',
                    })
                );
            },
            () => ({ action: 'decline' })
        );
    }, 60000);

    it('tells the model to ask in chat when the client shows no forms', async () => {
        await withAgent(allow, async (cx, recorded) => {
            const sessionId = await newSession(cx);
            await expect(prompt(cx, sessionId, 'ask size')).resolves.toEqual({
                stopReason: 'end_turn',
            });
            expect(recorded.forms).toEqual([]);
            expect(toolResultText(recorded, 'ask-call')).toMatch(/cannot show forms/i);
        });
    }, 60000);

    it('keeps ask_user off when elicitation is turned off', async () => {
        await withAgent(
            allow,
            async (cx, recorded) => {
                const sessionId = await newSession(cx);
                await expect(prompt(cx, sessionId, 'ask size')).resolves.toEqual({
                    stopReason: 'end_turn',
                });
                expect(recorded.forms).toEqual([]);
                expect(toolResultText(recorded, 'ask-call')).toMatch(/elicitation is disabled/i);
            },
            () => ({ action: 'accept', content: { size: 'large' } }),
            { flags: ['--no-elicitation'] }
        );
    }, 60000);

    it('withdraws a form left open past the elicitation timeout', async () => {
        let withdrawn = false;
        await withAgent(
            allow,
            async (cx, recorded) => {
                const sessionId = await newSession(cx);
                await expect(prompt(cx, sessionId, 'ask size')).resolves.toEqual({
                    stopReason: 'end_turn',
                });
                expect(recorded.forms).toHaveLength(1);
                expect(withdrawn).toBe(true);
                expect(toolResultText(recorded, 'ask-call')).toMatch(/timed out/i);
            },
            (_request, signal) =>
                new Promise<acp.CreateElicitationResponse>((resolve) => {
                    signal.addEventListener('abort', () => {
                        withdrawn = true;
                        resolve({ action: 'cancel' });
                    });
                }),
            { config: formTimeoutConfigPath }
        );
    }, 60000);

    it('withdraws the open form when its turn is cancelled', async () => {
        let withdrawn = false;
        await withAgent(
            allow,
            async (cx, recorded) => {
                const sessionId = await newSession(cx);
                const turn = prompt(cx, sessionId, 'ask size');
                await expect.poll(() => recorded.forms.length, { timeout: 20000 }).toBe(1);
                await cx.notify(acp.methods.agent.session.cancel, { sessionId });
                await expect(turn).resolves.toEqual({ stopReason: 'cancelled' });
                await expect.poll(() => withdrawn).toBe(true);
                await expect(prompt(cx, sessionId, 'say hello')).resolves.toEqual({
                    stopReason: 'end_turn',
                });
            },
            // The form stays open until the agent withdraws it with $/cancel_request.
            (_request, signal) =>
                new Promise<acp.CreateElicitationResponse>((resolve) => {
                    signal.addEventListener('abort', () => {
                        withdrawn = true;
                        resolve({ action: 'cancel' });
                    });
                })
        );
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

    it('withdraws a permission request left unanswered past the permissions timeout', async () => {
        let withdrawn = false;
        await withAgent(
            (_request, signal) =>
                new Promise<acp.RequestPermissionResponse>((resolve) => {
                    signal.addEventListener('abort', () => {
                        withdrawn = true;
                        resolve({ outcome: { outcome: 'cancelled' } });
                    });
                }),
            async (cx, recorded) => {
                const sessionId = await newSession(cx);
                await expect(prompt(cx, sessionId, 'change state')).resolves.toEqual({
                    stopReason: 'end_turn',
                });
                expect(recorded.permissions).toHaveLength(1);
                expect(withdrawn).toBe(true);
                expect(recorded.updates).toContainEqual(
                    expect.objectContaining({
                        sessionUpdate: 'tool_call_update',
                        toolCallId: 'ordinary-call',
                        status: 'failed',
                    })
                );
                expect(toolResultText(recorded, 'ordinary-call')).toMatch(/timed out/i);
                await expect(access(effectPath)).rejects.toMatchObject({ code: 'ENOENT' });
            },
            undefined,
            { config: permissionTimeoutConfigPath }
        );
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

    it('ends a turn cancelled while its permission request goes unanswered', async () => {
        let withdrawn = false;
        // Never answered; the agent withdraws it with $/cancel_request.
        const never = (_request: acp.RequestPermissionRequest, signal: AbortSignal) =>
            new Promise<acp.RequestPermissionResponse>(() => {
                signal.addEventListener('abort', () => {
                    withdrawn = true;
                });
            });
        await withAgent(never, async (cx, recorded) => {
            const sessionId = await newSession(cx);
            const turn = prompt(cx, sessionId, 'change state');
            await expect.poll(() => recorded.permissions.length, { timeout: 20000 }).toBe(1);
            await cx.notify(acp.methods.agent.session.cancel, { sessionId });
            await expect(turn).resolves.toEqual({ stopReason: 'cancelled' });
            await expect.poll(() => withdrawn).toBe(true);
            expect(recorded.updates).toContainEqual(
                expect.objectContaining({
                    sessionUpdate: 'tool_call_update',
                    toolCallId: 'ordinary-call',
                    status: 'failed',
                })
            );
            await expect(access(effectPath)).rejects.toMatchObject({ code: 'ENOENT' });
            await expect(prompt(cx, sessionId, 'say hello')).resolves.toEqual({
                stopReason: 'end_turn',
            });
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
            expect(toolText(result)).toBe(`effect written in ${directory}`);
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
            // The title arrives after the first prompt; wait for it so it isn't in the replay.
            await titled(recorded);
            recorded.updates.length = 0;
            await cx.request(acp.methods.agent.session.load, {
                sessionId,
                cwd: directory,
                mcpServers: [],
            });
            expect(recorded.updates.filter(isMessageChunk)).toEqual([
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

    function isMessageChunk(update: acp.SessionUpdate) {
        return (
            update.sessionUpdate === 'user_message_chunk' ||
            update.sessionUpdate === 'agent_message_chunk'
        );
    }

    async function titled(recorded: Recorded) {
        await expect
            .poll(() => recorded.updates, { timeout: 20000 })
            .toContainEqual(
                expect.objectContaining({ sessionUpdate: 'session_info_update', title: TITLE })
            );
    }

    it('titles a session after its first prompt', async () => {
        await withAgent(allow, async (cx, recorded) => {
            const sessionId = await newSession(cx);
            await prompt(cx, sessionId, 'say hello');
            // This prompt ends while the first title is still being made: one title only.
            await prompt(cx, sessionId, 'say hello');
            await titled(recorded);
            const update = recorded.updates.find((u) => u.sessionUpdate === 'session_info_update');
            expect(update).toMatchObject({ updatedAt: expect.any(String) });
            // A titled session gets no new title from later prompts.
            await prompt(cx, sessionId, 'say hello');
            await new Promise((done) => setTimeout(done, 500));
            expect(
                recorded.updates.filter((u) => u.sessionUpdate === 'session_info_update')
            ).toHaveLength(1);
        });
    }, 60000);

    it("lists and resumes the project's sessions in a later process", async () => {
        const persistent = { config: persistentConfigPath };
        const otherId = await withAgent(
            allow,
            async (cx, recorded) => {
                const sessionId = await newSession(cx, otherDirectory);
                await prompt(cx, sessionId, 'say hello');
                await titled(recorded);
                return sessionId;
            },
            undefined,
            persistent
        );
        const [titledId, emptyId] = await withAgent(
            allow,
            async (cx, recorded) => {
                const first = await newSession(cx);
                await prompt(cx, first, 'say hello');
                await titled(recorded);
                return [first, await newSession(cx)];
            },
            undefined,
            persistent
        );
        await withAgent(
            allow,
            async (cx, recorded) => {
                expect(recorded.capabilities?.sessionCapabilities).toMatchObject({
                    list: {},
                    resume: {},
                    close: {},
                });
                // Listing before any session starts the agent for the process directory.
                const { sessions } = await cx.request(acp.methods.agent.session.list, {});
                expect(sessions).toHaveLength(2);
                expect(sessions).toEqual(
                    expect.arrayContaining([
                        expect.objectContaining({
                            sessionId: titledId,
                            cwd: directory,
                            title: TITLE,
                            updatedAt: expect.any(String),
                        }),
                        expect.objectContaining({ sessionId: emptyId, cwd: directory }),
                    ])
                );
                const resumed = await cx.request(acp.methods.agent.session.resume, {
                    sessionId: titledId,
                    cwd: directory,
                });
                expect(resumed.configOptions).toBeDefined();
                // Resume restores the session without replaying it.
                expect(recorded.updates.filter(isMessageChunk)).toEqual([]);
                await expect(prompt(cx, titledId, 'say hello')).resolves.toEqual({
                    stopReason: 'end_turn',
                });
                for (const sessionId of ['missing-session', otherId]) {
                    // Another project's session is not this project's to resume.
                    await expect(
                        cx.request(acp.methods.agent.session.resume, { sessionId, cwd: directory })
                    ).rejects.toMatchObject({ code: -32002 });
                }
            },
            undefined,
            persistent
        );
    }, 120000);

    it('closes a session and cancels its running turn', async () => {
        await withAgent(allow, async (cx, recorded) => {
            const sessionId = await newSession(cx);
            const turn = prompt(cx, sessionId, 'slow answer');
            await expect
                .poll(() => agentText(recorded.updates).length, { timeout: 20000 })
                .toBeGreaterThan(0);
            await expect(
                cx.request(acp.methods.agent.session.close, { sessionId })
            ).resolves.toEqual({});
            await expect(turn).resolves.toEqual({ stopReason: 'cancelled' });
            await expect(prompt(cx, sessionId, 'say hello')).rejects.toMatchObject({
                code: -32002,
            });
            // A closed session is not titled.
            await new Promise((done) => setTimeout(done, 800));
            expect(recorded.updates).not.toContainEqual(
                expect.objectContaining({ sessionUpdate: 'session_info_update' })
            );
        });
    }, 60000);

    it('reopens a session after a close that waits for its title', async () => {
        await withAgent(allow, async (cx, recorded) => {
            const sessionId = await newSession(cx);
            await prompt(cx, sessionId, 'say hello');
            // The title is still being made, so the close waits; the session is reopened and
            // a long prompt started meanwhile, which the close must not end.
            const closed = cx.request(acp.methods.agent.session.close, { sessionId });
            await cx.request(acp.methods.agent.session.resume, { sessionId, cwd: directory });
            recorded.updates.length = 0;
            const turn = prompt(cx, sessionId, 'slow answer');
            await expect(closed).resolves.toEqual({});
            await expect(turn).resolves.toEqual({ stopReason: 'end_turn' });
            expect(agentText(recorded.updates)).toContain('word39');
            // The title was stored before the close finished; the reopened session isn't retitled.
            expect(recorded.updates).not.toContainEqual(
                expect.objectContaining({ sessionUpdate: 'session_info_update' })
            );
            const { sessions } = await cx.request(acp.methods.agent.session.list, {});
            expect(sessions).toContainEqual(expect.objectContaining({ sessionId, title: TITLE }));
        });
    }, 60000);

    it('closes a session even when a load of it is still running', async () => {
        await withAgent(allow, async (cx) => {
            const sessionId = await newSession(cx);
            await prompt(cx, sessionId, 'say hello');
            // Sent together: the load must not reopen what the close then ends.
            const loaded = cx.request(acp.methods.agent.session.load, {
                sessionId,
                cwd: directory,
                mcpServers: [],
            });
            const closed = cx.request(acp.methods.agent.session.close, { sessionId });
            await loaded;
            await expect(closed).resolves.toEqual({});
            await expect(prompt(cx, sessionId, 'say hello')).rejects.toMatchObject({
                code: -32002,
            });
        });
    }, 60000);

    it('closes a session sent right after the load that starts the agent', async () => {
        const persistent = { config: persistentConfigPath };
        const sessionId = await withAgent(
            allow,
            async (cx) => newSession(cx),
            undefined,
            persistent
        );
        await withAgent(
            allow,
            async (cx) => {
                // The load starts the agent, so the close arrives while it is still starting.
                const loaded = cx.request(acp.methods.agent.session.load, {
                    sessionId,
                    cwd: directory,
                    mcpServers: [],
                });
                const closed = cx.request(acp.methods.agent.session.close, { sessionId });
                await loaded;
                await expect(closed).resolves.toEqual({});
                await expect(prompt(cx, sessionId, 'say hello')).rejects.toMatchObject({
                    code: -32002,
                });
            },
            undefined,
            persistent
        );
    }, 120000);

    function setMode(cx: acp.ClientContext, sessionId: string, modeId: string) {
        return cx.request(acp.methods.agent.session.setMode, { sessionId, modeId });
    }

    it('offers the four permission modes, starting in Asks you', async () => {
        await withAgent(allow, async (cx) => {
            const created = await cx.request(acp.methods.agent.session.new, {
                cwd: directory,
                mcpServers: [],
            });
            expect(created.modes).toEqual({
                currentModeId: 'asks-you',
                availableModes: [
                    expect.objectContaining({ id: 'asks-you', name: 'Asks you' }),
                    expect.objectContaining({ id: 'plan', name: 'Plan' }),
                    expect.objectContaining({ id: 'accept-edits', name: 'Accept edits' }),
                    expect.objectContaining({ id: 'full-access', name: 'Full access' }),
                ],
            });
            await expect(setMode(cx, created.sessionId, 'yolo')).rejects.toMatchObject({
                code: -32602,
            });
        });
    }, 60000);

    it('offers only Full access when the agent is configured for it', async () => {
        await withAgent(
            allow,
            async (cx) => {
                const created = await cx.request(acp.methods.agent.session.new, {
                    cwd: directory,
                    mcpServers: [],
                });
                // Core approves before any mode is consulted, so no other mode would hold.
                expect(created.modes).toEqual({
                    currentModeId: 'full-access',
                    availableModes: [expect.objectContaining({ id: 'full-access' })],
                });
                await expect(setMode(cx, created.sessionId, 'asks-you')).rejects.toMatchObject({
                    code: -32602,
                });
            },
            undefined,
            { config: fullAccessConfigPath }
        );
    }, 60000);

    it('still asks for a tool that must always ask in Full access', async () => {
        await withAgent(allow, async (cx, recorded) => {
            const sessionId = await newSession(cx);
            await setMode(cx, sessionId, 'full-access');
            await prompt(cx, sessionId, 'always ask');
            expect(recorded.permissions).toHaveLength(1);
            expect(recorded.permissions[0]?.toolCall.toolCallId).toBe('always-call');
        });
    }, 60000);

    it('runs approval-gated tools without asking in Full access', async () => {
        await withAgent(allow, async (cx, recorded) => {
            const sessionId = await newSession(cx);
            await setMode(cx, sessionId, 'full-access');
            await prompt(cx, sessionId, 'change state');
            expect(recorded.permissions).toEqual([]);
            await expect(access(effectPath)).resolves.toBeUndefined();
        });
    }, 60000);

    it("accepts edits inside the session's workspace, not the process directory", async () => {
        // The process directory is /repo2/pkg (the session's cwd); the workspace is /repo2.
        const project = join(directory, 'repo2');
        const sessionDirectory = join(project, 'pkg');
        await mkdir(join(project, '.dexto'), { recursive: true });
        await writeFile(join(project, '.dexto', 'deploy.json'), '{}');
        await mkdir(sessionDirectory);
        const note = join(project, 'note.txt');
        await writeFile(note, 'old line\n');
        await withAgent(reject, async (cx, recorded) => {
            const sessionId = await newSession(cx, sessionDirectory);
            await setMode(cx, sessionId, 'accept-edits');
            await prompt(cx, sessionId, 'real edit');
            expect(recorded.permissions).toEqual([]);
            await expect(readFile(note, 'utf8')).resolves.toBe('new line\n');
            // Other approval-gated tools still ask.
            await prompt(cx, sessionId, 'change state');
            expect(recorded.permissions).toHaveLength(1);
        });
    }, 60000);

    it('adds the plan-mode instructions once and leaves Plan when the plan is approved', async () => {
        await withAgent(allow, async (cx, recorded) => {
            const sessionId = await newSession(cx);
            await setMode(cx, sessionId, 'plan');
            await prompt(cx, sessionId, 'keep planning');
            expect(agentText(recorded.updates)).toContain('still planning');
            // The next prompt in Plan goes without the instructions.
            recorded.updates.length = 0;
            await prompt(cx, sessionId, 'keep planning');
            expect(agentText(recorded.updates)).toContain('hello there');
            // Entering Plan again sends them again; an approved plan review leaves Plan.
            await setMode(cx, sessionId, 'plan');
            recorded.updates.length = 0;
            await prompt(cx, sessionId, 'make a plan');
            expect(agentText(recorded.updates)).toContain('planned');
            expect(recorded.updates).toContainEqual({
                sessionUpdate: 'current_mode_update',
                currentModeId: 'asks-you',
            });
        });
    }, 60000);

    it('lists prompts as slash commands and runs one', async () => {
        await withAgent(allow, async (cx, recorded) => {
            const sessionId = await newSession(cx);
            await expect
                .poll(() => recorded.updates, { timeout: 20000 })
                .toContainEqual(
                    expect.objectContaining({ sessionUpdate: 'available_commands_update' })
                );
            const commands = recorded.updates.find(
                (u) => u.sessionUpdate === 'available_commands_update'
            );
            expect(commands).toMatchObject({
                availableCommands: expect.arrayContaining([
                    expect.objectContaining({ name: 'greet', description: 'Greets someone' }),
                ]),
            });
            // Prompts that are not user-invocable are not commands.
            expect(JSON.stringify(commands)).not.toContain('dexto-plan-mode');
            await prompt(cx, sessionId, '/greet the team');
            expect(agentText(recorded.updates)).toContain('greeted');
        });
    }, 60000);

    it("reports the session's context usage after each turn", async () => {
        await withAgent(allow, async (cx, recorded) => {
            const sessionId = await newSession(cx);
            await prompt(cx, sessionId, 'say hello');
            const usage = recorded.updates.find((u) => u.sessionUpdate === 'usage_update');
            expect(usage).toMatchObject({
                used: expect.any(Number),
                size: expect.any(Number),
            });
            if (usage?.sessionUpdate !== 'usage_update') throw new Error('Expected usage');
            expect(usage.used).toBeGreaterThan(0);
            expect(usage.size).toBeGreaterThan(usage.used);
        });
    }, 60000);

    function configOption(options: acp.SessionConfigOption[] | null | undefined, id: string) {
        const option = options?.find((entry) => entry.id === id);
        if (option?.type !== 'select') throw new Error(`Expected a select option ${id}`);
        return option;
    }

    function optionValues(option: acp.SessionConfigOption & { type: 'select' }) {
        return option.options.flatMap((entry) =>
            'group' in entry ? entry.options.map((inner) => inner.value) : [entry.value]
        );
    }

    async function setOption(
        cx: acp.ClientContext,
        sessionId: string,
        configId: string,
        value: string
    ) {
        const { configOptions } = await cx.request(acp.methods.agent.session.setConfigOption, {
            sessionId,
            configId,
            value,
        });
        return configOptions;
    }

    it("offers the Dexto account's models and the chosen model's reasoning effort", async () => {
        await withAgent(
            allow,
            async (cx) => {
                const created = await cx.request(acp.methods.agent.session.new, {
                    cwd: directory,
                    mcpServers: [],
                });
                const model = configOption(created.configOptions, 'model');
                const gpt = JSON.stringify(['dexto-nova', 'openai/gpt-5', null]);
                expect(optionValues(model)).toEqual(
                    expect.arrayContaining([
                        gpt,
                        JSON.stringify(['dexto-nova', 'deepseek/deepseek-v3.2', null]),
                    ])
                );
                // The session's model doesn't reason, so there is no effort to pick.
                expect(created.configOptions?.some((entry) => entry.id === 'reasoning')).toBe(
                    false
                );
                const chosen = await setOption(cx, created.sessionId, 'model', gpt);
                expect(configOption(chosen, 'model').currentValue).toBe(gpt);
                const effort = configOption(chosen, 'reasoning');
                expect(effort).toMatchObject({ category: 'thought_level', currentValue: 'medium' });
                expect(optionValues(effort)).toEqual(['minimal', 'low', 'medium', 'high']);
                const high = await setOption(cx, created.sessionId, 'reasoning', 'high');
                expect(configOption(high, 'reasoning').currentValue).toBe('high');
                expect(configOption(high, 'model').currentValue).toBe(gpt);
                await expect(
                    setOption(cx, created.sessionId, 'reasoning', 'extreme')
                ).rejects.toMatchObject({ code: -32602 });
            },
            undefined,
            {
                env: {
                    DEXTO_FEATURE_AUTH: 'true',
                    DEXTO_API_KEY: 'acp-dexto-key',
                    DEXTO_PUBLIC_API_URL: serverUrl(),
                },
            }
        );
    }, 60000);

    it('says what a model needs when it has no key or sign-in', async () => {
        await withAgent(
            allow,
            async (cx) => {
                const { sessionId } = await cx.request(acp.methods.agent.session.new, {
                    cwd: directory,
                    mcpServers: [],
                });
                await expect(
                    setOption(
                        cx,
                        sessionId,
                        'model',
                        JSON.stringify(['anthropic', 'claude-sonnet-4-5-20250929', null])
                    )
                ).rejects.toMatchObject({
                    code: -32000,
                    message: expect.stringContaining('ANTHROPIC_API_KEY'),
                });
                await expect(
                    setOption(
                        cx,
                        sessionId,
                        'model',
                        JSON.stringify(['dexto-nova', 'openai/gpt-5', null])
                    )
                ).rejects.toMatchObject({
                    code: -32000,
                    message: expect.stringContaining('dexto login'),
                });
                // The session keeps its model and still answers.
                await expect(prompt(cx, sessionId, 'say hello')).resolves.toEqual({
                    stopReason: 'end_turn',
                });
            },
            undefined,
            { env: { DEXTO_FEATURE_AUTH: 'true' } }
        );
    }, 60000);

    it('starts on the saved model preference when --agent names a config', async () => {
        const preferencesHome = join(directory, 'preferences-home');
        await mkdir(join(preferencesHome, '.dexto'), { recursive: true });
        await writeFile(
            join(preferencesHome, '.dexto', 'preferences.yml'),
            `llm:
  provider: openai-compatible
  model: preferred-model
  apiKey: $ACP_PREFERRED_KEY
  baseURL: ${serverUrl()}/v1
defaults:
  defaultAgent: coding-agent
setup:
  completed: true
`
        );
        await withAgent(
            allow,
            async (cx, recorded) => {
                const created = await cx.request(acp.methods.agent.session.new, {
                    cwd: directory,
                    mcpServers: [],
                });
                expect(configOption(created.configOptions, 'model').currentValue).toBe(
                    JSON.stringify(['openai-compatible', 'preferred-model', `${serverUrl()}/v1`])
                );
                await prompt(cx, created.sessionId, 'say hello');
                expect(agentText(recorded.updates)).toContain('hello there');
            },
            undefined,
            { env: { HOME: preferencesHome, USERPROFILE: preferencesHome, ACP_PREFERRED_KEY: 'k' } }
        );
    }, 60000);

    it('says which key the configured model needs when a session starts', async () => {
        await withAgent(
            allow,
            async (cx) => {
                await expect(
                    cx.request(acp.methods.agent.session.new, { cwd: directory, mcpServers: [] })
                ).rejects.toMatchObject({
                    code: -32000,
                    message: expect.stringContaining('ANTHROPIC_API_KEY'),
                });
            },
            undefined,
            { config: keylessConfigPath }
        );
    }, 60000);

    function serverUrl(): string {
        const address = server.address();
        if (!address || typeof address === 'string') throw new Error('Expected a TCP address');
        return `http://127.0.0.1:${address.port}`;
    }
});

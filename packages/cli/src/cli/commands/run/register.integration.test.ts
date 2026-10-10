import { execFile } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

const execute = promisify(execFile);
const entrypoint = fileURLToPath(new URL('../../../index.ts', import.meta.url));
const tsx = createRequire(import.meta.url).resolve('tsx');

// Use a real local model transport and CLI process; no provider credentials or remote calls.
describe('headless CLI process output', () => {
    let server: Server;
    let directory: string;
    let configPath: string;
    let protectedConfigPath: string;
    let protectedEffectPath: string;
    let unscopedConfigPath: string;
    let ordinaryConfigPath: string;
    let ordinaryEffectPath: string;
    let automaticConfigPath: string;
    let allowedConfigPath: string;
    let noApprovalConfigPath: string;
    let home: string;
    const denialFeedback: string[] = [];

    beforeAll(async () => {
        server = createServer(async (request, response) => {
            let body = '';
            for await (const chunk of request) body += chunk;
            const input = JSON.parse(body);
            const protectedTask = input.tools?.some(
                (tool: { function: { name: string } }) =>
                    tool.function.name === 'protected_operation'
            );
            const toolFeedback = input.messages.find(
                (message: { role: string }) => message.role === 'tool'
            );
            const ordinaryTask = input.tools?.some(
                (tool: { function: { name: string } }) =>
                    tool.function.name === 'ordinary_operation'
            );
            const toolName = protectedTask
                ? 'protected_operation'
                : ordinaryTask
                  ? 'ordinary_operation'
                  : undefined;
            if (toolName && toolFeedback) denialFeedback.push(JSON.stringify(toolFeedback));
            const needsProtectedCall = toolName !== undefined && !toolFeedback;
            const content = protectedTask
                ? 'approval denied; recovery complete'
                : ordinaryTask
                  ? 'ordinary task complete'
                  : 'audit complete';
            response.writeHead(200, { 'Content-Type': 'text/event-stream' });
            for (const choice of [
                {
                    delta: needsProtectedCall
                        ? {
                              role: 'assistant',
                              tool_calls: [
                                  {
                                      index: 0,
                                      id: protectedTask ? 'protected-call' : 'ordinary-call',
                                      type: 'function',
                                      function: { name: toolName, arguments: '{}' },
                                  },
                              ],
                          }
                        : { role: 'assistant', content },
                    finish_reason: null,
                },
                { delta: {}, finish_reason: needsProtectedCall ? 'tool_calls' : 'stop' },
            ]) {
                response.write(
                    `data: ${JSON.stringify({
                        id: 'audit',
                        object: 'chat.completion.chunk',
                        created: 1,
                        model: 'audit-model',
                        choices: [{ index: 0, ...choice }],
                    })}\n\n`
                );
            }
            response.end('data: [DONE]\n\n');
        });
        await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
        const address = server.address();
        if (!address || typeof address === 'string') throw new Error('Expected a TCP address');
        directory = await mkdtemp(join(tmpdir(), 'dexto-output-'));
        home = join(directory, 'home');
        await mkdir(home);
        configPath = join(directory, 'agent.yml');
        await writeFile(
            configPath,
            `systemPrompt: Answer briefly.
llm:
  provider: openai-compatible
  model: audit-model
  apiKey: audit-key
  maxInputTokens: 32768
  baseURL: http://127.0.0.1:${address.port}/v1
storage:
  cache:
    type: in-memory
  database:
    type: in-memory
`
        );
        protectedConfigPath = join(directory, 'protected-agent.yml');
        protectedEffectPath = join(directory, 'protected-effect');
        unscopedConfigPath = join(directory, 'unscoped-agent.yml');
        ordinaryConfigPath = join(directory, 'ordinary-agent.yml');
        ordinaryEffectPath = join(directory, 'ordinary-effect');
        automaticConfigPath = join(directory, 'automatic-agent.yml');
        allowedConfigPath = join(directory, 'allowed-agent.yml');
        noApprovalConfigPath = join(directory, 'no-approval-agent.yml');
        const imagePath = join(directory, 'protected-image.mjs');
        const imageLocalUrl = new URL('../../../../../image-local/dist/index.js', import.meta.url)
            .href;
        const zodUrl = pathToFileURL(createRequire(import.meta.url).resolve('zod')).href;
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
            configSchema: z.object({ type: z.literal('ordinary-tools'), requiresApproval: z.boolean().default(true) }).strict(),
            create: (config) => [{
                id: 'ordinary_operation',
                description: 'Changes local state after normal tool approval',
                inputSchema: z.object({}).strict(),
                needsApproval: config.requiresApproval,
                execute: async () => {
                    await writeFile(${JSON.stringify(ordinaryEffectPath)}, 'ordinary effect');
                    return 'ordinary effect';
                },
            }],
        },
        'protected-tools': {
            configSchema: z.object({ type: z.literal('protected-tools'), omitSessionScope: z.boolean().default(false) }).strict(),
            create: (config) => [{
                id: 'protected_operation',
                description: 'Requires interactive approval before changing protected state',
                inputSchema: z.object({}).strict(),
                execute: async (_input, context) => {
                    if (!context.sessionId) throw new Error('Expected an injected session ID');
                    await context.services.approval.checkToolApproval({
                        // Model a custom caller that omits the optional approval service scope.
                        ...(config.omitSessionScope ? {} : { sessionId: context.sessionId }),
                        toolName: 'protected_operation',
                        toolCallId: context.toolCallId,
                        args: {},
                        autoApproval: 'disallowed',
                    });
                    await writeFile(${JSON.stringify(protectedEffectPath)}, 'protected effect');
                    return 'protected effect';
                },
            }],
        },
    },
};
`
        );
        await writeFile(
            protectedConfigPath,
            `image: ${JSON.stringify(imagePath)}
systemPrompt: Try the protected operation, then recover from its denial.
llm:
  provider: openai-compatible
  model: audit-model
  apiKey: audit-key
  maxInputTokens: 32768
  baseURL: http://127.0.0.1:${address.port}/v1
storage:
  cache:
    type: in-memory
  database:
    type: in-memory
tools:
  - type: protected-tools
`
        );
        await writeFile(
            unscopedConfigPath,
            `${await readFile(protectedConfigPath, 'utf8')}    omitSessionScope: true\n`
        );
        const ordinaryConfig = `image: ${JSON.stringify(imagePath)}
${await readFile(configPath, 'utf8')}
tools:
  - type: ordinary-tools
`;
        await writeFile(
            ordinaryConfigPath,
            `permissions:
  mode: manual
${ordinaryConfig}`
        );
        await writeFile(automaticConfigPath, ordinaryConfig);
        await writeFile(
            allowedConfigPath,
            `permissions:
  mode: manual
  toolPolicies:
    alwaysAllow: [ordinary_operation]
${ordinaryConfig}`
        );
        await writeFile(
            noApprovalConfigPath,
            `permissions:
  mode: manual
${ordinaryConfig}    requiresApproval: false
`
        );
    });

    beforeEach(async () => {
        denialFeedback.length = 0;
        await rm(ordinaryEffectPath, { force: true });
    });

    afterAll(async () => {
        if (server) server.closeAllConnections();
        if (server)
            await new Promise<void>((done, reject) =>
                server.close((error) => (error ? reject(error) : done()))
            );
        if (directory) await rm(directory, { recursive: true, force: true });
    });

    function run(args: string[]) {
        return execute(
            process.execPath,
            ['--import', tsx, entrypoint, '--agent', configPath, '--no-auto-install', ...args],
            {
                cwd: directory,
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
                timeout: 20000,
            }
        );
    }

    it.each(['json', 'jsonl', 'text'] as const)(
        'honors manual agent permissions with %s approval-required output and recovery',
        async (format) => {
            const { stdout, stderr } = await run([
                '--agent',
                ordinaryConfigPath,
                'run',
                'attempt ordinary operation',
                '--format',
                format,
            ]);
            await expect(access(ordinaryEffectPath)).rejects.toMatchObject({ code: 'ENOENT' });
            expect(denialFeedback).toHaveLength(1);
            expect(denialFeedback[0]).toContain('requires interactive approval');
            expect(stderr).toContain('[APPROVAL_REQUIRED]');
            if (format === 'text') {
                expect(stdout.trim()).toBe('ordinary task complete');
                return;
            }
            const lines = stdout
                .trim()
                .split('\n')
                .map((line) => JSON.parse(line));
            const result = lines.at(-1);
            expect(result).toMatchObject({
                ...(format === 'json' ? { status: 'completed' } : { type: 'complete' }),
                content: 'ordinary task complete',
                approvalRequired: [
                    expect.objectContaining({
                        approvalId: expect.any(String),
                        approvalType: 'tool_approval',
                        sessionId: result.sessionId,
                        toolName: 'ordinary_operation',
                        toolCallId: 'ordinary-call',
                        message: expect.stringContaining('Dexto TUI'),
                    }),
                ],
            });
            if (format === 'json') expect(lines).toHaveLength(1);
            else
                expect(lines.filter((line) => line.type === 'approval_required')).toEqual([
                    expect.objectContaining(result.approvalRequired[0]),
                ]);
        },
        30000
    );

    it('selects manual permissions through the shared global option', async () => {
        await run([
            '--agent',
            automaticConfigPath,
            '--permissions-mode',
            'manual',
            'run',
            'attempt ordinary operation',
            '--format',
            'json',
        ]);
        await expect(access(ordinaryEffectPath)).rejects.toMatchObject({ code: 'ENOENT' });
        expect(denialFeedback[0]).toContain('requires interactive approval');
    }, 30000);

    it.each([['--permissions-mode', 'auto-approve'], ['--auto-approve'], ['--bypass-permissions']])(
        'permits ordinary tools with the shared global %j selection',
        async (...flags) => {
            const { stdout } = await run([
                '--agent',
                ordinaryConfigPath,
                ...flags,
                'run',
                'attempt ordinary operation',
                '--format',
                'json',
            ]);
            expect(await readFile(ordinaryEffectPath, 'utf8')).toBe('ordinary effect');
            expect(JSON.parse(stdout)).toMatchObject({
                status: 'completed',
                content: 'ordinary task complete',
            });
            expect(JSON.parse(stdout).approvalRequired ?? []).toEqual([]);
        },
        30000
    );

    it('keeps the permissive Core default when no permission mode is configured', async () => {
        await run([
            '--agent',
            automaticConfigPath,
            'run',
            'attempt ordinary operation',
            '--format',
            'json',
        ]);
        expect(await readFile(ordinaryEffectPath, 'utf8')).toBe('ordinary effect');
    }, 30000);

    it.each(['static allow list', 'authored no-approval'] as const)(
        'runs an allowed ordinary tool in manual mode through %s',
        async (policy) => {
            const agent = policy === 'static allow list' ? allowedConfigPath : noApprovalConfigPath;
            const { stdout } = await run([
                '--agent',
                agent,
                'run',
                'attempt ordinary operation',
                '--format',
                'json',
            ]);
            expect(await readFile(ordinaryEffectPath, 'utf8')).toBe('ordinary effect');
            expect(JSON.parse(stdout).approvalRequired ?? []).toEqual([]);
        },
        30000
    );

    it('rejects conflicting shared permission selections before tool execution', async () => {
        await expect(
            run([
                '--agent',
                ordinaryConfigPath,
                '--permissions-mode',
                'manual',
                '--auto-approve',
                'run',
                'attempt ordinary operation',
                '--format',
                'json',
            ])
        ).rejects.toMatchObject({ code: 1 });
        await expect(access(ordinaryEffectPath)).rejects.toMatchObject({ code: 'ENOENT' });
    }, 30000);

    it('writes only one JSON object through real bootstrap and model execution', async () => {
        const { stdout } = await run(['run', 'say hello', '--format', 'json']);
        expect(stdout.trim().split('\n')).toHaveLength(1);
        expect(JSON.parse(stdout)).toMatchObject({
            version: 1,
            status: 'completed',
            content: 'audit complete',
        });
    }, 30000);

    it('writes parseable JSONL through real execution with one terminal completion', async () => {
        const { stdout } = await run(['run', 'say hello', '--format', 'jsonl']);
        const lines = stdout
            .trim()
            .split('\n')
            .map((line) => JSON.parse(line));
        expect(lines.filter((line) => line.type === 'complete')).toHaveLength(1);
        expect(lines.at(-1)).toMatchObject({
            version: 1,
            type: 'complete',
            content: 'audit complete',
        });
    }, 30000);

    it('writes a structured error when the deployment image cannot load', async () => {
        await expect(
            run(['--image', '@dexto/nonexistent-audit-image', 'run', 'task', '--format', 'json'])
        ).rejects.toMatchObject({ code: 1, stdout: expect.stringContaining('"status":"failed"') });
    }, 30000);
    it.each(['json', 'jsonl'] as const)(
        'reports unscoped custom approval in %s output for the active run without a side effect',
        async (format) => {
            const { stdout } = await run([
                '--agent',
                unscopedConfigPath,
                'run',
                'attempt protected operation',
                '--format',
                format,
            ]);
            const lines = stdout
                .trim()
                .split('\n')
                .map((line) => JSON.parse(line));
            const result = lines.at(-1);
            expect(result).toMatchObject({
                ...(format === 'json' ? { status: 'completed' } : { type: 'complete' }),
                content: 'approval denied; recovery complete',
                approvalRequired: [
                    expect.objectContaining({
                        approvalId: expect.any(String),
                        approvalType: 'tool_approval',
                        sessionId: result.sessionId,
                        toolName: 'protected_operation',
                        toolCallId: 'protected-call',
                        message: expect.stringContaining('Dexto TUI'),
                    }),
                ],
            });
            if (format === 'json') expect(lines).toHaveLength(1);
            else
                expect(lines.filter((line) => line.type === 'approval_required')).toEqual([
                    expect.objectContaining(result.approvalRequired[0]),
                ]);
            expect(denialFeedback).toHaveLength(1);
            expect(denialFeedback[0]).toContain('requires interactive approval');
            await expect(access(protectedEffectPath)).rejects.toMatchObject({ code: 'ENOENT' });
        },
        30000
    );

    it.each(['json', 'jsonl'] as const)(
        'completes %s output after mandatory tool denial and model recovery without a protected effect',
        async (format) => {
            denialFeedback.length = 0;
            // execFile rejects a nonzero exit; resolving verifies the real process exits successfully.
            const { stdout } = await run([
                '--agent',
                protectedConfigPath,
                'run',
                'attempt protected operation',
                '--format',
                format,
            ]);
            const lines = stdout
                .trim()
                .split('\n')
                .map((line) => JSON.parse(line));
            if (format === 'json') {
                expect(lines).toHaveLength(1);
                expect(lines[0]).toMatchObject({
                    status: 'completed',
                    content: 'approval denied; recovery complete',
                });
            } else {
                expect(lines.filter((line) => line.type === 'complete')).toHaveLength(1);
                expect(lines.at(-1)).toMatchObject({
                    type: 'complete',
                    content: 'approval denied; recovery complete',
                });
            }
            const result = lines.at(-1);
            expect(result.approvalRequired).toEqual([
                expect.objectContaining({
                    approvalId: expect.any(String),
                    approvalType: 'tool_approval',
                    sessionId: result.sessionId,
                    toolName: 'protected_operation',
                    toolCallId: 'protected-call',
                    message: expect.stringContaining('Dexto TUI'),
                }),
            ]);
            if (format === 'jsonl')
                expect(lines.filter((line) => line.type === 'approval_required')).toEqual([
                    expect.objectContaining(result.approvalRequired[0]),
                ]);
            expect(denialFeedback).toHaveLength(1);
            expect(denialFeedback[0]).toContain('requires interactive approval');
            expect(denialFeedback[0]).toContain('Dexto TUI');
            await expect(access(protectedEffectPath)).rejects.toMatchObject({ code: 'ENOENT' });
        },
        30000
    );
});

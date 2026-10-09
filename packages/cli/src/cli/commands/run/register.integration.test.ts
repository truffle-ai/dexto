import { execFile } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import { access, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const execute = promisify(execFile);
const entrypoint = fileURLToPath(new URL('../../../index.ts', import.meta.url));

// Use a real local model transport and CLI process; no provider credentials or remote calls.
describe('headless CLI process output', () => {
    let server: Server;
    let directory: string;
    let configPath: string;
    let protectedConfigPath: string;
    let protectedEffectPath: string;
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
            if (protectedTask && toolFeedback) denialFeedback.push(JSON.stringify(toolFeedback));
            const needsProtectedCall = protectedTask && !toolFeedback;
            const content = protectedTask ? 'approval denied; recovery complete' : 'audit complete';
            response.writeHead(200, { 'Content-Type': 'text/event-stream' });
            for (const choice of [
                {
                    delta: needsProtectedCall
                        ? {
                              role: 'assistant',
                              tool_calls: [
                                  {
                                      index: 0,
                                      id: 'protected-call',
                                      type: 'function',
                                      function: { name: 'protected_operation', arguments: '{}' },
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
        'protected-tools': {
            configSchema: z.object({ type: z.literal('protected-tools') }).strict(),
            create: () => [{
                id: 'protected_operation',
                description: 'Requires interactive approval before changing protected state',
                inputSchema: z.object({}).strict(),
                execute: async (_input, context) => {
                    await context.services.approval.checkToolApproval({
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
    });

    afterAll(async () => {
        if (server)
            await new Promise<void>((done, reject) =>
                server.close((error) => (error ? reject(error) : done()))
            );
        if (directory) await rm(directory, { recursive: true, force: true });
    });

    function run(args: string[]) {
        return execute(
            process.execPath,
            ['--import', 'tsx', entrypoint, '--agent', configPath, '--no-auto-install', ...args],
            {
                cwd: resolve('.'),
                env: {
                    ...process.env,
                    DEXTO_ANALYTICS_DISABLED: '1',
                    DEXTO_FEATURE_AUTH: 'false',
                    DEXTO_DEV_MODE: 'true',
                    DEXTO_LLM_REGISTRY_DISABLE_FETCH: '1',
                },
                timeout: 20000,
            }
        );
    }

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
            expect(denialFeedback).toHaveLength(1);
            expect(denialFeedback[0]).toContain('requires interactive approval');
            expect(denialFeedback[0]).toContain('Dexto TUI');
            await expect(access(protectedEffectPath)).rejects.toMatchObject({ code: 'ENOENT' });
        },
        30000
    );
});

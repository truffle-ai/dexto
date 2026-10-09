import { execFile } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const execute = promisify(execFile);
const entrypoint = fileURLToPath(new URL('../../../index.ts', import.meta.url));

// Use a real local model transport and CLI process; no provider credentials or remote calls.
describe('headless CLI process output', () => {
    let server: Server;
    let directory: string;
    let configPath: string;

    beforeAll(async () => {
        server = createServer((request, response) => {
            request.resume();
            response.writeHead(200, { 'Content-Type': 'text/event-stream' });
            for (const choice of [
                { delta: { role: 'assistant', content: 'audit complete' }, finish_reason: null },
                { delta: {}, finish_reason: 'stop' },
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
});

#!/usr/bin/env node
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { execFile } from 'node:child_process';
import console from 'node:console';
import { access, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import process from 'node:process';
import { promisify } from 'node:util';

// Accept a standalone executable or Node plus a deployed CLI entrypoint.
const [executable, ...prefix] = process.argv.slice(2);
if (!executable)
    throw new Error('Usage: test-packaged-agent-runtime.mjs <executable> [entrypoint]');
const execute = promisify(execFile);
const directory = await realpath(await mkdtemp(join(tmpdir(), 'dexto-packaged-smoke-')));
const home = join(directory, 'home');
const workspace = join(directory, 'workspace');
const content = 'packaged runtime smoke passed';
let toolStep = 0;
let finalToolMessages = [];
const operations = [
    { name: 'write_file', arguments: { file_path: join(workspace, 'smoke.txt'), content } },
    { name: 'read_file', arguments: { file_path: join(workspace, 'smoke.txt') } },
    { name: 'bash_exec', arguments: { command: 'echo packaged runtime smoke passed' } },
];
const model = createServer(async (request, response) => {
    try {
        let body = '';
        for await (const chunk of request) body += chunk;
        const input = JSON.parse(body);
        const task = input.tools?.some((tool) => tool.function?.name === 'write_file');
        const operation = task ? operations[toolStep++] : undefined;
        if (task && !operation)
            finalToolMessages = input.messages.filter((message) => message.role === 'tool');
        const delta = operation
            ? {
                  role: 'assistant',
                  tool_calls: [
                      {
                          index: 0,
                          id: `tool-${toolStep}`,
                          type: 'function',
                          function: {
                              name: operation.name,
                              arguments: JSON.stringify(operation.arguments),
                          },
                      },
                  ],
              }
            : { role: 'assistant', content: task ? content : 'Packaged smoke task' };
        response.writeHead(200, { 'Content-Type': 'text/event-stream' });
        for (const choice of [
            { delta, finish_reason: null },
            { delta: {}, finish_reason: operation ? 'tool_calls' : 'stop' },
        ])
            response.write(
                `data: ${JSON.stringify({ id: 'packaged-smoke', object: 'chat.completion.chunk', created: 1, model: 'packaged-smoke-model', choices: [{ index: 0, ...choice }] })}\n\n`
            );
        response.end('data: [DONE]\n\n');
    } catch (error) {
        console.error('Mock model request failed', error);
        response.writeHead(500);
        response.end('Mock model request failed');
    }
});

try {
    await mkdir(home);
    await mkdir(workspace);
    await new Promise((resolve, reject) => {
        model.once('error', reject);
        model.listen(0, '127.0.0.1', resolve);
    });
    const address = model.address();
    assert.ok(address && typeof address !== 'string');
    // Do not inherit developer credentials, .env files or package/runtime path overrides.
    const env = Object.fromEntries(
        ['PATH', 'SystemRoot', 'COMSPEC', 'PATHEXT', 'TEMP', 'TMP', 'TMPDIR']
            .filter((key) => process.env[key] !== undefined)
            .map((key) => [key, process.env[key]])
    );
    Object.assign(env, {
        HOME: home,
        USERPROFILE: home,
        DEXTO_ANALYTICS_DISABLED: '1',
        DEXTO_NO_UPDATE_CHECK: 'true',
        DEXTO_LLM_REGISTRY_DISABLE_FETCH: '1',
        DEXTO_FEATURE_AUTH: 'false',
    });
    async function cli(args) {
        return execute(resolve(executable), [...prefix, ...args], {
            cwd: workspace,
            env,
            timeout: 120000,
            maxBuffer: 4 * 1024 * 1024,
        });
    }
    await cli(['agents', 'install', 'coding-agent']);
    const agentDirectory = join(home, '.dexto', 'agents', 'coding-agent');
    const config = join(agentDirectory, 'coding-agent.yml');
    await access(config);
    await access(join(agentDirectory, 'skills', 'code-review.md'));
    console.log('Bundled coding agent and supporting skill install in a fresh home passed');
    // Replace only the installed copy to use the local mock provider and deterministic tools.
    await writeFile(
        config,
        `agentId: packaged-smoke
image: '@dexto/image-local'
systemPrompt: Follow the deterministic local smoke task.
llm:
  provider: openai-compatible
  model: packaged-smoke-model
  apiKey: unused-local-test-key
  maxInputTokens: 32768
  baseURL: http://127.0.0.1:${address.port}/v1
permissions:
  mode: auto-approve
elicitation:
  enabled: false
storage:
  cache:
    type: in-memory
  database:
    type: sqlite
tools:
  - type: filesystem-tools
    allowedPaths: [${JSON.stringify(workspace)}]
  - type: process-tools
    securityLevel: moderate
`
    );
    for (const format of ['json', 'jsonl']) {
        toolStep = 0;
        finalToolMessages = [];
        const { stdout } = await cli([
            '--agent',
            'coding-agent',
            'run',
            'Exercise local tools',
            '--format',
            format,
        ]);
        const events = stdout
            .trim()
            .split('\n')
            .map((line) => JSON.parse(line));
        if (format === 'json') {
            assert.equal(events.length, 1);
            assert.equal(events[0].status, 'completed');
        } else {
            assert.equal(events.filter((event) => event.type === 'complete').length, 1);
            assert.equal(events.at(-1).type, 'complete');
        }
        assert.equal(events.at(-1).content, content);
        assert.equal(toolStep, 4);
        assert.equal(finalToolMessages.length, 3);
        const results = finalToolMessages.map((message) => JSON.parse(message.content));
        assert.equal(results[0].bytes_written, Buffer.byteLength(content));
        assert.ok(results[1].content.includes(content));
        assert.equal(results[2].exit_code, 0);
        assert.equal(results[2].stdout.trim(), content);
        assert.equal(await readFile(join(workspace, 'smoke.txt'), 'utf8'), content);
        console.log(`Fresh-home packaged ${format} run, filesystem and process tools passed`);
    }
    await access(join(home, '.dexto', 'database', 'packaged-smoke.db'));
    console.log('Packaged SQLite initialization passed');
} finally {
    model.closeAllConnections();
    await new Promise((resolve) => model.close(resolve));
    await rm(directory, { recursive: true, force: true });
}

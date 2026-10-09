#!/usr/bin/env node
/* global fetch, AbortSignal */
import assert from 'node:assert/strict';
import console from 'node:console';
import process from 'node:process';
import { execFile } from 'node:child_process';
import { createServer } from 'node:http';
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { promisify } from 'node:util';

const execute = promisify(execFile);
const image = process.argv[2];
if (!image) throw new Error('Usage: node scripts/test-docker-runtime.mjs <image>');
const suffix = `${process.pid}-${Date.now()}`;
const container = `dexto-runtime-smoke-${suffix}`;
const versionContainer = `${container}-version`;
const dataVolume = `${container}-data`;
const workspaceVolume = `${container}-workspace`;
const directory = await mkdtemp(join(tmpdir(), 'dexto-docker-smoke-'));
const port = 3817;
let modelCalls = 0;
const modelRequests = [];
const content = 'docker runtime smoke passed';
const steps = [
    { name: 'write_file', arguments: { file_path: '/workspace/smoke.txt', content } },
    { name: 'read_file', arguments: { file_path: '/workspace/smoke.txt' } },
    { name: 'bash_exec', arguments: { command: 'cat /workspace/smoke.txt' } },
];

function docker(args) {
    return execute('docker', args, { timeout: 120000, maxBuffer: 4 * 1024 * 1024 });
}

const model = createServer(async (request, response) => {
    try {
        let body = '';
        for await (const chunk of request) body += chunk;
        const input = JSON.parse(body);
        const isAgentTask = input.tools?.some((tool) => tool.function?.name === 'write_file');
        if (isAgentTask) modelRequests.push(input);
        const step = isAgentTask ? steps[modelCalls++] : undefined;
        const toolCalls = step
            ? [
                  {
                      id: `smoke-${modelCalls}`,
                      type: 'function',
                      function: { name: step.name, arguments: JSON.stringify(step.arguments) },
                  },
              ]
            : undefined;
        const message = {
            role: 'assistant',
            content: step ? null : isAgentTask ? content : 'Docker smoke task',
            ...(toolCalls ? { tool_calls: toolCalls } : {}),
        };
        const result = {
            id: `docker-smoke-${modelCalls}`,
            object: 'chat.completion',
            created: 1,
            model: 'docker-smoke-model',
            choices: [{ index: 0, message, finish_reason: step ? 'tool_calls' : 'stop' }],
            usage: { prompt_tokens: 20, completion_tokens: 10, total_tokens: 30 },
        };
        if (input.stream) {
            response.writeHead(200, { 'Content-Type': 'text/event-stream' });
            const delta = {
                ...message,
                ...(toolCalls
                    ? { tool_calls: toolCalls.map((call, index) => ({ index, ...call })) }
                    : {}),
            };
            response.write(
                `data: ${JSON.stringify({ ...result, object: 'chat.completion.chunk', choices: [{ index: 0, delta, finish_reason: null }] })}\n\n`
            );
            response.write(
                `data: ${JSON.stringify({ ...result, object: 'chat.completion.chunk', choices: [{ index: 0, delta: {}, finish_reason: step ? 'tool_calls' : 'stop' }] })}\n\n`
            );
            response.end('data: [DONE]\n\n');
        } else {
            response.writeHead(200, { 'Content-Type': 'application/json' });
            response.end(JSON.stringify(result));
        }
    } catch (error) {
        console.error('Mock model request failed', error);
        response.writeHead(500);
        response.end('Mock model request failed');
    }
});

async function waitFor(check, description) {
    const deadline = Date.now() + 60000;
    while (Date.now() < deadline) {
        if (await check()) return;
        await delay(500);
    }
    throw new Error(`Timed out waiting for ${description}`);
}

try {
    // The non-root container must read this bind-mounted test configuration.
    await chmod(directory, 0o755);
    await new Promise((resolve, reject) => {
        model.once('error', reject);
        model.listen(0, '0.0.0.0', resolve);
    });
    const address = model.address();
    if (!address || typeof address === 'string') throw new Error('Expected TCP model endpoint');
    await writeFile(
        join(directory, 'agent.yml'),
        `agentId: docker-smoke
systemPrompt: Follow the deterministic tool instructions.
llm:
  provider: openai-compatible
  model: docker-smoke-model
  apiKey: unused-local-test-key
  maxInputTokens: 32768
  baseURL: http://host.docker.internal:${address.port}/v1
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
    allowedPaths: ['/workspace']
  - type: process-tools
    securityLevel: moderate
`
    );
    async function startContainer() {
        await docker([
            'run',
            '--detach',
            '--name',
            container,
            '--add-host',
            'host.docker.internal:host-gateway',
            '--publish',
            `127.0.0.1::${port}`,
            '--mount',
            `type=bind,source=${directory},target=/smoke,readonly`,
            '--mount',
            `type=volume,source=${dataVolume},target=/app/.dexto`,
            '--mount',
            `type=volume,source=${workspaceVolume},target=/workspace`,
            '--env',
            `PORT=${port}`,
            '--env',
            'CONFIG_FILE=/smoke/agent.yml',
            '--env',
            'DEXTO_SERVER_API_KEY=docker-runtime-smoke-key',
            '--env',
            'DEXTO_FEATURE_AUTH=false',
            '--env',
            'DEXTO_ANALYTICS_DISABLED=1',
            '--env',
            'DEXTO_NO_UPDATE_CHECK=true',
            '--env',
            'DEXTO_LLM_REGISTRY_DISABLE_FETCH=1',
            '--health-interval',
            '1s',
            '--health-start-period',
            '5s',
            '--health-retries',
            '30',
            image,
        ]);
        const mapping = (await docker(['port', container, `${port}/tcp`])).stdout.trim();
        const hostPort = Number(mapping.split(':').at(-1));
        assert.ok(hostPort > 0);
        return `http://127.0.0.1:${hostPort}`;
    }
    let base = await startContainer();
    async function api(path, body) {
        const response = await fetch(`${base}${path}`, {
            headers: { Authorization: 'Bearer docker-runtime-smoke-key' },
            ...(body
                ? {
                      method: 'POST',
                      headers: {
                          'Content-Type': 'application/json',
                          Authorization: 'Bearer docker-runtime-smoke-key',
                      },
                      body: JSON.stringify(body),
                  }
                : {}),
            signal: AbortSignal.timeout(30000),
        });
        if (!response.ok) throw new Error(`${path}: ${response.status} ${await response.text()}`);
        return response.json();
    }
    await waitFor(async () => {
        try {
            return (await fetch(`${base}/health`, { signal: AbortSignal.timeout(2000) })).ok;
        } catch {
            return false;
        }
    }, 'custom-port server health');
    await waitFor(
        async () =>
            (
                await docker(['inspect', '--format', '{{.State.Health.Status}}', container])
            ).stdout.trim() === 'healthy',
        'Docker healthcheck'
    );
    console.log('Custom PORT and Docker healthcheck passed');

    await docker([
        'exec',
        '--workdir',
        '/app',
        container,
        'node',
        '--input-type=module',
        '-e',
        "await Promise.all(['@dexto/core','@dexto/agent-config','@dexto/agent-management','@dexto/image-local','@dexto/server','@dexto/storage','@dexto/tui','@dexto/client-sdk'].map(name => import(name))); console.log('production imports ready');",
    ]);
    console.log('Production dependency imports passed');
    const version = await docker(['run', '--rm', '--name', versionContainer, image, '--version']);
    assert.match(version.stdout.trim(), /^\d+\.\d+\.\d+/);
    console.log('CLI argument forwarding passed');
    const created = await api('/api/sessions', {});
    const sessionId = created.session.id;
    const result = await api('/api/message-sync', {
        content: [{ type: 'text', text: 'Exercise the smoke tools' }],
        sessionId,
    });
    assert.equal(result.response, content);
    assert.equal(modelCalls, 4);
    const toolMessages = modelRequests.at(-1).messages.filter((message) => message.role === 'tool');
    assert.equal(toolMessages.length, 3);
    assert.ok(JSON.stringify(toolMessages[0]).includes('bytes_written'));
    for (const message of toolMessages.slice(1))
        assert.ok(JSON.stringify(message).includes(content));
    assert.equal(
        (await docker(['exec', container, 'cat', '/workspace/smoke.txt'])).stdout,
        content
    );
    await docker([
        'exec',
        container,
        'node',
        '-e',
        "require('node:assert/strict').ok(require('node:fs').existsSync('/app/.dexto/database/docker-smoke.db'));",
    ]);
    console.log('Local model, filesystem and process execution passed');

    await docker(['stop', '--time', '15', container]);
    assert.equal(
        (await docker(['inspect', '--format', '{{.State.ExitCode}}', container])).stdout.trim(),
        '0'
    );
    console.log('SIGTERM shutdown passed');
    await docker(['rm', container]);
    base = await startContainer();
    await waitFor(async () => {
        try {
            return (await fetch(`${base}/health`, { signal: AbortSignal.timeout(2000) })).ok;
        } catch {
            return false;
        }
    }, 'restarted server');
    const sessions = await api('/api/sessions');
    assert.ok(sessions.sessions.some((session) => session.id === sessionId));
    assert.equal(
        (await docker(['exec', container, 'cat', '/workspace/smoke.txt'])).stdout,
        content
    );
    console.log(
        'SQLite session and workspace volume persistence passed after container recreation'
    );
} catch (error) {
    const logs = await docker(['logs', container]).catch(() => ({ stdout: '', stderr: '' }));
    console.error(logs.stdout, logs.stderr);
    console.error(
        JSON.stringify(
            modelRequests.map((request) =>
                request.messages.filter((message) => message.role === 'tool')
            ),
            null,
            2
        )
    );
    throw error;
} finally {
    await docker(['rm', '--force', container, versionContainer]).catch(() => undefined);
    await docker(['volume', 'rm', dataVolume, workspaceVolume]).catch(() => undefined);
    model.closeAllConnections();
    await new Promise((resolve) => model.close(resolve));
    await rm(directory, { recursive: true, force: true });
}

import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { writeCodexState } from '../../import/test-utils.js';
import { createOutput } from '../output.js';
import { nodeCloudRuntime } from '../runtime.js';
import type { CommandContext } from '../command.js';
import { chatCommands } from './chats.js';

function harness(home: string, format: 'json' | 'table') {
    let stdout = '';
    let stderr = '';
    const runtime = {
        ...nodeCloudRuntime(new AbortController().signal),
        homeDirectory: home,
        environment: {},
        color: false,
        writeOutput: (text: string) => {
            stdout += text;
        },
        writeError: (text: string) => {
            stderr += text;
        },
    };
    const context: CommandContext = {
        runtime,
        output: createOutput(runtime, format),
        invocation: [],
        overrides: { apiBaseUrl: null, apiKey: null, cloudProject: null, profile: null },
        client: async () => {
            throw new Error('unexpected network');
        },
        connection: async () => {
            throw new Error('unexpected network');
        },
    };
    return { context, stdout: () => stdout, stderr: () => stderr };
}

describe('chat import commands', () => {
    it('reports a state database read failure at the command boundary', async () => {
        const home = await mkdtemp(path.join(tmpdir(), 'chat-command-'));
        const codex = path.join(home, '.codex');
        await mkdir(codex, { recursive: true });
        await writeFile(path.join(codex, 'state_5.sqlite'), 'not a database');
        const local = chatCommands.find((command) => command.path[1] === 'local');
        if (!local) throw new Error('Missing command');
        await expect(
            local.run(harness(home, 'json').context, { positionals: [], values: { from: 'codex' } })
        ).rejects.toThrow('Cannot read Codex state database');
    });
    it('reports missing Codex rollouts and honours an explicit sessions directory', async () => {
        const home = await mkdtemp(path.join(tmpdir(), 'chat-command-'));
        const codex = path.join(home, '.codex');
        await mkdir(path.join(codex, 'sessions'), { recursive: true });
        await writeCodexState(codex, [
            {
                id: 'gone',
                cwd: '/work',
                rolloutPath: null,
                title: 'Gone',
                updatedAt: '2026-11-01T00:00:00Z',
            },
        ]);
        const h = harness(home, 'json');
        const local = chatCommands.find((command) => command.path[1] === 'local');
        if (!local) throw new Error('Missing command');
        await local.run(h.context, { positionals: [], values: { from: 'codex' } });
        expect(JSON.parse(h.stdout())).toEqual({ data: [] });
        expect(h.stderr()).toContain('1 Codex chat has no rollout file');
        const copied = harness(home, 'json');
        await local.run(copied.context, {
            positionals: [],
            values: { from: 'codex', dir: path.join(codex, 'sessions') },
        });
        expect(copied.stderr()).toBe('');
    });

    it('lists PR metadata and reports truncation in dry runs', async () => {
        const home = await mkdtemp(path.join(tmpdir(), 'chat-command-'));
        const project = path.join(home, '.claude', 'projects', 'project');
        await mkdir(project, { recursive: true });
        const fixture = fileURLToPath(
            new URL('../../import/fixtures/claude-code-2.1.316.jsonl', import.meta.url)
        );
        let transcript = await readFile(fixture, 'utf8');
        const id = '7f3c2a10-5b1e-4c8d-9a2f-0e6b1d4c8a11';
        for (let i = 0; i < 2001; i++)
            transcript += `\n${JSON.stringify({ type: 'user', sessionId: id, timestamp: '2026-11-01T12:00:00Z', message: { role: 'user', content: `turn ${i}` } })}`;
        await writeFile(path.join(project, `${id}.jsonl`), transcript);
        const list = harness(home, 'json');
        const local = chatCommands.find((command) => command.path[1] === 'local');
        const importing = chatCommands.find((command) => command.path[1] === 'import');
        if (!local || !importing) throw new Error('Missing command');
        await local.run(list.context, { positionals: [], values: { from: 'claude-code' } });
        expect(JSON.parse(list.stdout()).data[0]).toMatchObject({
            title: 'Import titles from ai-title lines',
            pullRequests: [{ number: 1050, repository: 'truffle-ai/dexto' }],
            repository: null,
        });
        const dry = harness(home, 'table');
        expect(
            await importing.run(dry.context, {
                positionals: [id],
                values: { from: 'claude-code', 'dry-run': true },
            })
        ).toBe(0);
        // The fixture's 5 turns (one a compact summary) and 2,001 more keep the newest 1,999 and a note.
        expect(dry.stdout()).toContain('first 7 left out');
    });
});

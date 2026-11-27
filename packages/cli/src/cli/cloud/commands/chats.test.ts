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
        expect(dry.stdout()).toContain('first 6 left out');
    });
});

describe('chat import with no sessions named', () => {
    const importing = chatCommands.find((command) => command.path[1] === 'import');
    if (!importing) throw new Error('Missing command');

    /** Two Codex rollouts: one run elsewhere, one run in this process's folder. */
    async function codexHome() {
        const home = await mkdtemp(path.join(tmpdir(), 'chat-pick-'));
        const day = path.join(home, '.codex', 'sessions', '2026', '11', '02');
        await mkdir(day, { recursive: true });
        const fixture = await readFile(
            fileURLToPath(new URL('../../import/fixtures/codex-0.165.0.jsonl', import.meta.url)),
            'utf8'
        );
        const elsewhere = '019a4f2e-7c3d-7e10-9b8a-2f6d4c1e0a77';
        const here = '019a4f2e-7c3d-7e10-9b8a-2f6d4c1e0a78';
        await writeFile(path.join(day, `rollout-a-${elsewhere}.jsonl`), fixture);
        await writeFile(
            path.join(day, `rollout-b-${here}.jsonl`),
            fixture
                .replaceAll(elsewhere, here)
                .replaceAll('"/Users/dev/Projects/dexto"', JSON.stringify(process.cwd()))
        );
        return { elsewhere, here, home };
    }

    /** A terminal whose person gives these answers, in order. */
    function atTerminal(home: string, answers: string[]) {
        const h = harness(home, 'table');
        const asked: string[] = [];
        const context: CommandContext = {
            ...h.context,
            runtime: {
                ...h.context.runtime,
                stdoutIsTerminal: true,
                prompt: async (question) => {
                    asked.push(question);
                    const answer = answers.shift();
                    if (answer === undefined) throw new Error(`Unexpected question: ${question}`);
                    return answer;
                },
            },
        };
        return { ...h, asked, context };
    }

    it('asks nothing without a terminal and names the flags that choose', async () => {
        const { home } = await codexHome();
        await expect(
            importing.run(harness(home, 'table').context, {
                positionals: [],
                values: { from: 'codex' },
            })
        ).rejects.toThrow(/--all.*--folder \..*--since/u);
    });

    it('asks nothing with --json or --yes, even at a terminal', async () => {
        const { home } = await codexHome();
        for (const values of [{ yes: true }, {}]) {
            const terminal = atTerminal(home, []);
            const context =
                'yes' in values
                    ? terminal.context
                    : {
                          ...terminal.context,
                          output: createOutput(terminal.context.runtime, 'json'),
                      };
            await expect(
                importing.run(context, { positionals: [], values: { from: 'codex', ...values } })
            ).rejects.toThrow(/--all/u);
            expect(terminal.asked).toEqual([]);
        }
    });

    it('lets a person pick by number and shows the dry run of only those', async () => {
        const { elsewhere, here, home } = await codexHome();
        const terminal = atTerminal(home, ['5', '4', '9', '2']);
        expect(
            await importing.run(terminal.context, {
                positionals: [],
                values: { from: 'codex', 'dry-run': true },
            })
        ).toBe(0);
        expect(terminal.stdout()).toContain('2 Codex chats found');
        expect(terminal.stdout()).toMatch(/ {3}1\. .+2026-11-02/u);
        // A choice or a number that doesn't read is asked again.
        expect(terminal.asked).toHaveLength(4);
        // The numbered list shows titles; only the dry run names sessions, and only the one picked.
        const named = [here, elsewhere].filter((id) => terminal.stdout().includes(id));
        expect(named).toHaveLength(1);
    });

    it('narrows to this folder, shows the summary, then asks before sending', async () => {
        const { elsewhere, here, home } = await codexHome();
        const terminal = atTerminal(home, ['2', 'n']);
        await expect(
            importing.run(terminal.context, { positionals: [], values: { from: 'codex' } })
        ).rejects.toMatchObject({ kind: 'needs_confirmation' });
        expect(terminal.stdout()).toContain(here);
        expect(terminal.stdout()).not.toContain(elsewhere);
        expect(terminal.asked.at(-1)).toMatch(/^Upload 1 Codex chat .*Go ahead\? \[y\/N\] $/u);
    });

    it('narrows to a date and stops on an empty answer', async () => {
        const { home } = await codexHome();
        const later = atTerminal(home, ['3', '2026-12-01']);
        expect(
            await importing.run(later.context, {
                positionals: [],
                values: { from: 'codex', 'dry-run': true },
            })
        ).toBe(0);
        expect(later.stderr()).toContain('No Codex chats match.');

        const stopped = atTerminal(home, ['']);
        await expect(
            importing.run(stopped.context, { positionals: [], values: { from: 'codex' } })
        ).rejects.toMatchObject({ kind: 'needs_confirmation' });
    });
});

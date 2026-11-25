import { describe, expect, it, vi } from 'vitest';
import { createOutput } from '../output.js';
import { nodeCloudRuntime } from '../runtime.js';
import type { CommandContext } from '../command.js';
import { CONNECT_CODEX_HINT, importCommands } from './import.js';
import { findLocalChats } from '../../import/local-chats.js';
import { findPersonalSkills } from '../../import/personal-skills.js';
import { queryWorkspaceTool } from './workspace.js';
import { CommandFailure } from '../../failure.js';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

vi.mock('../../import/local-chats.js', () => ({
    findLocalChats: vi.fn(async () => ({ chats: [], notices: [] })),
}));
vi.mock('../../import/personal-skills.js', () => ({
    findPersonalSkills: vi.fn(async () => []),
}));
vi.mock('./workspace.js', () => ({
    queryWorkspaceTool: vi.fn(async () => ({
        session: { id: 'created' },
        status: 'imported',
        url: 'https://example.test/chat',
    })),
}));

describe('headless import', () => {
    it('never uploads a selected personal skill while provenance retry semantics are provisional', async () => {
        const home = await mkdtemp(path.join(tmpdir(), 'guard-personal-skill-'));
        const folder = path.join(home, '.codex', 'skills', 'sample');
        await mkdir(folder, { recursive: true });
        await writeFile(
            path.join(folder, 'SKILL.md'),
            '---\nname: sample\ndescription: Sample\n---\n'
        );
        const skill = { source: 'codex' as const, name: 'sample', path: folder };
        vi.mocked(findPersonalSkills).mockResolvedValueOnce([skill]).mockResolvedValueOnce([skill]);
        vi.mocked(queryWorkspaceTool).mockClear();
        const runtime = { ...nodeCloudRuntime(new AbortController().signal), prompt: null };
        const context: CommandContext = {
            runtime,
            output: createOutput(runtime, 'json'),
            invocation: ['import'],
            overrides: { apiBaseUrl: null, apiKey: null, cloudProject: null, profile: null },
            connection: async () => {
                throw new Error('unexpected authentication');
            },
            client: async () => {
                throw new Error('unexpected network');
            },
        };
        const command = importCommands[0];
        if (!command) throw new Error('missing import command');
        await expect(
            command.run(context, { positionals: [], values: { select: 'skill:codex:sample' } })
        ).rejects.toMatchObject({ kind: 'needs_confirmation' });
        expect(queryWorkspaceTool).not.toHaveBeenCalled();
        await expect(
            command.run(context, {
                positionals: [],
                values: { select: 'skill:codex:sample', yes: true },
            })
        ).rejects.toThrow(/provenance/i);
        expect(queryWorkspaceTool).not.toHaveBeenCalled();
    });
    it('discovers both sources without authentication or network access', async () => {
        let output = '';
        const runtime = {
            ...nodeCloudRuntime(new AbortController().signal),
            prompt: null,
            stdoutIsTerminal: false,
            writeOutput: (text: string) => {
                output += text;
            },
        };
        const context: CommandContext = {
            runtime,
            output: createOutput(runtime, 'json'),
            invocation: ['import'],
            overrides: { apiBaseUrl: null, apiKey: null, cloudProject: null, profile: null },
            connection: async () => {
                throw new Error('unexpected authentication');
            },
            client: async () => {
                throw new Error('unexpected network');
            },
        };
        const command = importCommands.find((item) => item.path.length === 1);
        if (!command) throw new Error('missing import command');
        await command.run(context, { positionals: [], values: {} });
        expect(JSON.parse(output)).toMatchObject({ sessions: [] });
    });

    it('fails safely when the current session cannot be identified', async () => {
        const runtime = {
            ...nodeCloudRuntime(new AbortController().signal),
            environment: {},
            prompt: null,
        };
        const context: CommandContext = {
            runtime,
            output: createOutput(runtime, 'json'),
            invocation: ['import'],
            overrides: { apiBaseUrl: null, apiKey: null, cloudProject: null, profile: null },
            connection: async () => {
                throw new Error('unexpected authentication');
            },
            client: async () => {
                throw new Error('unexpected network');
            },
        };
        const command = importCommands.find((item) => item.path.length === 1);
        if (!command) throw new Error('missing import command');
        await expect(
            command.run(context, { positionals: [], values: { 'current-session': true } })
        ).rejects.toThrow(/current session/i);
    });

    it('previews selected redacted messages without authenticating', async () => {
        const chat = {
            id: 'test-1',
            source: 'codex' as const,
            title: 'Test',
            cwd: '/tmp/test',
            gitBranch: null,
            path: '/tmp/test.jsonl',
            pullRequests: [],
            repository: null,
            startedAt: '2026-01-01T00:00:00Z',
            updatedAt: '2026-01-01T00:00:00Z',
            messages: [
                {
                    role: 'user' as const,
                    text: 'password=supersecretvalue',
                    createdAt: '2026-01-01T00:00:00Z',
                },
            ],
        };
        vi.mocked(findLocalChats)
            .mockResolvedValueOnce({ chats: [], notices: [] })
            .mockResolvedValueOnce({ chats: [chat], notices: [] });
        let output = '';
        const runtime = {
            ...nodeCloudRuntime(new AbortController().signal),
            prompt: null,
            writeOutput: (text: string) => {
                output += text;
            },
        };
        const context: CommandContext = {
            runtime,
            output: createOutput(runtime, 'json'),
            invocation: ['import'],
            overrides: { apiBaseUrl: null, apiKey: null, cloudProject: null, profile: null },
            connection: async () => {
                throw new Error('unexpected authentication');
            },
            client: async () => {
                throw new Error('unexpected network');
            },
        };
        const command = importCommands[0];
        if (!command) throw new Error('missing import command');
        expect(
            await command.run(context, {
                positionals: [],
                values: { select: 'codex:test-1', 'dry-run': true },
            })
        ).toBe(0);
        expect(output).toContain('[redacted:assignment]');
        expect(output).not.toContain('supersecretvalue');
    });

    it('requires consent before uploading a selected session', async () => {
        const chat = {
            id: 'test-2',
            source: 'codex' as const,
            title: 'Test',
            cwd: '/tmp/test',
            gitBranch: null,
            path: '/tmp/test.jsonl',
            pullRequests: [],
            repository: null,
            startedAt: '2026-01-01T00:00:00Z',
            updatedAt: '2026-01-01T00:00:00Z',
            messages: [{ role: 'user' as const, text: 'hello', createdAt: '2026-01-01T00:00:00Z' }],
        };
        vi.mocked(findLocalChats)
            .mockResolvedValueOnce({ chats: [], notices: [] })
            .mockResolvedValueOnce({ chats: [chat], notices: [] });
        const runtime = { ...nodeCloudRuntime(new AbortController().signal), prompt: null };
        const context: CommandContext = {
            runtime,
            output: createOutput(runtime, 'json'),
            invocation: ['import'],
            overrides: { apiBaseUrl: null, apiKey: null, cloudProject: null, profile: null },
            connection: async () => {
                throw new Error('unexpected authentication');
            },
            client: async () => {
                throw new Error('unexpected network');
            },
        };
        const command = importCommands[0];
        if (!command) throw new Error('missing import command');
        await expect(
            command.run(context, { positionals: [], values: { select: 'codex:test-2' } })
        ).rejects.toMatchObject({ kind: 'needs_confirmation' });
    });

    it('identifies a Claude Code session without guessing', async () => {
        const chat = {
            id: 'claude-1',
            source: 'claude-code' as const,
            title: 'Test',
            cwd: '/tmp/test',
            gitBranch: null,
            path: '/tmp/test.jsonl',
            pullRequests: [],
            repository: null,
            startedAt: '2026-01-01T00:00:00Z',
            updatedAt: '2026-01-01T00:00:00Z',
            messages: [{ role: 'user' as const, text: 'hello', createdAt: '2026-01-01T00:00:00Z' }],
        };
        vi.mocked(findLocalChats)
            .mockResolvedValueOnce({ chats: [chat], notices: [] })
            .mockResolvedValueOnce({ chats: [], notices: [] });
        let output = '';
        const runtime = {
            ...nodeCloudRuntime(new AbortController().signal),
            environment: { CLAUDE_CODE_SESSION_ID: 'claude-1' },
            prompt: null,
            writeOutput: (text: string) => {
                output += text;
            },
        };
        const context: CommandContext = {
            runtime,
            output: createOutput(runtime, 'json'),
            invocation: ['import'],
            overrides: { apiBaseUrl: null, apiKey: null, cloudProject: null, profile: null },
            connection: async () => {
                throw new Error('unexpected authentication');
            },
            client: async () => {
                throw new Error('unexpected network');
            },
        };
        const command = importCommands[0];
        if (!command) throw new Error('missing import command');
        expect(
            await command.run(context, {
                positionals: [],
                values: { 'current-session': true, 'dry-run': true },
            })
        ).toBe(0);
        expect(JSON.parse(output).sessions[0].id).toBe('claude-code:claude-1');
    });

    it('reports partial failures without leaking error details', async () => {
        const chat = {
            id: 'one',
            source: 'codex' as const,
            title: 'Test',
            cwd: '/tmp/test',
            gitBranch: null,
            path: '/tmp/test.jsonl',
            pullRequests: [],
            repository: null,
            startedAt: '2026-01-01T00:00:00Z',
            updatedAt: '2026-01-01T00:00:00Z',
            messages: [{ role: 'user' as const, text: 'hello', createdAt: '2026-01-01T00:00:00Z' }],
        };
        vi.mocked(findLocalChats)
            .mockResolvedValueOnce({ chats: [], notices: [] })
            .mockResolvedValueOnce({ chats: [chat, { ...chat, id: 'two' }], notices: [] });
        vi.mocked(queryWorkspaceTool).mockRejectedValueOnce(
            new CommandFailure('failed', 'sensitive failure detail', null)
        );
        let output = '';
        const runtime = {
            ...nodeCloudRuntime(new AbortController().signal),
            prompt: null,
            writeOutput: (text: string) => {
                output += text;
            },
        };
        const context: CommandContext = {
            runtime,
            output: createOutput(runtime, 'json'),
            invocation: ['import'],
            overrides: { apiBaseUrl: null, apiKey: null, cloudProject: null, profile: null },
            connection: async () => {
                throw new Error('unexpected authentication');
            },
            client: async () => {
                throw new Error('unexpected network');
            },
        };
        const command = importCommands[0];
        if (!command) throw new Error('missing import command');
        expect(
            await command.run(context, {
                positionals: [],
                values: { select: 'codex:one,codex:two', yes: true },
            })
        ).toBe(1);
        expect(JSON.parse(output).sessions.map((item: { status: string }) => item.status)).toEqual([
            'failed',
            'imported',
        ]);
        expect(output).not.toContain('sensitive failure detail');
    });

    it('preserves completed results if authorization fails partway through', async () => {
        const chat = {
            id: 'one',
            source: 'codex' as const,
            title: 'Test',
            cwd: '/tmp/test',
            gitBranch: null,
            path: '/tmp/test.jsonl',
            pullRequests: [],
            repository: null,
            startedAt: '2026-01-01T00:00:00Z',
            updatedAt: '2026-01-01T00:00:00Z',
            messages: [{ role: 'user' as const, text: 'hello', createdAt: '2026-01-01T00:00:00Z' }],
        };
        vi.mocked(findLocalChats)
            .mockResolvedValueOnce({ chats: [], notices: [] })
            .mockResolvedValueOnce({ chats: [chat, { ...chat, id: 'two' }], notices: [] });
        vi.mocked(queryWorkspaceTool)
            .mockResolvedValueOnce({
                session: { id: 'created' },
                status: 'imported',
                url: 'https://example.test/chat',
            })
            .mockRejectedValueOnce(
                new CommandFailure('needs_sign_in', 'Sign in.', 'dexto login --device')
            );
        let output = '';
        const runtime = {
            ...nodeCloudRuntime(new AbortController().signal),
            prompt: null,
            writeOutput: (text: string) => {
                output += text;
            },
        };
        const context: CommandContext = {
            runtime,
            output: createOutput(runtime, 'json'),
            invocation: ['import'],
            overrides: { apiBaseUrl: null, apiKey: null, cloudProject: null, profile: null },
            connection: async () => {
                throw new Error('unexpected authentication');
            },
            client: async () => {
                throw new Error('unexpected network');
            },
        };
        const command = importCommands[0];
        if (!command) throw new Error('missing import command');
        expect(
            await command.run(context, {
                positionals: [],
                values: { select: 'codex:one,codex:two', yes: true },
            })
        ).toBe(3);
        const result = JSON.parse(output);
        expect(result.sessions[0].status).toBe('imported');
        expect(result.error.code).toBe('needs_sign_in');
    });

    it('reports a skipped invalid session as a failed dry run', async () => {
        const chat = {
            id: 'bad/id',
            source: 'codex' as const,
            title: 'Test',
            cwd: '/tmp/test',
            gitBranch: null,
            path: '/tmp/test.jsonl',
            pullRequests: [],
            repository: null,
            startedAt: '2026-01-01T00:00:00Z',
            updatedAt: '2026-01-01T00:00:00Z',
            messages: [{ role: 'user' as const, text: 'hello', createdAt: '2026-01-01T00:00:00Z' }],
        };
        vi.mocked(findLocalChats)
            .mockResolvedValueOnce({ chats: [], notices: [] })
            .mockResolvedValueOnce({ chats: [chat], notices: [] });
        let output = '';
        const runtime = {
            ...nodeCloudRuntime(new AbortController().signal),
            prompt: null,
            writeOutput: (text: string) => {
                output += text;
            },
        };
        const context: CommandContext = {
            runtime,
            output: createOutput(runtime, 'json'),
            invocation: ['import'],
            overrides: { apiBaseUrl: null, apiKey: null, cloudProject: null, profile: null },
            connection: async () => {
                throw new Error('unexpected authentication');
            },
            client: async () => {
                throw new Error('unexpected network');
            },
        };
        const command = importCommands[0];
        if (!command) throw new Error('missing import command');
        expect(
            await command.run(context, {
                positionals: [],
                values: { select: 'codex:bad/id', 'dry-run': true },
            })
        ).toBe(1);
        expect(JSON.parse(output).sessions[0].status).toBe('skipped');
    });

    it('redacts discovered titles and paths before printing them', async () => {
        const chat = {
            id: 'one',
            source: 'codex' as const,
            title: 'password=supersecretvalue',
            cwd: '/tmp/token=supersecretvalue',
            gitBranch: null,
            path: '/tmp/test.jsonl',
            pullRequests: [],
            repository: null,
            startedAt: '2026-01-01T00:00:00Z',
            updatedAt: '2026-01-01T00:00:00Z',
            messages: [{ role: 'user' as const, text: 'hello', createdAt: '2026-01-01T00:00:00Z' }],
        };
        vi.mocked(findLocalChats)
            .mockResolvedValueOnce({ chats: [], notices: [] })
            .mockResolvedValueOnce({ chats: [chat], notices: [] });
        let output = '';
        const runtime = {
            ...nodeCloudRuntime(new AbortController().signal),
            prompt: null,
            writeOutput: (text: string) => {
                output += text;
            },
        };
        const context: CommandContext = {
            runtime,
            output: createOutput(runtime, 'json'),
            invocation: ['import'],
            overrides: { apiBaseUrl: null, apiKey: null, cloudProject: null, profile: null },
            connection: async () => {
                throw new Error('unexpected authentication');
            },
            client: async () => {
                throw new Error('unexpected network');
            },
        };
        const command = importCommands[0];
        if (!command) throw new Error('missing import command');
        await command.run(context, { positionals: [], values: {} });
        expect(output).not.toContain('supersecretvalue');
        expect(output).toContain('[redacted:assignment]');
    });

    it('treats selecting all with no sessions as an empty success', async () => {
        vi.mocked(findLocalChats)
            .mockResolvedValueOnce({ chats: [], notices: [] })
            .mockResolvedValueOnce({ chats: [], notices: [] });
        let output = '';
        const runtime = {
            ...nodeCloudRuntime(new AbortController().signal),
            prompt: null,
            writeOutput: (text: string) => {
                output += text;
            },
        };
        const context: CommandContext = {
            runtime,
            output: createOutput(runtime, 'json'),
            invocation: ['import'],
            overrides: { apiBaseUrl: null, apiKey: null, cloudProject: null, profile: null },
            connection: async () => {
                throw new Error('unexpected authentication');
            },
            client: async () => {
                throw new Error('unexpected network');
            },
        };
        const command = importCommands[0];
        if (!command) throw new Error('missing import command');
        expect(
            await command.run(context, { positionals: [], values: { select: 'all', yes: true } })
        ).toBe(0);
        expect(JSON.parse(output).sessions).toEqual([]);
    });

    it('lists personal skills in discovery without uploading them', async () => {
        vi.mocked(findPersonalSkills).mockResolvedValueOnce([
            { source: 'claude-code', name: 'sample', path: '/home/test/.claude/skills/sample' },
        ]);
        let output = '';
        const runtime = {
            ...nodeCloudRuntime(new AbortController().signal),
            prompt: null,
            writeOutput: (text: string) => {
                output += text;
            },
        };
        const context: CommandContext = {
            runtime,
            output: createOutput(runtime, 'json'),
            invocation: ['import'],
            overrides: { apiBaseUrl: null, apiKey: null, cloudProject: null, profile: null },
            connection: async () => {
                throw new Error('unexpected authentication');
            },
            client: async () => {
                throw new Error('unexpected network');
            },
        };
        const command = importCommands[0];
        if (!command) throw new Error('missing import command');
        await command.run(context, { positionals: [], values: {} });
        expect(JSON.parse(output).skills).toEqual([
            {
                id: 'skill:claude-code:sample',
                source: 'claude-code',
                name: 'sample',
                status: 'available',
            },
        ]);
    });

    it('fails rather than silently omitting a missing selected skill from select all', async () => {
        vi.mocked(findPersonalSkills).mockResolvedValueOnce([
            { source: 'codex', name: 'sample', path: '/home/test/.codex/skills/sample' },
        ]);
        const runtime = { ...nodeCloudRuntime(new AbortController().signal), prompt: null };
        const context: CommandContext = {
            runtime,
            output: createOutput(runtime, 'json'),
            invocation: ['import'],
            overrides: { apiBaseUrl: null, apiKey: null, cloudProject: null, profile: null },
            connection: async () => {
                throw new Error('unexpected authentication');
            },
            client: async () => {
                throw new Error('unexpected network');
            },
        };
        const command = importCommands[0];
        if (!command) throw new Error('missing import command');
        await expect(
            command.run(context, { positionals: [], values: { select: 'all', yes: true } })
        ).rejects.toThrow(/not a folder/i);
    });
});

describe('imported models', () => {
    const chat = (source: 'claude-code' | 'codex', id: string) => ({
        id,
        source,
        title: 'Test',
        cwd: '/tmp/test',
        gitBranch: null,
        path: '/tmp/test.jsonl',
        pullRequests: [],
        repository: null,
        startedAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:01Z',
        messages: [
            { role: 'user' as const, text: 'hello', createdAt: '2026-01-01T00:00:00Z' },
            {
                role: 'assistant' as const,
                text: 'hi',
                createdAt: '2026-01-01T00:00:01Z',
                model: 'gpt-6.1-sol',
                reasoningEffort: 'high',
            },
        ],
    });
    const imported = (reason: 'same_model' | 'not_usable', model: string) => ({
        session: { id: 'created' },
        status: 'imported',
        url: 'https://example.test/chat',
        continuation: { model, sourceModel: 'gpt-6.1-sol', reason },
    });
    async function runImport(format: 'json' | 'table', values: Record<string, string | boolean>) {
        let output = '';
        const runtime = {
            ...nodeCloudRuntime(new AbortController().signal),
            prompt: null,
            writeOutput: (text: string) => {
                output += text;
            },
        };
        const context: CommandContext = {
            runtime,
            output: createOutput(runtime, format),
            invocation: ['import'],
            overrides: { apiBaseUrl: null, apiKey: null, cloudProject: null, profile: null },
            connection: async () => {
                throw new Error('unexpected authentication');
            },
            client: async () => {
                throw new Error('unexpected network');
            },
        };
        const command = importCommands[0];
        if (!command) throw new Error('missing import command');
        const code = await command.run(context, { positionals: [], values });
        return { code, output };
    }

    it('sends the model and effort of each answer', async () => {
        vi.mocked(findLocalChats)
            .mockResolvedValueOnce({ chats: [], notices: [] })
            .mockResolvedValueOnce({ chats: [chat('codex', 'one')], notices: [] });
        vi.mocked(queryWorkspaceTool).mockClear();
        await runImport('json', { select: 'codex:one', yes: true });
        expect(vi.mocked(queryWorkspaceTool).mock.calls[0]?.[2]).toMatchObject({
            messages: [
                { role: 'user', text: 'hello' },
                { role: 'assistant', model: 'gpt-6.1-sol', reasoningEffort: 'high' },
            ],
        });
    });

    it('says which model each chat continues on, and hints once at connecting Codex', async () => {
        vi.mocked(findLocalChats)
            .mockResolvedValueOnce({ chats: [chat('claude-code', 'cc')], notices: [] })
            .mockResolvedValueOnce({
                chats: [chat('codex', 'one'), chat('codex', 'two')],
                notices: [],
            });
        vi.mocked(queryWorkspaceTool)
            .mockResolvedValueOnce(imported('same_model', 'anthropic/claude-opus-5-5'))
            .mockResolvedValueOnce(imported('same_model', 'openai/gpt-6.1-sol'))
            .mockResolvedValueOnce(imported('not_usable', 'anthropic/claude-opus-5-5'));
        const { code, output } = await runImport('table', {
            select: 'claude-code:cc,codex:one,codex:two',
            yes: true,
        });
        expect(code).toBe(0);
        expect(output).toContain(
            'codex:one: imported https://example.test/chat\n  continues on openai/gpt-6.1-sol (same model as in Codex)'
        );
        expect(output).toContain('(same model as in Claude Code)');
        expect(output).toContain(
            "continues on anthropic/claude-opus-5-5: Dexto can't run gpt-6.1-sol for your account"
        );
        expect(output.split(CONNECT_CODEX_HINT)).toHaveLength(2);
        expect(output.trimEnd().endsWith(CONNECT_CODEX_HINT)).toBe(true);
        expect(CONNECT_CODEX_HINT).toContain('`dexto connect codex`');
    });

    it('gives the hint as a field in JSON, and none when every Codex chat keeps its model', async () => {
        vi.mocked(findLocalChats)
            .mockResolvedValueOnce({ chats: [chat('claude-code', 'cc')], notices: [] })
            .mockResolvedValueOnce({ chats: [chat('codex', 'one')], notices: [] });
        vi.mocked(queryWorkspaceTool)
            .mockResolvedValueOnce(imported('not_usable', 'openai/gpt-6.1-sol'))
            .mockResolvedValueOnce(imported('not_usable', 'anthropic/claude-opus-5-5'));
        const withHint = await runImport('json', { select: 'claude-code:cc,codex:one', yes: true });
        expect(JSON.parse(withHint.output)).toMatchObject({
            hints: [CONNECT_CODEX_HINT],
            sessions: [
                { id: 'claude-code:cc', continuation: { reason: 'not_usable' } },
                { id: 'codex:one', continuation: { model: 'anthropic/claude-opus-5-5' } },
            ],
        });

        vi.mocked(findLocalChats)
            .mockResolvedValueOnce({ chats: [chat('claude-code', 'cc')], notices: [] })
            .mockResolvedValueOnce({ chats: [chat('codex', 'one')], notices: [] });
        vi.mocked(queryWorkspaceTool)
            .mockResolvedValueOnce(imported('not_usable', 'openai/gpt-6.1-sol'))
            .mockResolvedValueOnce({
                session: { id: 'created' },
                status: 'already_imported',
                url: 'https://example.test/chat',
            });
        const withoutHint = await runImport('json', {
            select: 'claude-code:cc,codex:one',
            yes: true,
        });
        expect(JSON.parse(withoutHint.output).hints).toEqual([]);
    });
});

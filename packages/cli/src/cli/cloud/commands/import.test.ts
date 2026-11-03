import { describe, expect, it, vi } from 'vitest';
import { createOutput } from '../output.js';
import { nodeCloudRuntime } from '../runtime.js';
import type { CommandContext } from '../command.js';
import { importCommands } from './import.js';
import { findLocalChats } from '../../import/local-chats.js';
import { findPersonalSkills } from '../../import/personal-skills.js';
import { queryWorkspaceTool } from './workspace.js';
import { CommandFailure } from '../../failure.js';

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
                status: 'not_available',
            },
        ]);
    });

    it('does not silently omit personal skills from select all', async () => {
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
        ).rejects.toThrow(/skill import.*not available/i);
    });
});
